// CSV import into a bank account (ROADMAP-V6 2.15, spec §4). Framework-free
// apart from the DOM in pickCsvFile (injectable for tests): pick a file with
// a hidden <input type="file">, parse it with papaparse (loaded lazily so it
// stays out of the entry bundle), turn the @abaco/csv rows into the exact
// POST /api/transactions/import body and send it as ONE atomic batch.
//
// Limits are all client-side and all have copy (mobile.accounts.import.*):
// file ≤ 2 MB, parsed rows ≤ 2000, JSON body ≤ 900 KB. Rows the shared
// helpers skip (bad date, zero amount) are listed on screen and never sent.
import { IMPORT_LIMITS, estimateJsonBytes } from "@abaco/csv";
import { describeError, isNetworkError } from "./apiErrors.js";

/**
 * The three MIME spellings matter: Android's ACTION_GET_CONTENT filters by
 * EXTRA_MIME_TYPES and Drive / Gmail / Files label CSVs differently.
 */
export const CSV_ACCEPT =
  ".csv,text/csv,text/comma-separated-values,text/plain";

/** A 2000-row batch books one ledger transaction per row — give it time. */
export const IMPORT_TIMEOUT_MS = 120_000;

/** Literal i18n keys for parseCsvFile rejections (`err.reason`). */
export const PARSE_ERROR_KEYS = Object.freeze({
  fileTooLarge: "mobile.accounts.import.fileTooLarge",
  tooManyRows: "mobile.accounts.import.tooManyRows",
  parse: "transactions.importParseError",
});

const importError = (reason, extra = {}) =>
  Object.assign(new Error(reason), { reason, ...extra });

/**
 * pickCsvFile(doc = document) → Promise<File | null>
 * Hidden <input type="file" accept={CSV_ACCEPT}> appended to the body;
 * resolves files[0] on "change", null on "cancel" (modern browsers fire it
 * when the picker closes empty) and removes itself either way. Works in the
 * Android Capacitor WebView, iOS WKWebView (Files picker) and the browser.
 */
export function pickCsvFile(
  doc = typeof document === "undefined" ? null : document,
) {
  return new Promise((resolve) => {
    if (!doc?.createElement || !doc.body) {
      resolve(null);
      return;
    }
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = CSV_ACCEPT;
    if (input.style) input.style.display = "none";
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      input.remove?.();
      resolve(file || null);
    };
    input.addEventListener("change", () => {
      const files = input.files;
      finish(files && files.length > 0 ? files[0] : null);
    });
    input.addEventListener("cancel", () => finish(null));
    doc.body.appendChild(input);
    input.click();
  });
}

/**
 * parseCsvFile(file) → Promise<{ fields, data }>
 * Rejects with `{ reason: "fileTooLarge" }` above IMPORT_LIMITS.maxFileBytes,
 * `{ reason: "parse" }` on a papaparse error / no header / no rows, and
 * `{ reason: "tooManyRows", count }` above IMPORT_LIMITS.maxRows. The header
 * is trimmed and a UTF-8 BOM stripped (transformHeader), empty lines are
 * dropped ("greedy"). The text is read through Blob#text() when available
 * (every WebView we ship to; also Node's File in tests) and handed to Papa
 * as a string — the File path needs FileReader, which Node lacks.
 */
export async function parseCsvFile(file) {
  if (!file) throw importError("parse");
  if (Number(file.size) > IMPORT_LIMITS.maxFileBytes) {
    throw importError("fileTooLarge");
  }
  const { default: Papa } = await import("papaparse");
  const input = typeof file.text === "function" ? await file.text() : file;
  return new Promise((resolve, reject) => {
    const settle = (results) => {
      const fields = (results?.meta?.fields || []).filter(Boolean);
      const data = Array.isArray(results?.data) ? results.data : [];
      if (fields.length === 0 || data.length === 0) {
        reject(importError("parse"));
        return;
      }
      if (data.length > IMPORT_LIMITS.maxRows) {
        reject(importError("tooManyRows", { count: data.length }));
        return;
      }
      resolve({ fields, data });
    };
    try {
      Papa.parse(input, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) =>
          String(h)
            .replace(/^\uFEFF/, "")
            .trim(),
        complete: settle,
        error: () => reject(importError("parse")),
      });
    } catch {
      reject(importError("parse"));
    }
  });
}

/**
 * The request body, EXACTLY as the backend expects it: an operational bank
 * account (`accountId`, never `fundingCoaId`) and rows that carry merchant /
 * notes only when non-empty.
 */
export function buildImportBody(accountId, rows, skipDuplicates) {
  return {
    accountId,
    rows: (Array.isArray(rows) ? rows : []).map(
      ({ date, amount, merchant, notes }) => ({
        date,
        amount,
        ...(merchant ? { merchant } : {}),
        ...(notes ? { notes } : {}),
      }),
    ),
    skipDuplicates,
  };
}

/** True when the JSON body would exceed the phone's send limit (900 KB). */
export function bodyTooLarge(body) {
  return estimateJsonBytes(body) > IMPORT_LIMITS.maxBodyBytes;
}

/**
 * runImport(api, body, { timeout }) → Promise<{ imported, skipped, total }>
 * One atomic batch; the backend rolls everything back on any failure.
 */
export function runImport(api, body, { timeout = IMPORT_TIMEOUT_MS } = {}) {
  return api
    .post("/transactions/import", body, { timeout })
    .then((r) => r.data);
}

/** The `errors[{ row, error }]` of a 400 "Some rows are invalid", else []. */
export function extractRowErrors(err) {
  const errors = describeError(err).details?.errors;
  return Array.isArray(errors) ? errors : [];
}

/** Statuses a proxy / load balancer answers with when it gave up waiting. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * True when the batch's fate is unknown: the request got no response at all
 * (offline, client timeout), or a 5xx that did not come from the handler. The
 * handler's own 500 always carries `{ error: string }` after a ROLLBACK, so a
 * 502/503/504, or any 5xx without that body, means a gateway timed out while
 * the backend may still be committing — the rows may well be booked.
 */
export function isUnconfirmedImportError(err) {
  if (isNetworkError(err)) return true;
  const status = err?.response?.status;
  if (typeof status !== "number" || status < 500) return false;
  if (GATEWAY_STATUSES.has(status)) return true;
  return typeof err.response?.data?.error !== "string";
}

/**
 * Options for re-sending after a failure. An unconfirmed failure (network,
 * timeout, gateway 5xx) may have committed on the server, so the retry
 * forces skipDuplicates (the backend dedupes on date + cents + merchant +
 * account) and locks the toggle.
 */
export function importRetryOptions(err, opts = {}) {
  if (isUnconfirmedImportError(err)) {
    return { ...opts, skipDuplicates: true, forcedSkip: true };
  }
  return { ...opts };
}
