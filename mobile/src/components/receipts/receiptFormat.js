// Pure helpers shared by the Receipts list, ReceiptCard and ReceiptDetail.
// The backend returns NUMERIC columns as strings and DATE columns as ISO
// timestamps (see ROADMAP-V6 API contract), so every value is normalised
// here, at the edge, and the components only render.
import dayjs from "dayjs";

export const PAGE_SIZE = 50;

/** react-query key prefix for the list pages: ["receipts", <filter>]. */
export const RECEIPTS_QUERY_KEY = ["receipts"];

/** Same tones as the web's Receipts page (STATUS_TONES). */
export const STATUS_TONES = {
  pending: "expense",
  reviewed: "payroll",
  linked: "income",
};

/** Literal i18n keys per status (no key interpolation — grep-able). */
export const STATUS_LABEL_KEYS = {
  pending: "receipts.status.pending",
  reviewed: "receipts.status.reviewed",
  linked: "receipts.status.linked",
};

export const FILTERS = ["all", "pending", "reviewed", "linked"];

export const FILTER_LABEL_KEYS = {
  all: "mobile.receipts.filters.all",
  pending: "mobile.receipts.filters.pending",
  reviewed: "mobile.receipts.filters.reviewed",
  linked: "mobile.receipts.filters.linked",
};

export const statusTone = (status) => STATUS_TONES[status] || "neutral";

/** ?status= from the URL (the Scan page preselects) → a known filter. */
export const parseStatusFilter = (value) =>
  FILTERS.includes(value) ? value : "all";

/** "123.45" | 123.45 | null → number | null (NaN → null). */
export const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

const LOCALE_BY_LANG = { en: "en-US", es: "es-PR" };

/**
 * Money via Intl.NumberFormat(business.currency). Returns null when there is
 * no usable amount so callers can fall back to a translated placeholder.
 */
export const formatMoney = (value, currency = "USD", lang = "en") => {
  const n = toNumber(value);
  if (n === null) return null;
  const locale = LOCALE_BY_LANG[lang] || LOCALE_BY_LANG.en;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
    }).format(n);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
    }).format(n);
  }
};

/** ISO timestamp | "YYYY-MM-DD" | null → "MMM D, YYYY" | null. */
export const formatReceiptDate = (value) => {
  if (!value) return null;
  const d = dayjs(value);
  return d.isValid() ? d.format("MMM D, YYYY") : null;
};

/** "0.87" → 87 | null. */
export const confidencePct = (value) => {
  const n = toNumber(value);
  if (n === null) return null;
  return Math.round(Math.min(Math.max(n, 0), 1) * 100);
};

/**
 * A transaction references the receipt but the receipt never flipped to
 * "linked" (an interrupted link) → the list offers "Finish linking".
 */
export const isHalfLinked = (row) =>
  !!row && !!row.transaction_id && row.status !== "linked";

/** PDFs cannot render in <img>; the UI shows a document placeholder. */
export const isPdf = (row) => {
  const name = String(row?.original_filename || row?.s3_key || "");
  return /\.pdf$/i.test(name);
};

/** ai_line_items arrives as an array (JSONB) — tolerate null/garbage. */
export const lineItems = (row) =>
  Array.isArray(row?.ai_line_items)
    ? row.ai_line_items.filter((it) => it && typeof it === "object")
    : [];
