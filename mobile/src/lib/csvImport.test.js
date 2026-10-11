import { describe, it, expect, vi } from "vitest";
import { AxiosError } from "axios";
import { IMPORT_LIMITS } from "@abaco/csv";
import api from "./api.js";
import {
  CSV_ACCEPT,
  IMPORT_TIMEOUT_MS,
  PARSE_ERROR_KEYS,
  bodyTooLarge,
  buildImportBody,
  extractRowErrors,
  importRetryOptions,
  isUnconfirmedImportError,
  parseCsvFile,
  pickCsvFile,
  runImport,
} from "./csvImport.js";

const ACCOUNT_ID = "8f0c2b1e-5d7a-4c3b-9e2f-1a6b7c8d9e0f";

/** A Blob-like file for the node environment (size + text()). */
const fakeFile = (text, { size, name = "bank.csv" } = {}) => ({
  name,
  size: size ?? new TextEncoder().encode(text).length,
  text: async () => text,
});

/** Minimal document double: records the created input and its listeners. */
function fakeDocument() {
  const appended = [];
  let input;
  const doc = {
    body: { appendChild: (el) => appended.push(el) },
    createElement: (tag) => {
      input = {
        tag,
        style: {},
        files: null,
        removed: false,
        clicked: 0,
        handlers: {},
        addEventListener(type, fn) {
          this.handlers[type] = fn;
        },
        click() {
          this.clicked += 1;
        },
        remove() {
          this.removed = true;
        },
      };
      return input;
    },
  };
  return {
    doc,
    appended,
    get input() {
      return input;
    },
  };
}

function badRequest(data) {
  const config = { url: "/transactions/import" };
  return new AxiosError(
    "Request failed with status code 400",
    AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    { status: 400, data, headers: {}, config },
  );
}

const networkError = () =>
  new AxiosError("Network Error", AxiosError.ERR_NETWORK, {}, {});

/** A 5xx as a proxy / the handler would emit it (`data` may be HTML text). */
function serverError(status, data) {
  const config = { url: "/transactions/import" };
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    {},
    { status, data, headers: {}, config },
  );
}

describe("constants", () => {
  it("accepts the three CSV MIME spellings plus the extension", () => {
    expect(CSV_ACCEPT.split(",")).toEqual([
      ".csv",
      "text/csv",
      "text/comma-separated-values",
      "text/plain",
    ]);
  });

  it("gives a 2000-row batch two minutes", () => {
    expect(IMPORT_TIMEOUT_MS).toBe(120000);
  });

  it("maps every parse rejection reason to a literal i18n key", () => {
    expect(PARSE_ERROR_KEYS).toEqual({
      fileTooLarge: "mobile.accounts.import.fileTooLarge",
      tooManyRows: "mobile.accounts.import.tooManyRows",
      parse: "transactions.importParseError",
    });
  });
});

describe("pickCsvFile", () => {
  it("mounts a hidden CSV file input, clicks it and resolves the chosen file", async () => {
    const env = fakeDocument();
    const promise = pickCsvFile(env.doc);
    const input = env.input;
    expect(input.tag).toBe("input");
    expect(input.type).toBe("file");
    expect(input.accept).toBe(CSV_ACCEPT);
    expect(input.style.display).toBe("none");
    expect(env.appended).toEqual([input]);
    expect(input.clicked).toBe(1);

    const file = { name: "bank.csv" };
    input.files = [file];
    input.handlers.change();
    await expect(promise).resolves.toBe(file);
    expect(input.removed).toBe(true);
  });

  it("resolves null on cancel and removes the input", async () => {
    const env = fakeDocument();
    const promise = pickCsvFile(env.doc);
    env.input.handlers.cancel();
    await expect(promise).resolves.toBeNull();
    expect(env.input.removed).toBe(true);
  });

  it("resolves null when change fires with no file, and settles only once", async () => {
    const env = fakeDocument();
    const promise = pickCsvFile(env.doc);
    env.input.files = [];
    env.input.handlers.change();
    env.input.handlers.cancel(); // a late cancel must not throw or re-resolve
    await expect(promise).resolves.toBeNull();
  });

  it("resolves null without a document (node, SSR)", async () => {
    await expect(pickCsvFile(null)).resolves.toBeNull();
  });
});

