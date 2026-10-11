// Maps backend failures to something a screen can render. Screens never read
// err.response.data themselves — they call describeError(err, t) and switch
// on `kind`, or show `text` / t(messageKey, details).
//
// Backend contract (ROADMAP-V6 1.8):
//   403 { code: "UPGRADE_REQUIRED", feature, plan, requiredPlan, limit, used }
//   413 { code: "FILE_TOO_LARGE", limitBytes }
//   415 { code: "UNSUPPORTED_TYPE", allowed: [...] }
//   429 { error }                      rate limited (auth, uploads, AI chat)
//   409 { code: "RECEIPT_LINKED" }     already linked to a transaction
//   404 / 400 { error }
//   400 { error, errors: [{ row, error }] }   CSV import row rejections
//   no response at all                 offline / DNS / timeout → outbox

/** True when the request never got an HTTP response (offline, timeout). */
export const isNetworkError = (err) =>
  !!err &&
  !err.response &&
  (err.code === "ERR_NETWORK" ||
    err.code === "ECONNABORTED" ||
    err.code === "ETIMEDOUT" ||
    err.message === "Network Error" ||
    !!err.request);

const UPSELL_KEY = {
  ai_chat: "mobile.upsell.assistantPremium",
  ai_receipts: "mobile.upsell.scansLimit",
};

/**
 * describeError(err, t, opts?) → {
 *   kind: "upgrade" | "tooLarge" | "unsupported" | "rateLimited" | "network"
 *       | "validation" | "notFound" | "conflict" | "unknown",
 *   messageKey?: string,   // i18n key when the copy is ours
 *   text: string,          // ready-to-render message (t(messageKey) or the
 *                          // backend's own text)
 *   details: object,       // code-specific fields (feature, limit, used,
 *                          // errors[] for 400 row rejections, …)
 *   status: number | null,
 * }
 * `t` is optional; without it `text` falls back to the backend text / key.
 * opts.rateLimitedKey — the i18n key for a 429 without backend text. The
 * default is the Scan copy (uploads); the Accounts screens pass the neutral
 * "mobile.common.rateLimited" (ERR_OPTS) because they never upload.
 */
export function describeError(
  err,
  t,
  { rateLimitedKey = "mobile.scan.rateLimited" } = {},
) {
  const tr = (key, opts) => (typeof t === "function" ? t(key, opts) : key);
  const status = err?.response?.status ?? null;
  const data = err?.response?.data || {};
  const backendText = typeof data.error === "string" ? data.error : "";
  const code = data.code;

  if (isNetworkError(err)) {
    return {
      kind: "network",
      messageKey: "mobile.common.offlineHint",
      text: tr("mobile.common.offlineHint"),
      details: {},
      status,
    };
  }

  if (status === 403 && code === "UPGRADE_REQUIRED") {
    const details = {
      feature: data.feature,
      plan: data.plan,
      requiredPlan: data.requiredPlan,
      limit: data.limit ?? null,
      used: data.used ?? null,
    };
    const messageKey = UPSELL_KEY[data.feature] || "upgrade.locked";
    return {
      kind: "upgrade",
      messageKey,
      text: tr(messageKey, { limit: details.limit, used: details.used }),
      details,
      status,
    };
  }

  if (status === 413 || code === "FILE_TOO_LARGE") {
    return {
      kind: "tooLarge",
      messageKey: "mobile.scan.tooLarge",
      text: tr("mobile.scan.tooLarge"),
      details: { limitBytes: data.limitBytes ?? null },
      status,
    };
  }

  if (status === 415 || code === "UNSUPPORTED_TYPE") {
    return {
      kind: "unsupported",
      messageKey: "mobile.scan.unsupported",
      text: tr("mobile.scan.unsupported"),
      details: { allowed: Array.isArray(data.allowed) ? data.allowed : [] },
      status,
    };
  }

  if (status === 429) {
    return {
      kind: "rateLimited",
      messageKey: rateLimitedKey,
      text: backendText || tr(rateLimitedKey),
      details: {},
      status,
    };
  }

  if (status === 409 || code === "RECEIPT_LINKED") {
    return {
      kind: "conflict",
      messageKey: "mobile.review.errors.alreadyLinked",
      text: tr("mobile.review.errors.alreadyLinked"),
      details: { code },
      status,
    };
  }

  if (status === 404) {
    return {
      kind: "notFound",
      messageKey: "mobile.review.errors.notFound",
      text: backendText || tr("mobile.review.errors.notFound"),
      details: {},
      status,
    };
  }

  if (status === 400 || status === 422) {
    // Backend validation messages are shown as-is (e.g. "A categoryId or
    // splits[] is required", AI-chat injection rejections). The CSV import
    // ("Some rows are invalid") also lists the rejected rows in errors[].
    return {
      kind: "validation",
      messageKey: null,
      text: backendText || tr("login.genericError"),
      details: {
        code,
        errors: Array.isArray(data.errors) ? data.errors : undefined,
      },
      status,
    };
  }

  return {
    kind: "unknown",
    messageKey: "login.genericError",
    text: backendText || tr("login.genericError"),
    details: { code },
    status,
  };
}

export default describeError;
