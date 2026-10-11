// CSV export of an account's transactions (ROADMAP-V6 2.15).
//
// GET /api/transactions/export?accountId&startDate&endDate&type answers
// `200 text/csv; charset=utf-8` (CRLF rows, header
// Date,Merchant,Category,Account,Type,Amount,Notes, signed amounts) or a
// `500 { error }` JSON body. The CSV is server-generated, so nothing here
// works offline; the sheet disables its CTA through useOnline().
//
// Pure except for `fetchCsv` (axios) and the injectable `share` step, so the
// node-env vitest suite covers the whole flow with an adapter stub.
import dayjs from "dayjs";
import { AxiosError } from "axios";
import { exportFilename } from "@abaco/csv";
import { shareTextFile } from "../native/share.js";

export const EXPORT_TIMEOUT_MS = 120_000;

/** Range presets the ExportSheet offers, in display order. */
export const EXPORT_RANGES = Object.freeze([
  "current",
  "thisMonth",
  "thisYear",
  "all",
]);

const DATE = "YYYY-MM-DD";
const TYPES = new Set(["income", "expense"]);

/**
 * exportParams({ accountId, range, filters, now })
 *   → { accountId, type?, startDate?, endDate? }
 * `range`: "current" carries filters.from / to / type as the list shows them;
 * "thisMonth" / "thisYear" are whole calendar periods around `now`; "all"
 * sends no dates. `accountId` is ALWAYS sent (operational accounts only).
 */
export function exportParams({
  accountId,
  range = "current",
  filters = {},
  now = new Date(),
} = {}) {
  const params = { accountId };
  const f = filters || {};
  if (range === "thisMonth") {
    params.startDate = dayjs(now).startOf("month").format(DATE);
    params.endDate = dayjs(now).endOf("month").format(DATE);
  } else if (range === "thisYear") {
    params.startDate = dayjs(now).startOf("year").format(DATE);
    params.endDate = dayjs(now).endOf("year").format(DATE);
  } else if (range !== "all") {
    if (TYPES.has(f.type)) params.type = f.type;
    if (f.from) params.startDate = f.from;
    if (f.to) params.endDate = f.to;
  }
  return params;
}

/** True for a 200 whose body the server labelled text/csv. */
export function isCsvResponse(res) {
  if (!res || res.status !== 200) return false;
  const type =
    res.headers?.["content-type"] ?? res.headers?.get?.("content-type");
  return /^text\/csv/i.test(String(type || ""));
}

/** Header line only (or nothing at all) → there is nothing to share. */
export function isEmptyCsv(text) {
  const lines = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  return !lines.slice(1).some((line) => line.trim() !== "");
}

// With responseType "text" axios leaves a JSON error body as a string;
// describeError() needs `response.data.error`, so parse it when possible.
function parseJsonBody(data) {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * fetchCsv(api, params) → the axios response (status 200, text/csv body).
 * Any other outcome rejects with an AxiosError whose `response.data` is the
 * parsed JSON body when the server sent one, so describeError() shows the
 * backend's own `error` text.
 */
export async function fetchCsv(api, params) {
  let res;
  try {
    res = await api.get("/transactions/export", {
      params,
      responseType: "text",
      timeout: EXPORT_TIMEOUT_MS,
    });
  } catch (err) {
    if (err?.response) err.response.data = parseJsonBody(err.response.data);
    throw err;
  }
  if (isCsvResponse(res)) return res;
  const response = { ...res, data: parseJsonBody(res?.data) };
  throw new AxiosError(
    "Unexpected export response",
    AxiosError.ERR_BAD_RESPONSE,
    res?.config,
    res?.request,
    response,
  );
}

/**
 * runExport({ api, account, range, filters, share, now, title })
 *   → "shared" | "downloaded" | "copied" | "cancelled" | "empty"
 * Fetches the CSV, bails out with "empty" on a header-only body, otherwise
 * hands `{ filename, text, mimeType, title }` to `share` (native/share.js
 * shareTextFile by default). `title` is the share sheet's dialog title.
 */
export async function runExport({
  api,
  account,
  range = "current",
  filters = {},
  share = shareTextFile,
  now = new Date(),
  title,
} = {}) {
  const params = exportParams({
    accountId: account?.id,
    range,
    filters,
    now,
  });
  const res = await fetchCsv(api, params);
  const text = typeof res.data === "string" ? res.data : String(res.data ?? "");
  if (isEmptyCsv(text)) return "empty";
  const filename = exportFilename({
    accountName: account?.name,
    startDate: params.startDate,
    endDate: params.endDate,
    now,
  });
  return share({
    filename,
    text,
    mimeType: "text/csv",
    title: title || filename,
  });
}

export default runExport;
