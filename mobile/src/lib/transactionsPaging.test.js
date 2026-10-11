import { describe, it, expect } from "vitest";
import {
  TX_PAGE_SIZE,
  mergePages,
  nextOffset,
  normalizeTxRange,
  parseTxFilters,
  serializeTxFilters,
  txListParams,
  txQueryKey,
  unwrapTxPage,
} from "./transactionsPaging.js";

const ACCOUNT_ID = "8f0c2b1e-5d7a-4c3b-9e2f-1a6b7c8d9e0f";

const rowsOf = (n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `tx-${start + i}` }));

describe("txQueryKey / txListParams", () => {
  it('builds a stable key under the ["transactions"] prefix', () => {
    expect(
      txQueryKey(ACCOUNT_ID, { type: "income", from: "", to: "" }),
    ).toEqual([
      "transactions",
      "account",
      ACCOUNT_ID,
      { type: "income", from: "", to: "" },
    ]);
    // Missing filters normalise to empty strings (same key as "no filter").
    expect(txQueryKey(ACCOUNT_ID, undefined)).toEqual(
      txQueryKey(ACCOUNT_ID, { type: "", from: "", to: "" }),
    );
  });

  it("never sends empty filters and always sends accountId + paging", () => {
    expect(txListParams(ACCOUNT_ID, { type: "", from: "", to: "" }, 0)).toEqual(
      {
        accountId: ACCOUNT_ID,
        limit: TX_PAGE_SIZE,
        offset: 0,
      },
    );
    expect(txListParams(ACCOUNT_ID, undefined, 100)).toEqual({
      accountId: ACCOUNT_ID,
      limit: 50,
      offset: 100,
    });
    expect(
      txListParams(
        ACCOUNT_ID,
        { type: "expense", from: "2026-01-01", to: "2026-01-31" },
        50,
      ),
    ).toEqual({
      accountId: ACCOUNT_ID,
      limit: 50,
      offset: 50,
      type: "expense",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
  });
});

describe("unwrapTxPage", () => {
  it("reads the { transactions, total } envelope with a string-safe total", () => {
    const rows = rowsOf(2);
    expect(
      unwrapTxPage({ transactions: rows, total: "123", limit: 50, offset: 0 }),
    ).toEqual({ rows, total: 123 });
    expect(unwrapTxPage({ transactions: rows, total: undefined })).toEqual({
      rows,
      total: 2,
    });
  });

  it("tolerates a bare array", () => {
    const rows = rowsOf(3);
    expect(unwrapTxPage(rows)).toEqual({ rows, total: 3 });
  });

  it("turns garbage into an empty page", () => {
    expect(unwrapTxPage(null)).toEqual({ rows: [], total: 0 });
    expect(unwrapTxPage("nope")).toEqual({ rows: [], total: 0 });
    expect(unwrapTxPage({ transactions: "x", total: 4 })).toEqual({
      rows: [],
      total: 0,
    });
  });
});

describe("nextOffset", () => {
  it("advances by the rows received while more remain", () => {
    expect(nextOffset({ rows: rowsOf(50), total: 120 }, [], 0)).toBe(50);
    expect(nextOffset({ rows: rowsOf(50), total: 120 }, [], 50)).toBe(100);
  });

  it("stops at the filtered total", () => {
    expect(
      nextOffset({ rows: rowsOf(20), total: 120 }, [], 100),
    ).toBeUndefined();
    expect(nextOffset({ rows: rowsOf(50), total: 50 }, [], 0)).toBeUndefined();
  });

  it("stops on an empty or short page", () => {
    expect(nextOffset({ rows: [], total: 999 }, [], 100)).toBeUndefined();
    expect(nextOffset({ rows: rowsOf(7), total: 999 }, [], 0)).toBeUndefined();
    expect(nextOffset(undefined, [], 0)).toBeUndefined();
  });
});

describe("mergePages", () => {
  it("flattens pages in order and dedupes by id keeping the first copy", () => {
    const a = { id: "a", merchant: "first" };
    const aAgain = { id: "a", merchant: "shifted" };
    const b = { id: "b" };
    const c = { id: "c" };
    expect(mergePages([{ rows: [a, b] }, { rows: [aAgain, c] }])).toEqual([
      a,
      b,
      c,
    ]);
  });

  it("keeps id-less rows and ignores garbage", () => {
    const noId = { merchant: "x" };
    expect(
      mergePages([{ rows: [noId, null, "str", noId] }, undefined]),
    ).toEqual([noId, noId]);
    expect(mergePages(undefined)).toEqual([]);
  });
});

describe("parseTxFilters", () => {
  it("accepts only income|expense and real calendar dates", () => {
    const p = new URLSearchParams("type=expense&from=2026-01-01&to=2026-02-29");
    // 2026 is not a leap year → `to` is rejected.
    expect(parseTxFilters(p)).toEqual({
      type: "expense",
      from: "2026-01-01",
      to: "",
    });
    expect(
      parseTxFilters(new URLSearchParams("type=income&to=2024-02-29")),
    ).toEqual({ type: "income", from: "", to: "2024-02-29" });
  });

  it("rejects injection-shaped and malformed values", () => {
    const p = new URLSearchParams();
    p.set("type", "drop table transactions");
    p.set("from", "2026-13-01");
    p.set("to", "2026-1-5");
    expect(parseTxFilters(p)).toEqual({ type: "", from: "", to: "" });
    expect(parseTxFilters(new URLSearchParams("type=INCOME"))).toEqual({
      type: "",
      from: "",
      to: "",
    });
    expect(
      parseTxFilters(new URLSearchParams("from=2026-02-31T00:00:00")),
    ).toEqual({ type: "", from: "", to: "" });
  });

  it("tolerates a missing params object and plain objects", () => {
    expect(parseTxFilters(undefined)).toEqual({ type: "", from: "", to: "" });
    expect(parseTxFilters({ type: "income", from: 5, to: null })).toEqual({
      type: "income",
      from: "",
      to: "",
    });
  });
});

describe("serializeTxFilters", () => {
  it("omits empty values and round-trips through parseTxFilters", () => {
    const filters = { type: "income", from: "2026-03-01", to: "2026-03-31" };
    const params = serializeTxFilters(filters);
    expect(params.toString()).toBe("type=income&from=2026-03-01&to=2026-03-31");
    expect(parseTxFilters(params)).toEqual(filters);

    expect(serializeTxFilters({ type: "", from: "", to: "" }).toString()).toBe(
      "",
    );
    expect(serializeTxFilters(undefined).toString()).toBe("");
    expect(serializeTxFilters({ type: "expense" }).toString()).toBe(
      "type=expense",
    );
    expect(parseTxFilters(serializeTxFilters({ from: "2026-01-01" }))).toEqual({
      type: "",
      from: "2026-01-01",
      to: "",
    });
  });
});

describe("normalizeTxRange", () => {
  it("swaps a reversed range and reports it", () => {
    expect(normalizeTxRange({ from: "2026-03-31", to: "2026-03-01" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
      swapped: true,
    });
  });

  it("leaves ordered, one-sided and empty ranges alone", () => {
    expect(normalizeTxRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
      swapped: false,
    });
    expect(normalizeTxRange({ from: "2026-03-31", to: "" })).toEqual({
      from: "2026-03-31",
      to: "",
      swapped: false,
    });
    expect(normalizeTxRange(undefined)).toEqual({
      from: "",
      to: "",
      swapped: false,
    });
  });
});
