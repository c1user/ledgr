// Contract tests for @abaco/csv. The first block pins the verbatim web lifts
// against copies of the helpers as they were inline in
// frontend/src/pages/Transactions.jsx (so the swap stays behaviour-identical);
// the rest cover the mobile extensions, including a round trip through the
// backend's exact export format. Run: npm test  (node:test + papaparse)
import { test } from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import dayjs from "dayjs";
import {
  normalizeDate,
  parseAmount,
  guessColumn,
  COLUMN_GUESSES,
  buildRows,
  IMPORT_LIMITS,
  isCalendarDate,
  IMPORT_COLUMN_GUESSES,
  guessImportColumns,
  buildImportRows,
  columnSamples,
  estimateJsonBytes,
  exportFilename,
  EXPORT_HEADER,
} from "./index.js";

// ── Reference copies of the web's former inline helpers ───────
// (Transactions.jsx before the swap — kept here so a "harmless" edit to the
// lifted versions shows up as a diff against the original behaviour.)
function webNormalizeDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}
function webParseAmount(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.-]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}
const webBuildRows = (data, mapping, negate) =>
  data
    .map((r) => ({
      date: webNormalizeDate(r[mapping.date]),
      merchant: (r[mapping.description] ?? "").toString().trim(),
      amount: (negate ? -1 : 1) * webParseAmount(r[mapping.amount]),
    }))
    .filter((r) => r.date && Number.isFinite(r.amount) && r.amount !== 0);

// The phone's Papa.parse config (mobile/src/lib/csvImport.js) for strings.
const transformHeader = (h) => h.replace(/^\uFEFF/, "").trim();
const parse = (text) =>
  Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader,
  });

// ── Verbatim web lifts ────────────────────────────────────────

test("normalizeDate: ISO passthrough, US slash/dash, dayjs fallback, garbage", () => {
  assert.equal(normalizeDate("2026-09-01"), "2026-09-01");
  assert.equal(normalizeDate("9/1/2026"), "2026-09-01");
  assert.equal(normalizeDate("09-01-2026"), "2026-09-01");
  assert.equal(normalizeDate(" 12/31/2025 "), "2025-12-31");
  assert.equal(normalizeDate("Sep 1 2026"), "2026-09-01");
  assert.equal(normalizeDate("not a date"), "");
  assert.equal(normalizeDate(""), "");
  assert.equal(normalizeDate(null), "");
  assert.equal(normalizeDate(undefined), "");
});

test("parseAmount: currency symbols, thousands, parentheses, negatives, empties", () => {
  assert.equal(parseAmount("$1,234.56"), 1234.56);
  assert.equal(parseAmount("(45.00)"), -45);
  assert.equal(parseAmount("-45"), -45);
  assert.equal(parseAmount(" 12 "), 12);
  assert.equal(parseAmount(-7.5), -7.5);
  assert.ok(Number.isNaN(parseAmount("")));
  assert.ok(Number.isNaN(parseAmount(null)));
  assert.ok(Number.isNaN(parseAmount(undefined)));
  assert.ok(Number.isNaN(parseAmount("abc")));
});

test("normalizeDate/parseAmount match the web's original helpers cell for cell", () => {
  const dates = [
    "2026-09-01",
    "9/1/2026",
    "09-01-2026",
    "1/2/2026",
    "Sep 1 2026",
    "2026-02-31",
    "",
    null,
    undefined,
    0,
    "garbage",
  ];
  for (const d of dates)
    assert.equal(normalizeDate(d), webNormalizeDate(d), String(d));
  const amounts = [
    "$1,234.56",
    "(45.00)",
    "-45",
    "1.234,56",
    "",
    null,
    undefined,
    "abc",
    "0",
    "-0",
    42,
    "($12.30)",
  ];
  for (const a of amounts) {
    const got = parseAmount(a);
    const want = webParseAmount(a);
    if (Number.isNaN(want)) assert.ok(Number.isNaN(got), String(a));
    else assert.equal(got, want, String(a));
  }
});

test("guessColumn returns the first matching header or an empty string", () => {
  assert.equal(guessColumn(["Fecha", "Date"], COLUMN_GUESSES.date), "Fecha");
  assert.equal(guessColumn(["A", "B"], COLUMN_GUESSES.date), "");
});

