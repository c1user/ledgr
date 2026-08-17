/**
 * services/totp.js — RFC 6238 TOTP + RFC 4226 HOTP with node:crypto only.
 *
 * Implemented in-repo (≈60 lines) rather than pulling a dependency for what
 * is one HMAC and a truncation; tests/totp.test.mjs pins the implementation
 * to the official RFC 4226 test vectors. Parameters are the authenticator-app
 * defaults: SHA-1, 6 digits, 30-second step.
 */

import crypto from "crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (no padding) — the secret format authenticator apps take. */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New 160-bit secret, base32 — the string shown/QR-encoded during setup. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** RFC 4226 HOTP: HMAC-SHA1 over an 8-byte counter, dynamically truncated. */
export function hotp(key, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

/** Current TOTP code for a base32 secret (30s step by default). */
export function totp(secretBase32, timeMs = Date.now(), stepSeconds = 30) {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verify a submitted code against the secret, accepting ±window steps of
 * clock drift (default one step each way). Constant-time comparison.
 */
export function verifyTotp(
  secretBase32,
  code,
  { window = 1, timeMs = Date.now() } = {},
) {
  const submitted = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(submitted)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / 30);
  for (let offset = -window; offset <= window; offset++) {
    const expected = hotp(key, counter + offset);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) {
      return true;
    }
  }
  return false;
}

/** otpauth:// URI encoding the secret for authenticator-app QR codes. */
export function otpauthUrl(secretBase32, accountEmail, issuer = "Abaco") {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return (
    `otpauth://totp/${label}?secret=${secretBase32}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  );
}

/**
 * Backup codes: 8 random codes shown once; only SHA-256 digests are stored.
 * Unlike passwords these are 40-bit random strings that exist solely to be
 * compared, so a fast hash is appropriate — bcrypt here would just make
 * enabling 2FA take seconds.
 */
export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function hashBackupCode(code) {
  const normalized = String(code || "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