describe("parseCsvFile", () => {
  it("rejects files above the 2 MB cap before reading them", async () => {
    const text = vi.fn();
    const file = { size: IMPORT_LIMITS.maxFileBytes + 1, text };
    await expect(parseCsvFile(file)).rejects.toMatchObject({
      reason: "fileTooLarge",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("parses a BOM-prefixed CRLF file with quoted cells and trims headers", async () => {
    const csv =
      "﻿ Date ,Description,Amount\r\n" +
      '2026-09-01,"Café, Inc.",-12.50\r\n' +
      "09/02/2026,Deposit,100\r\n";
    const { fields, data } = await parseCsvFile(fakeFile(csv));
    expect(fields).toEqual(["Date", "Description", "Amount"]);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      Date: "2026-09-01",
      Description: "Café, Inc.",
      Amount: "-12.50",
    });
    expect(data[1].Amount).toBe("100");
  });

  it("drops blank lines (greedy) and accepts the native File when present", async () => {
    const csv = "Date,Amount\n\n2026-01-02,5\n   \n2026-01-03,-7\n\n";
    const file =
      typeof File === "function"
        ? new File([csv], "a.csv", { type: "text/csv" })
        : fakeFile(csv);
    const { data } = await parseCsvFile(file);
    expect(data).toHaveLength(2);
  });

  it("rejects an empty file and a header-only file as unreadable", async () => {
    await expect(parseCsvFile(fakeFile(""))).rejects.toMatchObject({
      reason: "parse",
    });
    await expect(
      parseCsvFile(fakeFile("Date,Amount\r\n")),
    ).rejects.toMatchObject({ reason: "parse" });
    await expect(parseCsvFile(null)).rejects.toMatchObject({
      reason: "parse",
    });
  });

  it("rejects more than 2000 rows with the parsed count", async () => {
    const rows = Array.from(
      { length: IMPORT_LIMITS.maxRows + 1 },
      (_, i) => `2026-01-01,Row ${i},1.00`,
    );
    const csv = `Date,Description,Amount\n${rows.join("\n")}\n`;
    await expect(parseCsvFile(fakeFile(csv))).rejects.toMatchObject({
      reason: "tooManyRows",
      count: IMPORT_LIMITS.maxRows + 1,
    });
  });

  it("accepts exactly 2000 rows", async () => {
    const rows = Array.from(
      { length: IMPORT_LIMITS.maxRows },
      () => "2026-01-01,x,1",
    );
    const { data } = await parseCsvFile(
      fakeFile(`Date,Description,Amount\n${rows.join("\n")}`),
    );
    expect(data).toHaveLength(IMPORT_LIMITS.maxRows);
  });
});

describe("buildImportBody", () => {
  it("sends accountId (never fundingCoaId) and omits empty merchant/notes", () => {
    const body = buildImportBody(
      ACCOUNT_ID,
      [
        { date: "2026-09-01", amount: -12.5, merchant: "Café" },
        { date: "2026-09-02", amount: 100, merchant: "", notes: "" },
        { date: "2026-09-03", amount: 3, notes: "ref 42" },
        { date: "2026-09-04", amount: -4, merchant: "Shop", notes: "n" },
      ],
      true,
    );
    expect(body).toEqual({
      accountId: ACCOUNT_ID,
      rows: [
        { date: "2026-09-01", amount: -12.5, merchant: "Café" },
        { date: "2026-09-02", amount: 100 },
        { date: "2026-09-03", amount: 3, notes: "ref 42" },
        { date: "2026-09-04", amount: -4, merchant: "Shop", notes: "n" },
      ],
      skipDuplicates: true,
    });
    expect(body).not.toHaveProperty("fundingCoaId");
    expect(Object.keys(body)).toEqual(["accountId", "rows", "skipDuplicates"]);
    expect(body.rows[1]).not.toHaveProperty("merchant");
    expect(body.rows[1]).not.toHaveProperty("notes");
  });

  it("carries skipDuplicates = false through and tolerates missing rows", () => {
    expect(buildImportBody(ACCOUNT_ID, undefined, false)).toEqual({
      accountId: ACCOUNT_ID,
      rows: [],
      skipDuplicates: false,
    });
  });

  it("strips any extra per-row fields the screen may carry", () => {
    const body = buildImportBody(
      ACCOUNT_ID,
      [{ date: "2026-01-01", amount: 1, merchant: "A", row: 7, raw: {} }],
      true,
    );
    expect(body.rows[0]).toEqual({
      date: "2026-01-01",
      amount: 1,
      merchant: "A",
    });
  });
});

describe("bodyTooLarge", () => {
  it("flips exactly above IMPORT_LIMITS.maxBodyBytes", () => {
    // {"pad":""} is 10 bytes of JSON scaffolding.
    const atLimit = { pad: "x".repeat(IMPORT_LIMITS.maxBodyBytes - 10) };
    expect(bodyTooLarge(atLimit)).toBe(false);
    const over = { pad: "x".repeat(IMPORT_LIMITS.maxBodyBytes - 9) };
    expect(bodyTooLarge(over)).toBe(true);
  });

  it("is false for a normal import body", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      date: "2026-01-01",
      amount: -(i + 1) / 100,
      merchant: `Merchant ${i}`,
    }));
    expect(bodyTooLarge(buildImportBody(ACCOUNT_ID, rows, true))).toBe(false);
  });
});