test("COLUMN_GUESSES are the web's exact patterns", () => {
  assert.equal(COLUMN_GUESSES.date.source, "date|fecha");
  assert.equal(
    COLUMN_GUESSES.description.source,
    "desc|memo|narration|payee|concept|merchant|name",
  );
  assert.equal(
    COLUMN_GUESSES.amount.source,
    "amount|amt|debit|monto|importe|value",
  );
  for (const re of Object.values(COLUMN_GUESSES)) assert.equal(re.flags, "i");
});

test("buildRows equals the web's inline behaviour on a mixed fixture", () => {
  const data = [
    { Date: "2026-09-01", Description: " Coffee ", Amount: "$4.50" },
    { Date: "9/2/2026", Description: "Refund", Amount: "(10.00)" },
    { Date: "", Description: "no date", Amount: "1" },
    { Date: "2026-09-03", Description: "zero", Amount: "0" },
    { Date: "2026-09-04", Description: "nan", Amount: "abc" },
    { Date: "Sep 5 2026", Description: "", Amount: "12" },
    {
      Date: "2026-02-31",
      Description: "web keeps impossible dates",
      Amount: "1",
    },
  ];
  const mapping = {
    date: "Date",
    description: "Description",
    amount: "Amount",
  };
  for (const negate of [false, true]) {
    assert.deepEqual(
      buildRows(data, mapping, negate),
      webBuildRows(data, mapping, negate),
    );
  }
  const rows = buildRows(data, mapping, false);
  assert.deepEqual(rows[0], {
    date: "2026-09-01",
    merchant: "Coffee",
    amount: 4.5,
  });
  assert.deepEqual(rows[1], {
    date: "2026-09-02",
    merchant: "Refund",
    amount: -10,
  });
  // 7 fixture rows minus no-date, zero and NaN; the ISO-shaped 2026-02-31 stays.
  assert.equal(rows.length, 4);
  assert.equal(buildRows(data, mapping, true)[0].amount, -4.5);
});

// ── Mobile extensions ─────────────────────────────────────────

test("IMPORT_LIMITS and EXPORT_HEADER carry the agreed values", () => {
  assert.deepEqual(
    { ...IMPORT_LIMITS },
    {
      maxRows: 2000,
      maxFileBytes: 2097152,
      maxBodyBytes: 900000,
      merchantMax: 255,
      notesMax: 500,
    },
  );
  assert.deepEqual(
    [...EXPORT_HEADER],
    ["Date", "Merchant", "Category", "Account", "Type", "Amount", "Notes"],
  );
});

test("isCalendarDate accepts real days only", () => {
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2026-02-31"), false);
  assert.equal(isCalendarDate("2023-02-29"), false);
  assert.equal(isCalendarDate("2026-13-01"), false);
  assert.equal(isCalendarDate("2026-04-31"), false);
  assert.equal(isCalendarDate("2026-1-1"), false);
  assert.equal(isCalendarDate("2026-01-01T00:00:00.000Z"), false);
  assert.equal(isCalendarDate(""), false);
  assert.equal(isCalendarDate(null), false);
  assert.equal(isCalendarDate(20260101), false);
});

test("guessImportColumns: English and Spanish single-amount headers", () => {
  assert.deepEqual(guessImportColumns(["Date", "Description", "Amount"]), {
    mode: "single",
    date: "Date",
    description: "Description",
    amount: "Amount",
    debit: "",
    credit: "",
    notes: "",
  });
  const es = guessImportColumns(["Fecha", "Concepto", "Importe"]);
  assert.equal(es.mode, "single");
  assert.equal(es.date, "Fecha");
  assert.equal(es.description, "Concepto");
  assert.equal(es.amount, "Importe");
});

