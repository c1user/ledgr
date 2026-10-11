// @abaco/csv — framework-free CSV import/export helpers shared by the web app
// (frontend/) and the phone (mobile/). Input is Papa.parse output with
// header: true ({ meta.fields, data }); output is the row shape that
// POST /api/transactions/import accepts ({ date, amount, merchant?, notes? }).
//
// Two layers live here on purpose:
//   1. VERBATIM lifts of the web's former inline helpers
//      (frontend/src/pages/Transactions.jsx). The web imports these and they
//      must stay behaviour-identical — do not "improve" them here.
//   2. Mobile extensions with stricter rules (calendar-valid dates, skipped
//      row reasons, debit/credit columns, client-side limits, export
//      filenames). The web does not use them.
import dayjs from "dayjs";

// ── 1. Verbatim web lifts ──────────────────────────────────────

/**
 * Normalize a bank date cell to YYYY-MM-DD. Handles ISO already, US
 * MM/DD/YYYY (slash or dash), and falls back to dayjs parsing; "" when the
 * cell is empty or unreadable.
 */
export function normalizeDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}

/** Parse a bank amount cell: strips $/commas, treats (123.45) as negative. */
export function parseAmount(v) {
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

/** First header matching `re`, or "" when none does. */
export function guessColumn(fields, re) {
  return fields.find((f) => re.test(f)) || "";
}

/** The web's column-guess patterns (header → role), unchanged. */
export const COLUMN_GUESSES = {
  date: /date|fecha/i,
  description: /desc|memo|narration|payee|concept|merchant|name/i,
  amount: /amount|amt|debit|monto|importe|value/i,
};

/**
 * The web's import rows: every parsed record mapped through the column
 * mapping, keeping only rows with a date and a finite non-zero amount.
 * `mapping` = { date, description, amount } (header names, "" = unmapped).
 */
export function buildRows(data, mapping, negate) {
  return data
    .map((r) => ({
      date: normalizeDate(r[mapping.date]),
      merchant: (r[mapping.description] ?? "").toString().trim(),
      amount: (negate ? -1 : 1) * parseAmount(r[mapping.amount]),
    }))
    .filter((r) => r.date && Number.isFinite(r.amount) && r.amount !== 0);
}

// ── 2. Mobile extensions ───────────────────────────────────────

/** Client-side limits for a phone import (the backend caps rows at 2000). */
export const IMPORT_LIMITS = Object.freeze({
  maxRows: 2000,
  maxFileBytes: 2 * 1024 * 1024,
  maxBodyBytes: 900_000,
  merchantMax: 255,
  notesMax: 500,
});

/**
 * True for a `YYYY-MM-DD` string that names a real calendar day, so
 * "2026-02-31" never reaches the API.
 */
export function isCalendarDate(s) {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
  );
}

/** Wider, bilingual header patterns for the phone, with debit/credit roles. */
export const IMPORT_COLUMN_GUESSES = {
  date: /date|fecha|posted|booked/i,
  description:
    /desc|memo|narration|payee|concept|merchant|name|detalle|beneficiario/i,
  amount: /^amount$|amount|amt|monto|importe|value|valor|cantidad/i,
  debit: /debit|d[ée]bito|cargo|retiro|withdraw/i,
  credit: /credit|cr[ée]dito|abono|dep[oó]sito|deposit/i,
  notes: /^notes?$|^notas?$|reference|referencia/i,
};

// Claim order. Debit and credit are claimed BEFORE amount so a
// "Debit Amount" / "Credit Amount" pair is not swallowed by the amount
// pattern; every header is claimed by at most one role.
const CLAIM_ORDER = [
  "date",
  "description",
  "debit",
  "credit",
  "amount",
  "notes",
];

/**
 * Guess the column mapping for a header row.
 * → { mode: "single"|"debitCredit", date, description, amount, debit, credit, notes }
 * (header names, "" = not found). `mode` is "debitCredit" only when both a
 * debit and a credit header matched and no amount header did.
 */
