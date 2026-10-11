import { describe, it, expect, beforeEach, vi } from "vitest";
import { AxiosError } from "axios";

// The native share wrapper pulls @capacitor/core through platform.js; the
// export flow receives its share step by injection anyway.
const defaultShare = vi.fn(async () => "shared");
vi.mock("../native/share.js", () => ({
  shareTextFile: (...args) => defaultShare(...args),
  isNativePlatform: () => false,
  purgeExports: async () => false,
}));

import api from "./api.js";
import { describeError } from "./apiErrors.js";
import {
  EXPORT_RANGES,
  EXPORT_TIMEOUT_MS,
  exportParams,
  fetchCsv,
  isCsvResponse,
  isEmptyCsv,
  runExport,
} from "./csvExport.js";

const NOW = new Date(2026, 9, 10, 12, 0, 0); // 2026-10-10
const HEADER = "Date,Merchant,Category,Account,Type,Amount,Notes";
const CSV = `${HEADER}\r\n2026-10-03,"Café Rico",Meals,Main checking,expense,-12.50,\r\n2026-10-05,Client,Sales,Main checking,income,250.00,"Invoice 7"\r\n`;
const ACCOUNT = { id: "acc-1", name: "Main checking" };

// Adapter stub (api.test.js pattern): resolves 2xx, rejects like axios' own
// adapters do for 4xx/5xx. Records every config it saw.
function stub({
  status = 200,
  data = "",
  contentType = "text/csv; charset=utf-8",
} = {}) {
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push(config);
    const response = {
      status,
      data,
      headers: { "content-type": contentType },
      config,
      statusText: "",
    };
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500
          ? AxiosError.ERR_BAD_RESPONSE
          : AxiosError.ERR_BAD_REQUEST,
        config,
        {},
        response,
      );
    }
    return response;
  };
  return calls;
}

beforeEach(() => {
  defaultShare.mockClear();
  defaultShare.mockImplementation(async () => "shared");
});

