// Receipt upload (ROADMAP-V6 2.5): one multipart POST to /receipts/upload.
//
//   uploadReceipt({ blob, filename, idempotencyKey, onProgress, signal })
//     → the 201 row { id, ai_merchant, ai_date, ai_total (numeric string),
//       ai_line_items, ai_confidence (numeric string), status: "pending",
//       signed_url, … }
//
// Field names are the backend's: the file goes in "receipt" (with an explicit
// filename so Multer sees a proper extension and the blob's own MIME type),
// the optional "idempotencyKey" is a plain text field — NOT a header, the
// CORS allowedHeaders list would block one. The server accepts and ignores it
// today (v1.1 de-duplicates on it).
//
// Errors are the axios error; callers map them with describeUploadError()
// (lib/apiErrors.js) and decide: network → outbox, 403 UPGRADE_REQUIRED →
// UpsellNotice, 413 / 415 / 429 → toast.
import axios from "axios";
import api from "./api.js";
import { describeError, isNetworkError } from "./apiErrors.js";

// Upload + S3 + the AI read run inside the request (5–15 s on top of the
// transfer), so the instance default of 30 s is too tight on cellular.
export const UPLOAD_TIMEOUT_MS = 120 * 1000;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export async function uploadReceipt({
  blob,
  filename,
  idempotencyKey,
  onProgress,
  signal,
} = {}) {
  if (!blob) throw new Error("uploadReceipt: blob is required");
  const form = new FormData();
  form.append("receipt", blob, filename || `receipt-${stamp()}.jpg`);
  if (idempotencyKey) form.append("idempotencyKey", String(idempotencyKey));

  const { data } = await api.post("/receipts/upload", form, {
    signal,
    timeout: UPLOAD_TIMEOUT_MS,
    // No Content-Type here: axios drops it for FormData so the WebView sets
    // multipart/form-data with its own boundary.
    onUploadProgress:
      typeof onProgress === "function"
        ? (e) => {
            const total = e.total || blob.size || 0;
            const ratio = total > 0 ? Math.min(1, e.loaded / total) : null;
            onProgress(ratio, e);
          }
        : undefined,
  });
  return data;
}

/** True when the caller aborted the request through `signal`. */
export const isUploadCancelled = (err) =>
  !!err && (axios.isCancel(err) || err.code === "ERR_CANCELED");

/** True when no HTTP answer came back (offline / DNS / timeout) → outbox. */
export const shouldQueue = (err) =>
  !isUploadCancelled(err) && isNetworkError(err);

/** describeError() from lib/apiErrors.js, guarded against cancellations. */
export function describeUploadError(err, t) {
  if (isUploadCancelled(err)) {
    return {
      kind: "cancelled",
      messageKey: null,
      text: "",
      details: {},
      status: null,
    };
  }
  return describeError(err, t);
}

export default uploadReceipt;
