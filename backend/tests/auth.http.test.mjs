/**
 * tests/auth.http.test.mjs — the auth surface over real HTTP (§1.5):
 * register validation, login success/failure shapes, token integrity,
 * dead-business tokens, and the anti-enumeration behaviors.
 *
 * BUDGET: authLimiter (middleware/rateLimiter.js) counts every FAILED
 * /api/auth/* response — max 10 per 15-min window per IP, fresh store per
 * process. This suite spends exactly 9, so any new negative-path request
 * must either fit in the remaining 1 or exercise requireAuth through an
 * unthrottled route (/api/business) like the token tests below do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pool from "../src/config/db.js";
import {
  startTestServer,
  createTestBusiness,
  api,
  TEST_PASSWORD,
} from "./helpers/http.mjs";

let srv = null;
let biz = null;

const uniqueEmail = () =>
  `auth-${crypto.randomUUID().slice(0, 8)}@test.ledgr.local`;

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base);
  } catch (err) {
    console.log(`# auth: database not reachable — skipping (${err.message})`);
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

// ── Register validation ───────────────────────────────────────

test("register rejects missing required fields", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/auth/register", {
    method: "POST",
    body: {},
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "Business name, email, and password are required");
});

test("register requires explicit ToS consent", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // consent:false must behave like consent omitted — only `true` passes.
  const res = await api(srv.base, "/api/auth/register", {
    method: "POST",
    body: {
      businessName: "No Consent Co",
      email: uniqueEmail(),
      password: TEST_PASSWORD,
      consent: false,
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Terms of Service/);
});

test("register rejects a malformed email", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/auth/register", {
    method: "POST",
    body: {
      businessName: "Bad Email Co",
      email: "not-an-email",
      password: TEST_PASSWORD,
      consent: true,
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "Invalid email address");
});

test("register enforces the password policy", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // 15 chars but no uppercase — trips the complexity branch, and proves
  // length alone doesn't satisfy the policy for a financial-data app.
  const res = await api(srv.base, "/api/auth/register", {
    method: "POST",
    body: {
      businessName: "Weak Password Co",
      email: uniqueEmail(),
      password: "alllowercase123",
      consent: true,
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /uppercase, lowercase, and a number/);
});

test("register rejects a duplicate email with 409", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/auth/register", {
    method: "POST",
    body: {
      businessName: "Copycat Co",
      email: biz.email,
      password: TEST_PASSWORD,
      consent: true,
    },
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, "An account with this email already exists");
});

// ── Login ─────────────────────────────────────────────────────

test("login returns token + user + business, and the token works", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/auth/login", {
    method: "POST",
    body: { email: biz.email, password: TEST_PASSWORD },
  });
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.token, "string");
  assert.equal(res.json.token.split(".").length, 3); // a real JWT

  const { user, business } = res.json;
  assert.equal(user.email, biz.email);
  assert.equal(user.role, "owner");
  assert.equal(user.emailVerified, false); // fresh signup, link not clicked
  assert.equal(user.totpEnabled, false);
  assert.equal(business.id, biz.businessId);
  assert.equal(business.name, biz.businessName);
  assert.equal(business.plan, "starter");

  // The login-issued token must authenticate real requests.
  const me = await api(srv.base, "/api/business", { token: res.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.name, biz.businessName);
});

test("login email is case-insensitive", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/auth/login", {
    method: "POST",
    body: { email: biz.email.toUpperCase(), password: TEST_PASSWORD },
  });
  assert.equal(res.status, 200);
  // Stored (lowercased) address comes back, not the shouty input.
  assert.equal(res.json.user.email, biz.email);
});

test("login failure is generic — identical for wrong password vs unknown email", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const wrongPw = await api(srv.base, "/api/auth/login", {
    method: "POST",
    body: { email: biz.email, password: "Definitely-Wrong-123" },
  });
  const unknown = await api(srv.base, "/api/auth/login", {
    method: "POST",
    body: { email: uniqueEmail(), password: "Definitely-Wrong-123" },
  });
  assert.equal(wrongPw.status, 401);
  assert.equal(unknown.status, 401);
  // Byte-identical bodies: an attacker can't tell which half was wrong,
  // so login can't be used to enumerate accounts.
  assert.deepEqual(wrongPw.json, unknown.json);
  assert.equal(wrongPw.json.error, "Invalid email or password");
  assert.ok(!("token" in wrongPw.json));
  assert.ok(!("user" in wrongPw.json));
});

// ── Token integrity ───────────────────────────────────────────
// These go through /api/business, not /api/auth/*: requireAuth is the same
// global middleware either way, and this keeps the authLimiter failure
// budget (see header) untouched.

test("tampered or garbage Bearer tokens are rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Flip the last signature character of a genuine token.
  const lastChar = biz.token.at(-1) === "A" ? "B" : "A";
  const tampered = biz.token.slice(0, -1) + lastChar;
  const res1 = await api(srv.base, "/api/business", { token: tampered });
  assert.equal(res1.status, 401);
  assert.ok(!("name" in (res1.json ?? {})));

  // Not a JWT at all (long enough to reach jwt.verify past the length check).
  const res2 = await api(srv.base, "/api/business", {
    token: "not.a.real.jwt.token",
  });
  assert.equal(res2.status, 401);
});

test("a token for a closed business stops working", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const doomed = await createTestBusiness(srv.base);
  // Sanity: the token is live before the business closes.
  const before = await api(srv.base, "/api/business", { token: doomed.token });
  assert.equal(before.status, 200);

  await doomed.destroy();

  // Closing a business purges its users rows, so requireAuth's
  // token_version lookup finds nothing → 401, same as an expired session.
  const after = await api(srv.base, "/api/business", { token: doomed.token });
  assert.equal(after.status, 401);
  assert.ok(!("name" in (after.json ?? {})));
});

// ── Anti-enumeration + token hygiene ──────────────────────────

test("forgot-password answers identically whether or not the account exists", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const existing = await api(srv.base, "/api/auth/forgot-password", {
    method: "POST",
    body: { email: biz.email },
  });
  const unknown = await api(srv.base, "/api/auth/forgot-password", {
    method: "POST",
    body: { email: uniqueEmail() },
  });
  const malformed = await api(srv.base, "/api/auth/forgot-password", {
    method: "POST",
    body: { email: "not-an-email" },
  });
  assert.equal(existing.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(malformed.status, 200); // even bad input reveals nothing
  assert.deepEqual(existing.json, unknown.json);
  assert.deepEqual(existing.json, malformed.json);
  assert.equal(existing.json.ok, true);
});

test("verify-email fails cleanly on garbage tokens", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Well-formed hex that matches no user.
  const miss = await api(srv.base, "/api/auth/verify-email", {
    method: "POST",
    body: { token: "deadbeef".repeat(8) },
  });
  assert.equal(miss.status, 400);
  assert.match(miss.json.error, /invalid or has expired/);

  // Oversized token is refused before it ever reaches the database.
  const oversized = await api(srv.base, "/api/auth/verify-email", {
    method: "POST",
    body: { token: "x".repeat(200) },
  });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.json.error, "Invalid verification token");
});
