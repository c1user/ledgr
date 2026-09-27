// Pure helpers for the sign-in screens (no React, no DOM) — tested in
// authFlow.test.js. Screens call these instead of reading err.response
// themselves, and the code inputs normalise through them so what we POST is
// exactly what the backend's verifyTotp / hashBackupCode expect.
import { isNetworkError } from "../../lib/apiErrors.js";

const backendText = (err) => {
  const e = err?.response?.data?.error;
  return typeof e === "string" ? e.trim() : "";
};

/**
 * describeLoginError(err, t) → { kind, title, text, status }
 *   kind: "invalid"  401 — bad email/password (shown inline, no redirect)
 *         "tooMany"  429 — auth limiter (10 failures / 15 min / IP)
 *         "network"  no HTTP response (offline, DNS, timeout)
 *         "generic"  anything else (400 validation text, 5xx, …)
 *   title: optional headline; text: body copy (translated or the backend's own).
 */
export function describeLoginError(err, t) {
  const status = err?.response?.status ?? null;
  const body = backendText(err);

  if (isNetworkError(err)) {
    return {
      kind: "network",
      title: t("mobile.common.offline"),
      text: t("mobile.common.offlineHint"),
      status,
    };
  }
  if (status === 401) {
    return { kind: "invalid", title: null, text: t("login.invalid"), status };
  }
  if (status === 429) {
    // Our translated headline + the limiter's own sentence as the detail.
    return { kind: "tooMany", title: t("login.tooMany"), text: body, status };
  }
  return {
    kind: "generic",
    title: null,
    text: body || t("login.genericError"),
    status,
  };
}

// Backend 400s on /auth/2fa/verify-login that mean "start over at the
// password step": the 5-minute mfaToken lapsed, or the account's 2FA state
// changed under us ("Invalid sign-in state").
const RESTART_RE = /expired|sign-in state/i;

/**
 * describeMfaError(err, t) → { kind, title, text, status }
 *   kind: "expired"  400 matching /expired/i → toast + back to /login
 *         "invalid"  other 400 — the code did not match
 *         "tooMany"  429
 *         "network"  offline
 *         "generic"  anything else
 */
export function describeMfaError(err, t) {
  const status = err?.response?.status ?? null;
  const body = backendText(err);

  if (isNetworkError(err)) {
    return {
      kind: "network",
      title: t("mobile.common.offline"),
      text: t("mobile.common.offlineHint"),
      status,
    };
  }
  if (status === 429) {
    return { kind: "tooMany", title: t("login.tooMany"), text: body, status };
  }
  if (status === 400 && RESTART_RE.test(body)) {
    return {
      kind: "expired",
      title: null,
      text: t("login.mfaExpired", { defaultValue: body }),
      status,
    };
  }
  if (status === 400) {
    return {
      kind: "invalid",
      title: null,
      text: t("login.codeInvalid", {
        defaultValue: body || t("login.genericError"),
      }),
      status,
    };
  }
  return {
    kind: "generic",
    title: null,
    text: body || t("login.genericError"),
    status,
  };
}

export const TOTP_LENGTH = 6;
export const BACKUP_HEX_LENGTH = 10; // displayed as xxxxx-xxxxx

/** Digits only, capped at 6 — what verifyTotp accepts (it strips spaces). */
export const normalizeTotpCode = (raw) =>
  String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, TOTP_LENGTH);

/**
 * Backup codes are 10 lowercase hex chars shown as "xxxxx-xxxxx". The backend
 * lowercases and strips non-hex before hashing, so we mirror that and
 * re-insert the hyphen for display.
 */
export const normalizeBackupCode = (raw) => {
  const hex = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .slice(0, BACKUP_HEX_LENGTH);
  return hex.length > 5 ? `${hex.slice(0, 5)}-${hex.slice(5)}` : hex;
};

/** True once the (normalised) code can be submitted for the given mode. */
export const isCompleteCode = (value, mode) =>
  mode === "backup"
    ? String(value ?? "").replace(/-/g, "").length === BACKUP_HEX_LENGTH
    : String(value ?? "").length === TOTP_LENGTH;

// Routes a signed-in user must never be sent back to.
const NOT_A_DESTINATION = new Set(["/login", "/mfa", "/update-required"]);

/**
 * Where to go after sign-in. RequireAuth stores the interrupted location as
 * router state ({ from: Location }) when it bounces to /login; honour it for
 * in-app paths so an expired session returns to the receipt the user had
 * open. Anything else → /scan (the home tab).
 */
export function nextPathAfterSignIn(state) {
  const from = state?.from;
  const pathname = typeof from === "string" ? from : from?.pathname;
  if (
    typeof pathname !== "string" ||
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    NOT_A_DESTINATION.has(pathname)
  ) {
    return "/scan";
  }
  const search =
    typeof from === "object" && typeof from.search === "string"
      ? from.search
      : "";
  return pathname + search;
}
