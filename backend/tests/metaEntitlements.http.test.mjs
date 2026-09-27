/**
 * tests/metaEntitlements.http.test.mjs — the two public/near-public
 * endpoints the native shells lean on (§1.5 harness):
 *
 *   GET /api/meta                    — apiVersion + minMobileBuild, no auth
 *   GET /api/business/entitlements   — now carries usage.aiReceiptsThisMonth
 *
 * plus the authLimiter change: GET routes on /api/auth are never counted,
 * so a stale token hammering /auth/me cannot lock its own user out of
 * logging back in.
 *
 * Receipts are inserted directly with a fake s3_key — never through
 * /receipts/upload, which would hit S3 and Claude. Skips when the database
 * is unreachable, same as the other *.http.test.mjs suites.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pool from "../src/config/db.js";
import { getEntitlements } from "../src/config/entitlements.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

// The default (unset) case is what /api/meta must report as 0. Cleared
// BEFORE the harness imports the app so a stray shell value cannot leak
// in; dotenv only fills it back if backend/.env sets it, which it doesn't.
delete process.env.MIN_MOBILE_BUILD;

let srv = null;
let biz = null;
let ownerId = null;

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base); // starter by default
    const owner = await pool.query(
      `SELECT id FROM users WHERE business_id = $1 AND role = 'owner'`,
      [biz.businessId],
    );
    if (owner.rows.length === 0) throw new Error("owner row missing");
    ownerId = owner.rows[0].id;
  } catch (err) {
    console.log(`# meta: database not reachable — skipping (${err.message})`);
    if (biz) await biz.destroy().catch(() => {});
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

// ── GET /api/meta ─────────────────────────────────────────────
// No DB needed: runs even when the harness could not register a business.

test("GET /api/meta is public and reports the API version + min build", async () => {
  const res = await api(srv.base, "/api/meta");
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.apiVersion, "string");
  assert.ok(res.json.apiVersion.length > 0, "apiVersion is non-empty");
  assert.equal(res.json.minMobileBuild, 0);
  assert.deepEqual(Object.keys(res.json).sort(), [
    "apiVersion",
    "minMobileBuild",
  ]);
});

// ── GET /api/business/entitlements · usage ────────────────────

async function entitlements() {
  const res = await api(srv.base, "/api/business/entitlements", {
    token: biz.token,
  });
  assert.equal(res.status, 200, res.json?.error);
  return res.json;
}

test("a fresh starter business has used 0 AI receipts this month", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const ent = await entitlements();
  assert.equal(ent.plan, "starter");
  assert.equal(ent.limits.aiReceiptsPerMonth, 10);
  assert.deepEqual(ent.usage, { aiReceiptsThisMonth: 0 });

  // Every pre-existing field is untouched — usage is purely additive.
  const { usage, ...rest } = ent;
  assert.deepEqual(rest, getEntitlements("starter"));
});

test("usage counts receipts created this month, scoped to the business", async (t) => {
  if (!biz) return t.skip("database not reachable");
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO receipts (business_id, uploaded_by, s3_key, original_filename)
       VALUES ($1, $2, $3, $4)`,
      [
        biz.businessId,
        ownerId,
        `test/${crypto.randomUUID()}.jpg`,
        `receipt-${i}.jpg`,
      ],
    );
  }
  const ent = await entitlements();
  assert.equal(ent.usage.aiReceiptsThisMonth, 3);

  // Another tenant's counter is unaffected by those rows.
  const other = await createTestBusiness(srv.base);
  try {
    const theirs = await api(srv.base, "/api/business/entitlements", {
      token: other.token,
    });
    assert.equal(theirs.status, 200);
    assert.equal(theirs.json.usage.aiReceiptsThisMonth, 0);
  } finally {
    await other.destroy();
  }
});

test("unlimited plans report usage.aiReceiptsThisMonth = null", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const up = await api(srv.base, "/api/business/plan", {
    method: "PUT",
    token: biz.token,
    body: { plan: "premium" },
  });
  assert.equal(up.status, 200, up.json?.error);
  assert.equal(up.json.plan, "premium");

  const ent = await entitlements();
  assert.equal(ent.plan, "premium");
  assert.equal(ent.limits.aiReceiptsPerMonth, null);
  assert.deepEqual(ent.usage, { aiReceiptsThisMonth: null });
});

// ── authLimiter skips GET ─────────────────────────────────────
// authLimiter counts failures at 10 per 15 min per IP. Twelve
// unauthenticated GET /auth/me in a row would trip it if GETs counted;
// they must all come back 401, never 429.

test("unauthenticated GET /auth/me never trips the login rate limit", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const res = await api(srv.base, "/api/auth/me");
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, Array(12).fill(401));
});
