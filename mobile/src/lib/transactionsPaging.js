// Pure helpers behind the per-account transaction list (ROADMAP-V6 2.15):
// react-query keys/params for GET /api/transactions, the page envelope,
// infinite-scroll offsets, page merging and the URL filter state of
// /accounts/:id?type=&from=&to=.
//
// The backend does not validate its query params, so NOTHING user-editable
// reaches the API unless it passed parseTxFilters() here first.
import { isCalendarDate } from "@abaco/csv";

export const TX_PAGE_SIZE = 50;

const TYPE_RE = /^(income|expense)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v) => (typeof v === "string" ? v : "");

/** ["transactions", "account", <id>, { type, from, to }] — the
 *  ["transactions"] prefix means ReceiptReview's post-booking invalidation
 *  refreshes these pages too. */
export function txQueryKey(accountId, filters) {
  const f = filters || {};
  return [
    "transactions",
    "account",
    accountId,
    { type: str(f.type), from: str(f.from), to: str(f.to) },
  ];
}

/** Query params for one page; empty filters are never sent. */
export function txListParams(accountId, filters, offset = 0) {
  const f = filters || {};
  const type = str(f.type);
  const from = str(f.from);
  const to = str(f.to);
  return {
    accountId,
    limit: TX_PAGE_SIZE,
    offset,
    ...(type && { type }),
    ...(from && { startDate: from }),
    ...(to && { endDate: to }),
  };
}

/**
 * GET /api/transactions answers { transactions, total, limit, offset }
 * (total is the filtered COUNT). A bare array is tolerated; anything else
 * is an empty page.
 */
export function unwrapTxPage(data) {
  if (Array.isArray(data)) return { rows: data, total: data.length };
  if (data && typeof data === "object" && Array.isArray(data.transactions)) {
    const rows = data.transactions;
    const total = Number(data.total);
    return { rows, total: Number.isFinite(total) ? total : rows.length };
  }
  return { rows: [], total: 0 };
}

/**
 * getNextPageParam for useInfiniteQuery: the next offset, or undefined once
 * the page was empty, short, or the filtered total has been reached.
 */
export function nextOffset(lastPage, _pages, lastOffset = 0) {
  const rows = Array.isArray(lastPage?.rows) ? lastPage.rows : [];
  if (rows.length === 0) return undefined;
  const next = (Number(lastOffset) || 0) + rows.length;
  const total = Number(lastPage?.total);
  if (Number.isFinite(total) && next >= total) return undefined;
  if (rows.length < TX_PAGE_SIZE) return undefined;
  return next;
}

/**
 * Flattens the pages into one row list, dropping repeats by id (a row that
 * shifted between pages after an insert/delete) and keeping the first copy.
 */
export function mergePages(pages) {
  const seen = new Set();
  const out = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = row.id;
      if (id !== undefined && id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(row);
    }
  }
  return out;
}

const read = (params, key) => {
  if (!params) return "";
  if (typeof params.get === "function") return str(params.get(key));
  return str(params[key]);
};

const validDate = (v) => (DATE_RE.test(v) && isCalendarDate(v) ? v : "");

/**
 * URLSearchParams (or a plain object) → { type, from, to } with strictly
 * validated values: type ∈ income|expense, dates YYYY-MM-DD naming a real
 * calendar day. Anything else becomes "".
 */
export function parseTxFilters(searchParams) {
  const type = read(searchParams, "type");
  return {
    type: TYPE_RE.test(type) ? type : "",
    from: validDate(read(searchParams, "from")),
    to: validDate(read(searchParams, "to")),
  };
}

/** { type, from, to } → URLSearchParams (empty values omitted). */
export function serializeTxFilters(filters) {
  const f = filters || {};
  const params = new URLSearchParams();
  const type = str(f.type);
  const from = str(f.from);
  const to = str(f.to);
  if (type) params.set("type", type);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params;
}

/**
 * Date range from the filter sheet's draft: when both ends are set and
 * from > to they are swapped (`swapped: true` so the sheet can say so).
 * ISO calendar strings compare lexicographically.
 */
export function normalizeTxRange(draft) {
  const from = str(draft?.from);
  const to = str(draft?.to);
  if (from && to && from > to) return { from: to, to: from, swapped: true };
  return { from, to, swapped: false };
}
