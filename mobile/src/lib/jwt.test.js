import { describe, it, expect } from "vitest";
import {
  decodeJwtExp,
  decodeJwtUserId,
  isExpired,
  expiresWithin,
} from "./jwt.js";

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const makeToken = (payload) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;

const now = () => Math.floor(Date.now() / 1000);

describe("decodeJwtExp", () => {
  it("reads exp (epoch seconds) from the payload without verifying", () => {
    const exp = now() + 3600;
    expect(decodeJwtExp(makeToken({ id: 1, exp }))).toBe(exp);
  });

  it("handles base64url payloads that need padding", () => {
    // A payload whose base64 length is not a multiple of 4.
    const exp = 1700000000;
    const token = makeToken({ exp, a: "x" });
    expect(token.split(".")[1].length % 4).not.toBe(0);
    expect(decodeJwtExp(token)).toBe(exp);
  });

  it("returns null for garbage, missing exp or non-JWT strings", () => {
    expect(decodeJwtExp(null)).toBeNull();
    expect(decodeJwtExp("")).toBeNull();
    expect(decodeJwtExp("abc")).toBeNull();
    expect(decodeJwtExp("a.b.c")).toBeNull();
    expect(decodeJwtExp(makeToken({ id: 1 }))).toBeNull();
    expect(decodeJwtExp(makeToken({ exp: "soon" }))).toBeNull();
  });
});

describe("decodeJwtUserId", () => {
  it("reads the backend's userId claim as a string", () => {
    expect(decodeJwtUserId(makeToken({ userId: 42, exp: 1 }))).toBe("42");
    expect(decodeJwtUserId(makeToken({ userId: "abc" }))).toBe("abc");
  });

  it("returns null when there is no userId or the token is unreadable", () => {
    expect(decodeJwtUserId(null)).toBeNull();
    expect(decodeJwtUserId("a.b.c")).toBeNull();
    expect(decodeJwtUserId(makeToken({ id: 1 }))).toBeNull();
    expect(decodeJwtUserId(makeToken({ userId: null }))).toBeNull();
  });
});

describe("isExpired", () => {
  it("is false for a token valid well beyond the skew", () => {
    expect(isExpired(makeToken({ exp: now() + 7 * 86400 }))).toBe(false);
  });

  it("is true once exp has passed", () => {
    expect(isExpired(makeToken({ exp: now() - 10 }))).toBe(true);
  });

  it("treats a token inside the skew window as expired", () => {
    expect(isExpired(makeToken({ exp: now() + 30 }))).toBe(true); // 60 s skew
    expect(isExpired(makeToken({ exp: now() + 30 }), 0)).toBe(false);
  });

  it("treats unreadable tokens as expired", () => {
    expect(isExpired("nope")).toBe(true);
    expect(isExpired(undefined)).toBe(true);
  });
});

describe("expiresWithin", () => {
  it("flags a token that expires inside the window", () => {
    const token = makeToken({ exp: now() + 12 * 3600 });
    expect(expiresWithin(token, 24 * 3600)).toBe(true);
    expect(expiresWithin(token, 3600)).toBe(false);
  });

  it("flags unreadable tokens", () => {
    expect(expiresWithin("x.y", 10)).toBe(true);
  });
});