describe("csvExport exportParams()", () => {
  it("lists the four ranges in display order", () => {
    expect([...EXPORT_RANGES]).toEqual([
      "current",
      "thisMonth",
      "thisYear",
      "all",
    ]);
  });

  it("thisMonth spans the calendar month around now and drops the filters", () => {
    expect(
      exportParams({
        accountId: "acc-1",
        range: "thisMonth",
        filters: { type: "expense", from: "2020-01-01", to: "2020-01-31" },
        now: NOW,
      }),
    ).toEqual({
      accountId: "acc-1",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  });

  it("thisYear spans Jan 1 .. Dec 31", () => {
    expect(
      exportParams({ accountId: "acc-1", range: "thisYear", now: NOW }),
    ).toEqual({
      accountId: "acc-1",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  });

  it("all sends the account id only", () => {
    expect(
      exportParams({
        accountId: "acc-1",
        range: "all",
        filters: { type: "income", from: "2026-01-01", to: "2026-02-01" },
        now: NOW,
      }),
    ).toEqual({ accountId: "acc-1" });
  });

  it("current carries the list filters as they are (type included)", () => {
    expect(
      exportParams({
        accountId: "acc-1",
        range: "current",
        filters: { type: "expense", from: "2026-09-01", to: "2026-09-30" },
        now: NOW,
      }),
    ).toEqual({
      accountId: "acc-1",
      type: "expense",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(
      exportParams({
        accountId: "acc-1",
        range: "current",
        filters: { type: "", from: "2026-09-01", to: "" },
      }),
    ).toEqual({ accountId: "acc-1", startDate: "2026-09-01" });
  });

  it("current with no filters is the account alone; unknown types are dropped", () => {
    expect(exportParams({ accountId: "acc-1" })).toEqual({
      accountId: "acc-1",
    });
    expect(
      exportParams({
        accountId: "acc-1",
        range: "current",
        filters: { type: "drop table" },
      }),
    ).toEqual({ accountId: "acc-1" });
  });
});

describe("csvExport isCsvResponse() / isEmptyCsv()", () => {
  it("accepts only a 200 labelled text/csv", () => {
    const ok = { status: 200, headers: { "content-type": "text/csv" } };
    expect(isCsvResponse(ok)).toBe(true);
    expect(
      isCsvResponse({
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8" },
      }),
    ).toBe(true);
    expect(
      isCsvResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    ).toBe(false);
    expect(
      isCsvResponse({ status: 204, headers: { "content-type": "text/csv" } }),
    ).toBe(false);
    expect(isCsvResponse({ status: 200, headers: {} })).toBe(false);
    expect(isCsvResponse(undefined)).toBe(false);
  });

  it("treats a header-only body (or nothing) as empty", () => {
    expect(isEmptyCsv("")).toBe(true);
    expect(isEmptyCsv(undefined)).toBe(true);
    expect(isEmptyCsv(HEADER)).toBe(true);
    expect(isEmptyCsv(`${HEADER}\r\n`)).toBe(true);
    expect(isEmptyCsv(`${HEADER}\r\n\r\n`)).toBe(true);
    expect(isEmptyCsv(`\uFEFF${HEADER}\r\n`)).toBe(true);
  });

  it("is not empty once a data row follows the header", () => {
    expect(isEmptyCsv(CSV)).toBe(false);
    expect(isEmptyCsv(`${HEADER}\n2026-10-03,Shop,,Main,expense,-1,`)).toBe(
      false,
    );
  });
});

describe("csvExport fetchCsv()", () => {
  it("GETs /transactions/export as text with the long timeout", async () => {
    const calls = stub({ data: CSV });
    const res = await fetchCsv(api, { accountId: "acc-1", type: "income" });
    expect(res.data).toBe(CSV);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/transactions/export");
    expect(calls[0].method).toBe("get");
    expect(calls[0].params).toEqual({ accountId: "acc-1", type: "income" });
    expect(calls[0].responseType).toBe("text");
    expect(calls[0].timeout).toBe(EXPORT_TIMEOUT_MS);
    expect(EXPORT_TIMEOUT_MS).toBe(120000);
  });

  it("rejects a 500 with the backend's parsed { error } so describeError shows it", async () => {
    stub({
      status: 500,
      data: '{"error":"Export failed: disk full"}',
      contentType: "application/json; charset=utf-8",
    });
    let caught;
    try {
      await fetchCsv(api, { accountId: "acc-1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AxiosError);
    expect(caught.response.status).toBe(500);
    expect(caught.response.data).toEqual({ error: "Export failed: disk full" });
    expect(describeError(caught).text).toBe("Export failed: disk full");
  });

  it("leaves a non-JSON error body alone", async () => {
    stub({ status: 502, data: "Bad Gateway", contentType: "text/html" });
    await expect(fetchCsv(api, { accountId: "acc-1" })).rejects.toMatchObject({
      response: { status: 502, data: "Bad Gateway" },
    });
  });

  it("rejects a 200 whose body is not CSV", async () => {
    stub({
      status: 200,
      data: '{"error":"Not CSV"}',
      contentType: "application/json",
    });
    let caught;
    try {
      await fetchCsv(api, { accountId: "acc-1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AxiosError);
    expect(caught.code).toBe(AxiosError.ERR_BAD_RESPONSE);
    expect(caught.response.status).toBe(200);
    expect(caught.response.data).toEqual({ error: "Not CSV" });
    expect(describeError(caught).text).toBe("Not CSV");
  });
});

describe("csvExport runExport()", () => {
  it("fetches the CSV and hands filename + text to the share step", async () => {
    const calls = stub({ data: CSV });
    const share = vi.fn(async () => "downloaded");
    const result = await runExport({
      api,
      account: ACCOUNT,
      range: "thisMonth",
      filters: {},
      share,
      now: NOW,
    });
    expect(result).toBe("downloaded");
    expect(calls[0].params).toEqual({
      accountId: "acc-1",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      filename: "abaco-main-checking-2026-10.csv",
      text: CSV,
      mimeType: "text/csv",
      title: "abaco-main-checking-2026-10.csv",
    });
    expect(defaultShare).not.toHaveBeenCalled();
  });

  it("names the file after the filtered range and passes the dialog title", async () => {
    stub({ data: CSV });
    const share = vi.fn(async () => "shared");
    await runExport({
      api,
      account: ACCOUNT,
      range: "current",
      filters: { type: "expense", from: "2026-09-01", to: "2026-10-10" },
      share,
      now: NOW,
      title: "Export transactions",
    });
    expect(share.mock.calls[0][0]).toMatchObject({
      filename: "abaco-main-checking-2026-09-01_2026-10-10.csv",
      title: "Export transactions",
    });
    stub({ data: CSV });
    await runExport({ api, account: ACCOUNT, range: "all", share, now: NOW });
    expect(share.mock.calls[1][0].filename).toBe("abaco-main-checking-all.csv");
  });

  it('returns "empty" for a header-only body without sharing', async () => {
    stub({ data: `${HEADER}\r\n` });
    const share = vi.fn(async () => "shared");
    await expect(
      runExport({ api, account: ACCOUNT, range: "all", share }),
    ).resolves.toBe("empty");
    expect(share).not.toHaveBeenCalled();
  });

  it("propagates the share step's outcome and uses shareTextFile by default", async () => {
    stub({ data: CSV });
    defaultShare.mockImplementation(async () => "cancelled");
    await expect(
      runExport({ api, account: ACCOUNT, range: "all", now: NOW }),
    ).resolves.toBe("cancelled");
    expect(defaultShare).toHaveBeenCalledTimes(1);
    expect(defaultShare.mock.calls[0][0].filename).toBe(
      "abaco-main-checking-all.csv",
    );
  });

  it("rejects with the backend error text on a 500", async () => {
    stub({
      status: 500,
      data: '{"error":"boom"}',
      contentType: "application/json",
    });
    const share = vi.fn();
    let caught;
    try {
      await runExport({ api, account: ACCOUNT, range: "all", share });
    } catch (err) {
      caught = err;
    }
    expect(describeError(caught).text).toBe("boom");
    expect(share).not.toHaveBeenCalled();
  });
});