test("guessImportColumns: Debit + Credit without an amount column → debitCredit", () => {
  const g = guessImportColumns([
    "Date",
    "Description",
    "Debit",
    "Credit",
    "Balance",
  ]);
  assert.equal(g.mode, "debitCredit");
  assert.equal(g.debit, "Debit");
  assert.equal(g.credit, "Credit");
  assert.equal(g.amount, "");
  // "Debit Amount"/"Credit Amount" pairs are not swallowed by the amount pattern.
  const pair = guessImportColumns([
    "Posted Date",
    "Payee",
    "Debit Amount",
    "Credit Amount",
  ]);
  assert.equal(pair.mode, "debitCredit");
  assert.equal(pair.date, "Posted Date");
  assert.equal(pair.description, "Payee");
  assert.equal(pair.debit, "Debit Amount");
  assert.equal(pair.credit, "Credit Amount");
  assert.equal(pair.amount, "");
  // An explicit amount column keeps single mode even when debit/credit exist.
  const mixed = guessImportColumns([
    "Date",
    "Memo",
    "Amount",
    "Debit",
    "Credit",
  ]);
  assert.equal(mixed.mode, "single");
  assert.equal(mixed.amount, "Amount");
  // Only one of the pair → still single, amount left for the user to pick.
  assert.equal(
    guessImportColumns(["Date", "Description", "Debit"]).mode,
    "single",
  );
});

test("guessImportColumns: our own export header maps date/description/amount/notes", () => {
  const g = guessImportColumns([...EXPORT_HEADER]);
  assert.deepEqual(g, {
    mode: "single",
    date: "Date",
    description: "Merchant",
    amount: "Amount",
    debit: "",
    credit: "",
    notes: "Notes",
  });
});

test("guessImportColumns: each header is claimed by at most one role", () => {
  const g = guessImportColumns(["Date", "Amount"]);
  assert.equal(g.date, "Date");
  assert.equal(g.amount, "Amount");
  assert.equal(g.description, "");
  const roles = Object.entries(g).filter(([k, v]) => k !== "mode" && v);
  assert.equal(new Set(roles.map(([, v]) => v)).size, roles.length);
  assert.deepEqual(guessImportColumns([]), guessImportColumns(undefined));
});

test("IMPORT_COLUMN_GUESSES cover the bilingual spellings", () => {
  assert.ok(IMPORT_COLUMN_GUESSES.debit.test("Débito"));
  assert.ok(IMPORT_COLUMN_GUESSES.debit.test("Retiro"));
  assert.ok(IMPORT_COLUMN_GUESSES.credit.test("Crédito"));
  assert.ok(IMPORT_COLUMN_GUESSES.credit.test("Depósito"));
  assert.ok(IMPORT_COLUMN_GUESSES.notes.test("Referencia"));
  assert.ok(IMPORT_COLUMN_GUESSES.notes.test("Nota"));
  assert.ok(!IMPORT_COLUMN_GUESSES.notes.test("Notable"));
  assert.ok(IMPORT_COLUMN_GUESSES.description.test("Beneficiario"));
});

const MAP = { date: "Date", description: "Description", amount: "Amount" };

test("buildImportRows: skipped rows carry 1-based numbers and a reason", () => {
  const data = [
    { Date: "", Description: "no date", Amount: "1" },
    { Date: "2026-02-31", Description: "bad date", Amount: "1" },
    { Date: "2026-09-03", Description: "no amount", Amount: "" },
    { Date: "2026-09-04", Description: "nan amount", Amount: "n/a" },
    { Date: "2026-09-05", Description: "zero", Amount: "0.00" },
    { Date: "2026-09-06", Description: "neg zero", Amount: "-0" },
    { Date: "2026-09-07", Description: "ok", Amount: "-12.34" },
  ];
  const { rows, skipped, stats } = buildImportRows(data, MAP);
  assert.deepEqual(skipped, [
    { row: 1, reason: "noDate" },
    { row: 2, reason: "badDate" },
    { row: 3, reason: "noAmount" },
    { row: 4, reason: "noAmount" },
    { row: 5, reason: "zeroAmount" },
    { row: 6, reason: "zeroAmount" },
  ]);
  assert.deepEqual(rows, [
    { date: "2026-09-07", amount: -12.34, merchant: "ok" },
  ]);
  assert.equal(stats.total, 7);
  assert.equal(stats.valid, 1);
  assert.equal(
    stats.total,
    stats.valid + skipped.length + stats.duplicatesInFile,
  );
});