export function guessImportColumns(fields) {
  const unclaimed = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const out = {
    mode: "single",
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    notes: "",
  };
  for (const role of CLAIM_ORDER) {
    const hit = guessColumn(unclaimed, IMPORT_COLUMN_GUESSES[role]);
    if (hit) {
      out[role] = hit;
      unclaimed.splice(unclaimed.indexOf(hit), 1);
    }
  }
  if (out.debit && out.credit && !out.amount) out.mode = "debitCredit";
  return out;
}

const isBlank = (v) => v == null || String(v).trim() === "";

// A cell's amount, or null when the cell is empty/unreadable.
const cellAmount = (v) => {
  if (isBlank(v)) return null;
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : null;
};

const toCents = (n) => Math.round(n * 100);

/**
 * Build the rows a phone import will send, plus everything the screen needs
 * to explain them.
 *
 * → {
 *   rows: [{ date, amount, merchant?, notes? }]            // what gets sent
 *   skipped: [{ row, reason }]                              // 1-based rows;
 *       reason ∈ "noDate" | "badDate" | "noAmount" | "zeroAmount"
 *   stats: { total, valid, income: { count, sum }, expense: { count, sum },
 *            minDate, maxDate, duplicatesInFile, truncated }
 *   warnings: Array<"allIncome"|"allExpense"|"duplicatesInFile"|"truncated">
 * }
 *
 * Rules: date = normalizeDate + isCalendarDate; amount = the single column via
 * parseAmount, or credit − debit in "debitCredit" mode (a missing cell counts
 * as 0); `negate` flips the sign; the amount must be finite and non-zero.
 * merchant is trimmed, omitted when empty and cut to 255 (counted in
 * `truncated`); notes only when `mapping.notes` is set, trimmed, cut to 500.
 * With `dedupeInFile` (the default, mirroring the backend's skipDuplicates),
 * rows equal on date + amount + merchant beyond the first are dropped and
 * counted in `duplicatesInFile`; with `dedupeInFile: false` every such row
 * is kept (two identical same-day charges are legitimate) and
 * `duplicatesInFile` is 0. `valid` = rows.length, so
 * total = valid + skipped.length + duplicatesInFile. Sums are cents-rounded
 * magnitudes (the expense sum is positive).
 */
export function buildImportRows(
  data,
  mapping,
  { negate = false, mode = "single", dedupeInFile = true } = {},
) {
  const list = Array.isArray(data) ? data : [];
  const map = mapping || {};
  const rows = [];
  const skipped = [];
  const income = { count: 0, cents: 0 };
  const expense = { count: 0, cents: 0 };
  const seen = new Set();
  let minDate = "";
  let maxDate = "";
  let truncated = 0;
  let duplicatesInFile = 0;

  list.forEach((r, i) => {
    const row = i + 1;
    const rec = r && typeof r === "object" ? r : {};
    const cell = (role) => (map[role] ? rec[map[role]] : undefined);

    const rawDate = cell("date");
    if (isBlank(rawDate)) {
      skipped.push({ row, reason: "noDate" });
      return;
    }
    const date = normalizeDate(rawDate);
    if (!date || !isCalendarDate(date)) {
      skipped.push({ row, reason: "badDate" });
      return;
    }

    let amount;
    if (mode === "debitCredit") {
      const debit = cellAmount(cell("debit"));
      const credit = cellAmount(cell("credit"));
      if (debit == null && credit == null) {
        skipped.push({ row, reason: "noAmount" });
        return;
      }
      amount = (credit ?? 0) - (debit ?? 0);
    } else {
      amount = cellAmount(cell("amount"));
      if (amount == null) {
        skipped.push({ row, reason: "noAmount" });
        return;
      }
    }
    if (negate) amount = -amount;
    if (amount === 0) {
      skipped.push({ row, reason: "zeroAmount" });
      return;
    }

    const out = { date, amount };
    if (map.description) {
      let merchant = (cell("description") ?? "").toString().trim();
      if (merchant.length > IMPORT_LIMITS.merchantMax) {
        merchant = merchant.slice(0, IMPORT_LIMITS.merchantMax).trimEnd();
        truncated += 1;
      }
      if (merchant) out.merchant = merchant;
    }
    if (map.notes) {
      let notes = (cell("notes") ?? "").toString().trim();
      if (notes.length > IMPORT_LIMITS.notesMax) {
        notes = notes.slice(0, IMPORT_LIMITS.notesMax).trimEnd();
      }
      if (notes) out.notes = notes;
    }

    if (dedupeInFile) {
      const key = `${date}\u0000${amount}\u0000${out.merchant ?? ""}`;
      if (seen.has(key)) {
        duplicatesInFile += 1;
        return;
      }
      seen.add(key);
    }

    rows.push(out);
    const bucket = amount > 0 ? income : expense;
    bucket.count += 1;
    bucket.cents += toCents(Math.abs(amount));
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  });

  const valid = rows.length;
  const stats = {
    total: list.length,
    valid,
    income: { count: income.count, sum: income.cents / 100 },
    expense: { count: expense.count, sum: expense.cents / 100 },
    minDate,
    maxDate,
    duplicatesInFile,
    truncated,
  };
  const warnings = [];
  if (valid >= 5 && expense.count === 0) warnings.push("allIncome");
  if (valid >= 5 && income.count === 0) warnings.push("allExpense");
  if (duplicatesInFile > 0) warnings.push("duplicatesInFile");
  if (truncated > 0) warnings.push("truncated");
  return { rows, skipped, stats, warnings };
}