describe("runImport", () => {
  const body = buildImportBody(
    ACCOUNT_ID,
    [{ date: "2026-09-01", amount: -12.5, merchant: "Café" }],
    true,
  );

  it("POSTs the body to /transactions/import with the two-minute timeout", async () => {
    let seen;
    api.defaults.adapter = async (config) => {
      seen = config;
      return {
        status: 200,
        data: { imported: 1, skipped: 0, total: 1 },
        headers: {},
        config,
      };
    };
    const result = await runImport(api, body);
    expect(seen.method).toBe("post");
    expect(seen.baseURL).toBe("/api");
    expect(seen.url).toBe("/transactions/import");
    expect(seen.timeout).toBe(120000);
    expect(JSON.parse(seen.data)).toEqual(body);
    expect(result).toEqual({ imported: 1, skipped: 0, total: 1 });
  });

  it("honours a custom timeout", async () => {
    let seen;
    api.defaults.adapter = async (config) => {
      seen = config;
      return { status: 200, data: {}, headers: {}, config };
    };
    await runImport(api, body, { timeout: 5000 });
    expect(seen.timeout).toBe(5000);
  });

  it("rejects with the axios error on a 400 so the caller can inspect it", async () => {
    api.defaults.adapter = async () => {
      throw badRequest({ error: "No rows to import" });
    };
    await expect(runImport(api, body)).rejects.toMatchObject({
      response: { status: 400, data: { error: "No rows to import" } },
    });
  });
});

describe("extractRowErrors", () => {
  it("returns the backend's errors[] from a 400 'Some rows are invalid'", () => {
    const errors = [
      { row: 3, error: "Invalid date (expected YYYY-MM-DD)" },
      { row: 9, error: "Invalid or zero amount" },
    ];
    expect(
      extractRowErrors(badRequest({ error: "Some rows are invalid", errors })),
    ).toEqual(errors);
  });

  it("returns [] for a 400 without errors[], a network error and nothing", () => {
    expect(
      extractRowErrors(badRequest({ error: "No rows to import" })),
    ).toEqual([]);
    expect(
      extractRowErrors(badRequest({ error: "x", errors: "not-an-array" })),
    ).toEqual([]);
    expect(extractRowErrors(networkError())).toEqual([]);
    expect(extractRowErrors(undefined)).toEqual([]);
  });
});