test("buildImportRows: negate flips every sign", () => {
  const data = [
    { Date: "2026-09-01", Description: "a", Amount: "10" },
    { Date: "2026-09-02", Description: "b", Amount: "(5.00)" },
  ];
  const plain = buildImportRows(data, MAP);
  const flipped = buildImportRows(data, MAP, { negate: true });
  assert.deepEqual(
    plain.rows.map((r) => r.amount),
    [10, -5],
  );
  assert.deepEqual(
    flipped.rows.map((r) => r.amount),
    [-10, 5],
  );
  assert.equal(flipped.stats.income.sum, 5);
  assert.equal(flipped.stats.expense.sum, 10);
});

test("buildImportRows: debitCredit mode = credit − debit, missing cell = 0", () => {
  const map = {
    date: "Date",
    description: "Payee",
    debit: "Debit",
    credit: "Credit",
  };
  const data = [
    { Date: "2026-09-01", Payee: "Grocer", Debit: "45.00", Credit: "" },
    { Date: "2026-09-02", Payee: "Client", Debit: "", Credit: "$1,000.00" },
    { Date: "2026-09-03", Payee: "Net", Debit: "20", Credit: "30" },
    { Date: "2026-09-04", Payee: "Both empty", Debit: "", Credit: "" },
    { Date: "2026-09-05", Payee: "Cancels", Debit: "10", Credit: "10" },
  ];
  const { rows, skipped } = buildImportRows(data, map, { mode: "debitCredit" });
  assert.deepEqual(
    rows.map((r) => [r.merchant, r.amount]),
    [
      ["Grocer", -45],
      ["Client", 1000],
      ["Net", 10],
    ],
  );
  assert.deepEqual(skipped, [
    { row: 4, reason: "noAmount" },
    { row: 5, reason: "zeroAmount" },
  ]);
  const negated = buildImportRows(data, map, {
    mode: "debitCredit",
    negate: true,
  });
  assert.equal(negated.rows[0].amount, 45);
  // Single mode ignores the debit/credit columns entirely.
  assert.equal(buildImportRows(data, map).skipped.length, 5);
});

test("buildImportRows: merchant trimmed, omitted when empty, cut to 255 with a warning", () => {
  const long = "x".repeat(300);
  const data = [
    { Date: "2026-09-01", Description: "  Café  ", Amount: "1" },
    { Date: "2026-09-02", Description: "", Amount: "2" },
    { Date: "2026-09-03", Description: long, Amount: "3" },
    { Date: "2026-09-04", Amount: "4" },
  ];
  const { rows, stats, warnings } = buildImportRows(data, MAP);
  assert.equal(rows[0].merchant, "Café");
  assert.equal("merchant" in rows[1], false);
  assert.equal(rows[2].merchant.length, IMPORT_LIMITS.merchantMax);
  assert.equal("merchant" in rows[3], false);
  assert.equal(stats.truncated, 1);
  assert.deepEqual(warnings, ["truncated"]);
  // No description column mapped → never a merchant key.
  const bare = buildImportRows(data, { date: "Date", amount: "Amount" });
  assert.ok(bare.rows.every((r) => !("merchant" in r)));
});

test("buildImportRows: notes only when mapped, trimmed and cut to 500", () => {
  const data = [
    { Date: "2026-09-01", Description: "a", Amount: "1", Notes: "  memo  " },
    { Date: "2026-09-02", Description: "b", Amount: "2", Notes: "" },
    {
      Date: "2026-09-03",
      Description: "c",
      Amount: "3",
      Notes: "y".repeat(600),
    },
  ];
  const without = buildImportRows(data, MAP);
  assert.ok(without.rows.every((r) => !("notes" in r)));
  const withNotes = buildImportRows(data, { ...MAP, notes: "Notes" });
  assert.equal(withNotes.rows[0].notes, "memo");
  assert.equal("notes" in withNotes.rows[1], false);
  assert.equal(withNotes.rows[2].notes.length, IMPORT_LIMITS.notesMax);
  // Notes truncation is silent (the warning counts merchants only).
  assert.equal(withNotes.stats.truncated, 0);
  assert.deepEqual(withNotes.warnings, []);
});

