/**
 * tests/navSettings.http.test.mjs — per-business sidebar customization over
 * real HTTP (§1.5 harness).
 *
 * PUT /api/business/nav stores which top-level sections the business hides;
 * the value must round-trip through GET /api/business, /api/auth/me and
 * login (the shell reads it from the auth payload), and the server must
 * reject anything that is not a known hideable route — in particular the
 * locked sections (Dashboard, Transactions, Business Profile).
 *
 * Skips when the database is unreachable, same as httpHarness.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import {
  startTestServer,
  createTestBusiness,
  api,
  TEST_PASSWORD,
} from "./helpers/http.mjs";

let srv = null;
let biz = null;

const putNav = (hiddenNav, token = biz.token) =>
  api(srv.base, "/api/business/nav", {
    method: "PUT",
    token,
    body: { hiddenNav },
  });

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base);
  } catch (err) {
    console.log(`# nav: database not reachable — skipping (${err.message})`);
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("a new business hides nothing", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/business", { token: biz.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.hidden_nav, []);
  const me = await api(srv.base, "/api/auth/me", { token: biz.token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.business.hiddenNav, []);
});

test("hidden sections round-trip through business, me, and login", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const saved = await putNav(["/inventory", "/payroll", "/inventory"]);
  assert.equal(saved.status, 200, saved.json?.error);
  assert.deepEqual(saved.json.hiddenNav, ["/inventory", "/payroll"]); // deduped

  const res = await api(srv.base, "/api/business", { token: biz.token });
  assert.deepEqual(res.json.hidden_nav, ["/inventory", "/payroll"]);

  const me = await api(srv.base, "/api/auth/me", { token: biz.token });
  assert.deepEqual(me.json.business.hiddenNav, ["/inventory", "/payroll"]);

  const login = await api(srv.base, "/api/auth/login", {
    method: "POST",
    body: { email: biz.email, password: TEST_PASSWORD },
  });
  assert.equal(login.status, 200, login.json?.error);
  assert.deepEqual(login.json.business.hiddenNav, ["/inventory", "/payroll"]);
});

test("locked sections, unknown routes, and non-arrays are rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  for (const bad of [
    ["/dashboard"],
    ["/transactions"],
    ["/settings"],
    ["/inventory", "/nope"],
    ["inventory"],
    [42],
    "inventory",
    null,
  ]) {
    const res = await putNav(bad);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
  // A rejected request leaves the stored value untouched.
  const res = await api(srv.base, "/api/business", { token: biz.token });
  assert.deepEqual(res.json.hidden_nav, ["/inventory", "/payroll"]);
});

test("an empty list shows everything again", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const saved = await putNav([]);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.hiddenNav, []);
  const res = await api(srv.base, "/api/business", { token: biz.token });
  assert.deepEqual(res.json.hidden_nav, []);
});

test("unauthenticated requests are rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/business/nav", {
    method: "PUT",
    body: { hiddenNav: ["/inventory"] },
  });
  assert.equal(res.status, 401);
});
