import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totp,
  verifyTotp,
  otpauthUrl,
  generateBackupCodes,
  hashBackupCode,
} from "../src/services/totp.js";

// RFC 4226 Appendix D test vectors: ASCII key "12345678901234567890",
// counters 0-9. If these pass, the HMAC + truncation core is correct.
const RFC4226_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC4226_CODES = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

test("hotp matches every RFC 4226 test vector", () => {
  RFC4226_CODES.forEach((expected, counter) => {
    assert.equal(hotp(RFC4226_KEY, counter), expected);
  });
});

test("totp derives the RFC 6238 counter from the timestamp", () => {
  // RFC 6238: T=59s with the SHA-1 20-byte key → counter 1.
  const secret = base32Encode(RFC4226_KEY);
  assert.equal(totp(secret, 59 * 1000), hotp(RFC4226_KEY, 1));
});

test("base32 round-trips arbitrary bytes", () => {
  const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
});

test("verifyTotp accepts the current and adjacent codes, rejects others", () => {
  const secret = generateSecret();
  const now = Date.now();
  assert.equal(verifyTotp(secret, totp(secret, now), { timeMs: now }), true);
  // One step behind (clock drift) still passes with the default window.
  assert.equal(
    verifyTotp(secret, totp(secret, now - 30_000), { timeMs: now }),
    true,
  );
  // Two steps behind falls outside the window.
  assert.equal(
    verifyTotp(secret, totp(secret, now - 90_000), { timeMs: now }),
    false,
  );
  assert.equal(verifyTotp(secret, "000000", { timeMs: now }), false);
  assert.equal(verifyTotp(secret, "not-a-code", { timeMs: now }), false);
});

test("otpauth URL carries the secret, issuer, and account", () => {
  const url = otpauthUrl("ABC234", "user@example.test");
  assert.ok(url.startsWith("otpauth://totp/Abaco%3Auser%40example.test?"));
  assert.ok(url.includes("secret=ABC234"));
  assert.ok(url.includes("issuer=Abaco"));
});

test("backup codes hash consistently regardless of formatting", () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, 8);
  assert.match(codes[0], /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  // Dashes, case, and whitespace are stripped before hashing.
  assert.equal(
    hashBackupCode(codes[0]),
    hashBackupCode(codes[0].toUpperCase().replace("-", " ")),
  );
  assert.notEqual(hashBackupCode(codes[0]), hashBackupCode(codes[1]));
});