test("buildImportRows: stats carry cents-rounded sums and the date range", () => {
  const data = [
    { Date: "2026-09-10", Description: "a", Amount: "0.1" },
    { Date: "2026-09-01", Description: "b", Amount: "0.2" },
    { Date: "2026-09-20", Description: "c", Amount: "-0.3" },
    { Date: "9/15/2026", Description: "d", Amount: "(1,000.005)" },
  ];
  const { stats } = buildImportRows(data, MAP);
  assert.deepEqual(stats.income, { count: 2, sum: 0.3 });
  assert.deepEqual(stats.expense, { count: 2, sum: 1000.31 });
  assert.equal(stats.minDate, "2026-09-01");
  assert.equal(stats.maxDate, "2026-09-20");
  const empty = buildImportRows([], MAP);
  assert.deepEqual(empty, {
    rows: [],
    skipped: [],
    stats: {
      total: 0,
      valid: 0,
      income: { count: 0, sum: 0 },
      expense: { count: 0, sum: 0 },
      minDate: "",
      maxDate: "",
      duplicatesInFile: 0,
      truncated: 0,
    },
    warnings: [],
  });
});

test("buildImportRows: in-file duplicates keep the first copy only", () => {
  const data = [
    { Date: "2026-09-01", Description: "Coffee", Amount: "3.50" },
    { Date: "2026-09-01", Description: "Coffee", Amount: "3.50" },
    { Date: "2026-09-01", Description: "Coffee", Amount: "3.51" },
    { Date: "2026-09-01", Description: "coffee", Amount: "3.50" },
    { Date: "2026-09-01", Description: "Coffee", Amount: "$3.50" },
  ];
  const { rows, stats, warnings } = buildImportRows(data, MAP);
  assert.equal(rows.length, 3);
  assert.equal(stats.duplicatesInFile, 2);
  assert.equal(stats.valid, 3);
  assert.equal(stats.income.count, 3);
  assert.deepEqual(warnings, ["duplicatesInFile"]);
  assert.equal(stats.total, stats.valid + stats.duplicatesInFile);
});

test("buildImportRows: dedupeInFile: false keeps identical rows (two same-day charges)", () => {
  const data = [
    { Date: "2026-09-01", Description: "Coffee", Amount: "-3.50" },
    { Date: "2026-09-01", Description: "Coffee", Amount: "-3.50" },
    { Date: "2026-09-01", Description: "Coffee", Amount: "-3.50" },
    { Date: "2026-09-02", Description: "", Amount: "" }, // still skipped
  ];
  const { rows, skipped, stats, warnings } = buildImportRows(data, MAP, {
    dedupeInFile: false,
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], rows[0]);
  assert.deepEqual(skipped, [{ row: 4, reason: "noAmount" }]);
  assert.equal(stats.duplicatesInFile, 0);
  assert.equal(stats.valid, 3);
  assert.deepEqual(stats.expense, { count: 3, sum: 10.5 });
  assert.deepEqual(warnings, []);
  assert.equal(stats.total, stats.valid + skipped.length);
  // The default still dedupes.
  assert.equal(buildImportRows(data, MAP).rows.length, 1);
  assert.equal(buildImportRows(data, MAP).stats.duplicatesInFile, 2);
});

test("buildImportRows: all-income / all-expense warnings need five valid rows", () => {
  const income = (n) =>
    Array.from({ length: n }, (_, i) => ({
      Date: "2026-09-01",
      Description: `in ${i}`,
      Amount: "10",
    }));
  assert.deepEqual(buildImportRows(income(4), MAP).warnings, []);
  assert.deepEqual(buildImportRows(income(5), MAP).warnings, ["allIncome"]);
  assert.deepEqual(buildImportRows(income(5), MAP, { negate: true }).warnings, [
    "allExpense",
  ]);
  const mixed = [
    ...income(5),
    { Date: "2026-09-02", Description: "out", Amount: "-1" },
  ];
  assert.deepEqual(buildImportRows(mixed, MAP).warnings, []);
});

