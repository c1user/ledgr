// Reads the `exp` claim of the backend's HS256 JWT WITHOUT verifying it. The
// server remains the authority (a 401 still wins); this only lets the phone
// skip a doomed request and prompt re-login before the 7-day expiry.

const b64urlDecode = (part) => {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") {
    // Browser / Node ≥ 16: decode to a binary string, then to UTF-8.
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  throw new Error("No base64 decoder available");
};

/** decodeJwtPayload(token) → the (unverified) payload object, or null. */
function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/** decodeJwtExp(token) → exp as epoch SECONDS, or null when unreadable. */
export function decodeJwtExp(token) {
  const exp = Number(decodeJwtPayload(token)?.exp);
  return Number.isFinite(exp) && exp > 0 ? exp : null;
}

/**
 * decodeJwtUserId(token) → the backend's `userId` claim as a string, or null.
 * Used to stamp offline-outbox items with their owner even when GET /auth/me
 * could not run (stale / offline boot leaves authStore.user === null).
 */
export function decodeJwtUserId(token) {
  const id = decodeJwtPayload(token)?.userId;
  if (id === undefined || id === null || id === "") return null;
  return String(id);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * isExpired(token, skewSeconds = 60) — true when the token is unreadable or
 * expires within `skewSeconds` (clock drift + request latency margin).
 */
export function isExpired(token, skewSeconds = 60) {
  const exp = decodeJwtExp(token);
  if (exp === null) return true;
  return exp - skewSeconds <= nowSeconds();
}

/**
 * expiresWithin(token, seconds) — true when the token expires in less than
 * `seconds` from now (used by the resume watchdog: 24 h before the 7-day
 * expiry → prompt re-login). Unreadable tokens count as expiring.
 */
export function expiresWithin(token, seconds) {
  const exp = decodeJwtExp(token);
  if (exp === null) return true;
  return exp - nowSeconds() < seconds;
}
