/**
 * tests/httpHarness.test.mjs — proves the §1.5 harness itself: real app on
 * an ephemeral port, real registration, plan gate visible over HTTP, real
 * close-business teardown. Skips when the database is unreachable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null;

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base);
  } catch (err) {
    console.log(`# harness: database not reachable — skipping (${err.message})`);
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("health endpoint answers without auth", async (t) => {
  if (!srv) return t.skip("no server");
  const res = await api(srv.base, "/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { status: "ok" });
});

test("registration issued a working token", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/business", { token: biz.token });
  assert.equal(res.status, 200);
  assert.equal(res.json.name, biz.businessName);
  assert.equal(res.json.plan, "starter");
});

test("unauthenticated requests are rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/business");
  assert.equal(res.status, 401);
});

test("plan gate returns 403 UPGRADE_REQUIRED over real HTTP", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Starter plan — invoicing is professional-tier.
  const res = await api(srv.base, "/api/invoices", { token: biz.token });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "UPGRADE_REQUIRED");
});

test("plan bump unlocks the gate (instant switch until Stripe)", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const up = await api(srv.base, "/api/business/plan", {
    method: "PUT",
    token: biz.token,
    body: { plan: "professional" },
  });
  assert.equal(up.status, 200);
  const res = await api(srv.base, "/api/invoices", { token: biz.token });
  assert.equal(res.status, 200);
});