describe("isUnconfirmedImportError", () => {
  it("is true when the request got no response (offline, client timeout)", () => {
    expect(isUnconfirmedImportError(networkError())).toBe(true);
    const timeout = new AxiosError(
      "timeout of 120000ms exceeded",
      AxiosError.ECONNABORTED,
      {},
      {},
    );
    expect(isUnconfirmedImportError(timeout)).toBe(true);
  });

  it("is true for a gateway 502/503/504 even with a JSON error body", () => {
    expect(
      isUnconfirmedImportError(serverError(502, "<html>Bad Gateway</html>")),
    ).toBe(true);
    expect(isUnconfirmedImportError(serverError(503, ""))).toBe(true);
    expect(
      isUnconfirmedImportError(serverError(504, { error: "upstream timeout" })),
    ).toBe(true);
  });

  it("is true for any other 5xx that lacks the handler's { error } body", () => {
    expect(isUnconfirmedImportError(serverError(500, "<html>…</html>"))).toBe(
      true,
    );
    expect(isUnconfirmedImportError(serverError(500, {}))).toBe(true);
    expect(isUnconfirmedImportError(serverError(500, undefined))).toBe(true);
  });

  it("is false for the handler's own 500 (it rolled back) and for 4xx", () => {
    expect(
      isUnconfirmedImportError(
        serverError(500, { error: "Failed to import transactions" }),
      ),
    ).toBe(false);
    expect(isUnconfirmedImportError(badRequest({ error: "x" }))).toBe(false);
    expect(
      isUnconfirmedImportError(
        badRequest({ error: "Some rows are invalid", errors: [] }),
      ),
    ).toBe(false);
    expect(isUnconfirmedImportError(undefined)).toBe(false);
    expect(isUnconfirmedImportError(new Error("plain"))).toBe(false);
  });
});

describe("importRetryOptions", () => {
  it("forces skipDuplicates and locks the toggle after a network failure", () => {
    expect(
      importRetryOptions(networkError(), { skipDuplicates: false }),
    ).toEqual({ skipDuplicates: true, forcedSkip: true });
    const timeout = new AxiosError(
      "timeout of 120000ms exceeded",
      AxiosError.ECONNABORTED,
      {},
      {},
    );
    expect(importRetryOptions(timeout, { skipDuplicates: false })).toEqual({
      skipDuplicates: true,
      forcedSkip: true,
    });
  });

  it("forces skipDuplicates after a gateway 5xx (the batch may have committed)", () => {
    for (const status of [502, 503, 504]) {
      expect(
        importRetryOptions(serverError(status, "<html>gateway</html>"), {
          skipDuplicates: false,
        }),
      ).toEqual({ skipDuplicates: true, forcedSkip: true });
    }
    expect(
      importRetryOptions(serverError(500, "<html>no json</html>"), {
        skipDuplicates: false,
      }),
    ).toEqual({ skipDuplicates: true, forcedSkip: true });
  });

  it("leaves the options alone for a definite HTTP failure (fresh copy)", () => {
    const opts = { skipDuplicates: false };
    const out = importRetryOptions(badRequest({ error: "x" }), opts);
    expect(out).toEqual({ skipDuplicates: false });
    expect(out).not.toBe(opts);
    expect(importRetryOptions(badRequest({ error: "x" }))).toEqual({});
    // The handler's own 500 carries { error } after its ROLLBACK.
    expect(
      importRetryOptions(serverError(500, { error: "boom" }), {
        skipDuplicates: false,
      }),
    ).toEqual({ skipDuplicates: false });
  });
});
