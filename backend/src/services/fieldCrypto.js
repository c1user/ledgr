/**
 * services/fieldCrypto.js — application-level field encryption at rest
 * (ROADMAP-V5 · Phase 2.2). First consumer: employee SSNs.
 *
 * AES-256-GCM with a random 96-bit IV per value; the auth tag makes any
 * ciphertext tampering a hard decrypt failure. Stored form is three
 * base64 segments: "iv.tag.ciphertext" in a TEXT column.
 *
 * Key: PAYROLL_ENC_KEY env var, 64 hex chars (32 bytes). Generate one:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Same custody rules as JWT_SECRET — and note the sharper edge: losing
 * this key loses every encrypted SSN permanently. Validation is lazy
 * (first use, not import) so the rest of the app boots without the key;
 * SSN writes fail closed with a clear message instead.
 *
 * Plaintext SSNs must never appear in logs, error reports, or audit
 * snapshots — see the ssn scrub in middleware/auditLog.js.
 */

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function getKey() {
  const raw = process.env.PAYROLL_ENC_KEY;
  if (!raw) {
    throw new Error(
      "PAYROLL_ENC_KEY env var is required for field encryption. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  const key = Buffer.from(raw.trim(), "hex");
  if (key.length !== 32) {
    throw new Error("PAYROLL_ENC_KEY must be 64 hex characters (32 bytes)");
  }
  return key;
}

/**
 * @param {string} plaintext
 * @returns {string} "iv.tag.ciphertext" (base64 segments)
 */
export function encryptField(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptField requires a non-empty string");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

/**
 * @param {string} blob - "iv.tag.ciphertext" as produced by encryptField
 * @returns {string} plaintext
 * @throws on wrong key, malformed blob, or any tampering (GCM auth)
 */
export function decryptField(blob) {
  const parts = typeof blob === "string" ? blob.split(".") : [];
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted field");
  }
  const key = getKey();
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