/**
 * One sample value per header for the column picker: the first non-empty
 * cell of that column within the first `rows` records, cut to `maxLen`
 * characters (with an ellipsis). "" when the column is empty throughout.
 */
export function columnSamples(data, fields, { rows = 20, maxLen = 40 } = {}) {
  const list = Array.isArray(data) ? data.slice(0, rows) : [];
  const out = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    let sample = "";
    for (const r of list) {
      const v = r && typeof r === "object" ? r[field] : undefined;
      if (!isBlank(v)) {
        sample = String(v).trim();
        break;
      }
    }
    out[field] =
      sample.length > maxLen ? `${sample.slice(0, maxLen - 1)}…` : sample;
  }
  return out;
}

/** UTF-8 byte size of `JSON.stringify(obj)` (TextEncoder: Node ≥ 18, browsers). */
export function estimateJsonBytes(obj) {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

// Lowercase ASCII slug: diacritics stripped, runs of non-alphanumerics → "-",
// no leading/trailing dashes, at most 40 characters.
const slug = (name) =>
  String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

const isWholeMonth = (start, end) => {
  const s = dayjs(start);
  return s.date() === 1 && s.endOf("month").isSame(dayjs(end), "day");
};
const isWholeYear = (start, end) =>
  dayjs(start).format("MM-DD") === "01-01" &&
  dayjs(end).format("MM-DD") === "12-31" &&
  dayjs(start).year() === dayjs(end).year();

/**
 * Filename for an exported CSV: `abaco-<account slug | all>-<range>.csv`.
 * `range` = `YYYY-MM` for exactly one calendar month, `YYYY` for exactly one
 * calendar year, `YYYY-MM-DD_YYYY-MM-DD` when both dates are set, `all` when
 * neither is. A one-sided range fills the open end with "all" (no start) or
 * today's date from `now` (no end). Dates that are not calendar-valid count
 * as unset.
 */
export function exportFilename({
  accountName,
  startDate,
  endDate,
  now = new Date(),
} = {}) {
  const start = isCalendarDate(startDate) ? startDate : "";
  const end = isCalendarDate(endDate) ? endDate : "";
  let range;
  if (!start && !end) range = "all";
  else if (start && end && isWholeMonth(start, end))
    range = dayjs(start).format("YYYY-MM");
  else if (start && end && isWholeYear(start, end))
    range = dayjs(start).format("YYYY");
  else range = `${start || "all"}_${end || dayjs(now).format("YYYY-MM-DD")}`;
  return `abaco-${slug(accountName) || "all"}-${range}.csv`;
}

/** Header row of GET /api/transactions/export, in order. */
export const EXPORT_HEADER = Object.freeze([
  "Date",
  "Merchant",
  "Category",
  "Account",
  "Type",
  "Amount",
  "Notes",
]);
