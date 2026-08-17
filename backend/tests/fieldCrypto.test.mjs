import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptField, decryptField } from "../src/services/fieldCrypto.js";

const TEST_KEY = crypto.randomBytes(32).toString("hex");

beforeEach(() => {
  process.env.PAYROLL_ENC_KEY = TEST_KEY;
});

test("roundtrip returns the original plaintext", () => {
  const blob = encryptField("123456789");
  assert.equal(decryptField(blob), "123456789");
});

test("each encryption is unique (random IV) yet decrypts identically", () => {
  const a = encryptField("123456789");
  const b = encryptField("123456789");
  assert.notEqual(a, b);
  assert.equal(decryptField(a), decryptField(b));
});

test("stored form is three base64 segments, no plaintext leakage", () => {
  const blob = encryptField("123456789");
  assert.equal(blob.split(".").length, 3);
  assert.ok(!blob.includes("123456789"));
});

test("tampered ciphertext fails to decrypt (GCM auth)", () => {
  const blob = encryptField("123456789");
  const parts = blob.split(".");
  const ct = Buffer.from(parts[2], "base64");
  ct[0] ^= 0xff;
  parts[2] = ct.toString("base64");
  assert.throws(() => decryptField(parts.join(".")));
});

test("wrong key fails to decrypt", () => {
  const blob = encryptField("123456789");
  process.env.PAYROLL_ENC_KEY = crypto.randomBytes(32).toString("hex");
  assert.throws(() => decryptField(blob));
});

test("missing key fails closed with a clear message", () => {
  delete process.env.PAYROLL_ENC_KEY;
  assert.throws(() => encryptField("123456789"), /PAYROLL_ENC_KEY/);
});

test("malformed key length is rejected", () => {
  process.env.PAYROLL_ENC_KEY = "abcd";
  assert.throws(() => encryptField("123456789"), /64 hex/);
});

test("malformed blob is rejected", () => {
  assert.throws(() => decryptField("not-a-blob"), /Malformed/);
});

test("empty plaintext is rejected", () => {
  assert.throws(() => encryptField(""), /non-empty/);
});