test("buildImportRows: tolerates a missing mapping and non-object records", () => {
  const data = [null, 42, { Date: "2026-09-01", Amount: "1" }];
  const { rows, skipped } = buildImportRows(data, undefined);
  assert.deepEqual(rows, []);
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["noDate", "noDate", "noDate"],
  );
  assert.deepEqual(buildImportRows(undefined, MAP).rows, []);
});

test("columnSamples: first non-empty cell within the window, cut to maxLen", () => {
  const data = [
    { A: "", B: "  first  ", C: "x".repeat(50) },
    { A: "second-row", B: "ignored", C: "" },
    { A: "late", B: "", C: "" },
  ];
  const samples = columnSamples(data, ["A", "B", "C", "Missing"]);
  assert.equal(samples.A, "second-row");
  assert.equal(samples.B, "first");
  assert.equal(samples.C.length, 40);
  assert.ok(samples.C.endsWith("…"));
  assert.equal(samples.Missing, "");
  assert.deepEqual(columnSamples(data, ["A"], { rows: 1 }), { A: "" });
  assert.equal(columnSamples(data, ["C"], { maxLen: 10 }).C, "xxxxxxxxx…");
  assert.deepEqual(columnSamples(undefined, undefined), {});
});

test("estimateJsonBytes counts UTF-8 bytes of the serialized body", () => {
  assert.equal(estimateJsonBytes({ a: 1 }), '{"a":1}'.length);
  assert.equal(estimateJsonBytes("é"), 4); // "\"é\"" → 1 + 2 + 1 bytes
  assert.equal(estimateJsonBytes([]), 2);
  const big = { rows: Array.from({ length: 10 }, () => ({ x: "y" })) };
  assert.equal(estimateJsonBytes(big), JSON.stringify(big).length);
});

test("exportFilename: month, year, custom, one-sided and all-time ranges", () => {
  const now = new Date(2026, 9, 10);
  const name = "Banco Popular Checking";
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      now,
    }),
    "abaco-banco-popular-checking-2026-09.csv",
  );
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2024-02-01",
      endDate: "2024-02-29",
      now,
    }),
    "abaco-banco-popular-checking-2024-02.csv",
  );
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      now,
    }),
    "abaco-banco-popular-checking-2026.csv",
  );
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2026-01-15",
      endDate: "2026-02-14",
      now,
    }),
    "abaco-banco-popular-checking-2026-01-15_2026-02-14.csv",
  );
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2026-01-01",
      endDate: "2026-01-30",
      now,
    }),
    "abaco-banco-popular-checking-2026-01-01_2026-01-30.csv",
  );
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      now,
    }),
    "abaco-banco-popular-checking-2026-01-01_2027-12-31.csv",
  );
  assert.equal(
    exportFilename({ accountName: name, now }),
    "abaco-banco-popular-checking-all.csv",
  );
  assert.equal(
    exportFilename({ accountName: name, startDate: "2026-06-01", now }),
    "abaco-banco-popular-checking-2026-06-01_2026-10-10.csv",
  );
  assert.equal(
    exportFilename({ accountName: name, endDate: "2026-06-30", now }),
    "abaco-banco-popular-checking-all_2026-06-30.csv",
  );
  // Dates that are not calendar-valid count as unset.
  assert.equal(
    exportFilename({
      accountName: name,
      startDate: "2026-02-31",
      endDate: "junk",
      now,
    }),
    "abaco-banco-popular-checking-all.csv",
  );
});

test("exportFilename: account slug is lowercase ASCII, dashed, capped at 40", () => {
  assert.equal(
    exportFilename({ accountName: "El Fogón Criollo — Caja #2" }),
    "abaco-el-fogon-criollo-caja-2-all.csv",
  );
  assert.equal(exportFilename({ accountName: "" }), "abaco-all-all.csv");
  assert.equal(exportFilename({}), "abaco-all-all.csv");
  assert.equal(exportFilename({ accountName: "***" }), "abaco-all-all.csv");
  const long = exportFilename({ accountName: "word ".repeat(20) });
  const slug = long.slice("abaco-".length, -"-all.csv".length);
  assert.ok(slug.length <= 40, slug);
  assert.ok(!slug.endsWith("-"), slug);
  assert.ok(!slug.startsWith("-"), slug);
});

