import { describe, it, expect } from "vitest";
import {
  describeLoginError,
  describeMfaError,
  normalizeTotpCode,
  normalizeBackupCode,
  isCompleteCode,
  nextPathAfterSignIn,
} from "./authFlow.js";

// A t() stub with i18next's defaultValue semantics: known keys resolve,
// unknown keys fall back to options.defaultValue, then to the key itself.
const KNOWN = {
  "login.invalid": "That email or password isn't right.",
  "login.tooMany": "Too many attempts. Wait 15 minutes and try again.",
  "login.genericError": "Something went wrong. Please try again.",
  "mobile.common.offline": "You're offline",
  "mobile.common.offlineHint":
    "Some things will wait until you're back online.",
};
const t = (key, opts) => KNOWN[key] ?? opts?.defaultValue ?? key;

const http = (status, data) => ({ response: { status, data } });
const network = { code: "ERR_NETWORK", message: "Network Error", request: {} };

describe("describeLoginError", () => {
  it("401 → invalid credentials, shown inline", () => {
    const d = describeLoginError(
      http(401, { error: "Invalid email or password" }),
      t,
    );
    expect(d.kind).toBe("invalid");
    expect(d.text).toBe(KNOWN["login.invalid"]);
    expect(d.title).toBeNull();
  });

  it("429 → tooMany headline plus the limiter's own sentence", () => {
    const body = "Too many login attempts. Please try again in 15 minutes.";
    const d = describeLoginError(http(429, { error: body }), t);
    expect(d.kind).toBe("tooMany");
    expect(d.title).toBe(KNOWN["login.tooMany"]);
    expect(d.text).toBe(body);
  });

  it("no HTTP response → network", () => {
    const d = describeLoginError(network, t);
    expect(d.kind).toBe("network");
    expect(d.title).toBe(KNOWN["mobile.common.offline"]);
    expect(d.text).toBe(KNOWN["mobile.common.offlineHint"]);
  });

  it("400 validation → generic with the backend text", () => {
    const d = describeLoginError(
      http(400, { error: "Email and password are required" }),
      t,
    );
    expect(d.kind).toBe("generic");
    expect(d.text).toBe("Email and password are required");
  });

  it("5xx without a body → generic fallback copy", () => {
    const d = describeLoginError(http(500, {}), t);
    expect(d.kind).toBe("generic");
    expect(d.text).toBe(KNOWN["login.genericError"]);
  });
});

describe("describeMfaError", () => {
  it("400 /expired/i → expired (back to the password step)", () => {
    const body = "Sign-in step expired — enter your password again";
    const d = describeMfaError(http(400, { error: body }), t);
    expect(d.kind).toBe("expired");
    // login.mfaExpired is not in KNOWN → falls back to the backend text.
    expect(d.text).toBe(body);
  });

  it("400 'Invalid sign-in state' also restarts the flow", () => {
    const d = describeMfaError(
      http(400, { error: "Invalid sign-in state" }),
      t,
    );
    expect(d.kind).toBe("expired");
  });

  it("400 code mismatch → invalid", () => {
    const body = "That code didn't match — try again";
    const d = describeMfaError(http(400, { error: body }), t);
    expect(d.kind).toBe("invalid");
    expect(d.text).toBe(body);
  });

  it("uses the translated copy when login.codeInvalid exists", () => {
    const t2 = (key, opts) =>
      key === "login.codeInvalid" ? "Ese código no coincide." : t(key, opts);
    const d = describeMfaError(
      http(400, { error: "That code didn't match" }),
      t2,
    );
    expect(d.text).toBe("Ese código no coincide.");
  });

  it("429 → tooMany; network → network", () => {
    expect(describeMfaError(http(429, { error: "slow down" }), t).kind).toBe(
      "tooMany",
    );
    expect(describeMfaError(network, t).kind).toBe("network");
  });
});

describe("code normalisation", () => {
  it("TOTP keeps digits only, capped at 6", () => {
    expect(normalizeTotpCode("12 34 56")).toBe("123456");
    expect(normalizeTotpCode("1234567")).toBe("123456");
    expect(normalizeTotpCode("ab1")).toBe("1");
    expect(normalizeTotpCode(null)).toBe("");
  });

  it("backup codes lowercase, strip non-hex and re-insert the hyphen", () => {
    expect(normalizeBackupCode("AB12C-D3E4F")).toBe("ab12c-d3e4f");
    expect(normalizeBackupCode("ab12cd3e4f")).toBe("ab12c-d3e4f");
    expect(normalizeBackupCode(" ab 12c ")).toBe("ab12c");
    expect(normalizeBackupCode("gg12345")).toBe("12345");
    expect(normalizeBackupCode("ab12cd3e4f99")).toBe("ab12c-d3e4f");
  });

  it("isCompleteCode knows both formats", () => {
    expect(isCompleteCode("123456", "totp")).toBe(true);
    expect(isCompleteCode("12345", "totp")).toBe(false);
    expect(isCompleteCode("ab12c-d3e4f", "backup")).toBe(true);
    expect(isCompleteCode("ab12c-d3e4", "backup")).toBe(false);
  });
});

describe("nextPathAfterSignIn", () => {
  it("defaults to /scan", () => {
    expect(nextPathAfterSignIn(undefined)).toBe("/scan");
    expect(nextPathAfterSignIn({})).toBe("/scan");
  });

  it("returns to the interrupted in-app location, keeping its query", () => {
    expect(
      nextPathAfterSignIn({
        from: { pathname: "/receipts/5", search: "?x=1" },
      }),
    ).toBe("/receipts/5?x=1");
    expect(nextPathAfterSignIn({ from: "/assistant" })).toBe("/assistant");
  });

  it("never sends the user back to an auth route or off-site", () => {
    expect(nextPathAfterSignIn({ from: { pathname: "/login" } })).toBe("/scan");
    expect(nextPathAfterSignIn({ from: { pathname: "/mfa" } })).toBe("/scan");
    expect(nextPathAfterSignIn({ from: "//evil.example" })).toBe("/scan");
    expect(nextPathAfterSignIn({ from: "https://evil.example" })).toBe("/scan");
  });
});