// ── Round trip through the backend's exact export format ──────

const EXPORT_FIXTURE = [
  EXPORT_HEADER.join(","),
  '2026-09-03,"Café ""La Plaza""",Meals,Banco Popular Checking,expense,-45.00,"Lunch, team"',
  "2026-09-01,Cliente ABC,Sales Revenue,Banco Popular Checking,income,1250.00,",
  "2026-08-30,,Other Expense,Banco Popular Checking,expense,-12.50,",
  '2026-08-29,"Multi\r\nline",Other Expense,Banco Popular Checking,expense,-1.25,',
].join("\r\n");

test("round trip: the backend's export parses back into identical signed rows", () => {
  const res = parse(EXPORT_FIXTURE);
  assert.deepEqual(res.errors, []);
  const fields = res.meta.fields.filter(Boolean);
  assert.deepEqual(fields, [...EXPORT_HEADER]);
  assert.equal(res.data.length, 4);
  assert.equal(res.data[2].Category, "Other Expense");

  const mapping = guessImportColumns(fields);
  assert.equal(mapping.mode, "single");
  const { rows, skipped, stats, warnings } = buildImportRows(res.data, mapping);
  assert.deepEqual(skipped, []);
  assert.deepEqual(rows, [
    {
      date: "2026-09-03",
      amount: -45,
      merchant: 'Café "La Plaza"',
      notes: "Lunch, team",
    },
    { date: "2026-09-01", amount: 1250, merchant: "Cliente ABC" },
    { date: "2026-08-30", amount: -12.5 },
    { date: "2026-08-29", amount: -1.25, merchant: "Multi\r\nline" },
  ]);
  assert.deepEqual(stats.income, { count: 1, sum: 1250 });
  assert.deepEqual(stats.expense, { count: 3, sum: 58.75 });
  assert.equal(stats.minDate, "2026-08-29");
  assert.equal(stats.maxDate, "2026-09-03");
  assert.deepEqual(warnings, []);
  // The web's lift sees the same file the same way (merchant kept as "").
  assert.deepEqual(
    buildRows(res.data, mapping, false).map((r) => [
      r.date,
      r.amount,
      r.merchant,
    ]),
    rows.map((r) => [r.date, r.amount, r.merchant ?? ""]),
  );
});

test("round trip: a BOM-prefixed header is stripped by transformHeader", () => {
  const res = parse(`\uFEFF${EXPORT_FIXTURE}`);
  const fields = res.meta.fields.filter(Boolean);
  assert.equal(fields[0], "Date");
  assert.deepEqual(fields, [...EXPORT_HEADER]);
  const mapping = guessImportColumns(fields);
  assert.equal(mapping.date, "Date");
  assert.equal(buildImportRows(res.data, mapping).rows[0].date, "2026-09-03");
  // Papa strips a leading BOM itself; the transform also covers one that
  // survives on a header cell and trims padding.
  assert.equal(transformHeader(`\uFEFF Date `), "Date");
  assert.equal(transformHeader("Amount"), "Amount");
});

test("round trip: a typical bank file with blank trailing lines parses greedily", () => {
  const bank = [
    "Posted Date,Payee,Debit,Credit,Balance",
    "09/02/2026,ACH DEPOSIT CLIENTE ABC,,1250.00,5000.00",
    '09/03/2026,"POS PURCHASE CAFE ""LA PLAZA""",45.00,,4955.00',
    "",
    ",,,,",
    "",
  ].join("\n");
  const res = parse(bank);
  assert.equal(res.data.length, 2);
  const mapping = guessImportColumns(res.meta.fields.filter(Boolean));
  assert.equal(mapping.mode, "debitCredit");
  const { rows } = buildImportRows(res.data, mapping, { mode: mapping.mode });
  assert.deepEqual(rows, [
    { date: "2026-09-02", amount: 1250, merchant: "ACH DEPOSIT CLIENTE ABC" },
    {
      date: "2026-09-03",
      amount: -45,
      merchant: 'POS PURCHASE CAFE "LA PLAZA"',
    },
  ]);
});
