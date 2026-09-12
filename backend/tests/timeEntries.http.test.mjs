/**
 * tests/timeEntries.http.test.mjs — time tracking over real HTTP (§1.5
 * harness). Professional plan (projects gate).
 *
 * Regression guard: POST /api/time-entries once read `req.user.id`, but the
 * auth middleware only exposes `userId` — every create hit the NOT NULL
 * constraint on time_entries.user_id and returned 500. The entry must be
 * attributed to the authenticated user, never inserted with a null user.
 *
 * Skips when the database is unreachable, same as httpHarness.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null;
let userId = null;
let projectId = null;
let entryId = null;

// node-pg parses a DATE column as local midnight; format it back in local
// time so the assertion holds in any timezone.
const localYmd = (d) => {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
};

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base, { plan: "professional" });

    const me = await api(srv.base, "/api/auth/me", { token: biz.token });
    if (me.status !== 200) throw new Error(`me failed (${me.status})`);
    userId = me.json.user?.id;

    const p = await api(srv.base, "/api/projects", {
      method: "POST",
      token: biz.token,
      body: { name: "Barra de café" },
    });
    if (p.status !== 201)
      throw new Error(`project create failed (${p.status})`);
    projectId = p.json.id;
  } catch (err) {
    console.log(
      `# time entries: database not reachable — skipping (${err.message})`,
    );
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("POST attributes the entry to the authenticated user", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/time-entries", {
    method: "POST",
    token: biz.token,
    body: {
      projectId,
      date: "2026-09-11",
      hours: 8,
      description: "barista",
      isBillable: true,
      hourlyRate: 12.5,
    },
  });
  assert.equal(res.status, 201, `create: ${res.json?.error}`);
  assert.ok(userId, "me endpoint returned a user id");
  assert.equal(res.json.user_id, userId);
  assert.equal(res.json.business_id, biz.businessId);
  assert.equal(res.json.project_id, projectId);
  assert.equal(localYmd(res.json.date), "2026-09-11");
  assert.equal(Number(res.json.hours), 8);
  assert.equal(res.json.description, "barista");
  assert.equal(res.json.is_billable, true);
  assert.equal(Number(res.json.hourly_rate), 12.5);
  entryId = res.json.id;
});

test("POST without a project still records the user", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/time-entries", {
    method: "POST",
    token: biz.token,
    body: { date: "2026-09-10", hours: 1.5 },
  });
  assert.equal(res.status, 201, `create: ${res.json?.error}`);
  assert.equal(res.json.user_id, userId);
  assert.equal(res.json.project_id, null);
  assert.equal(res.json.is_billable, true); // default
});

test("POST validates date and hours", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const noDate = await api(srv.base, "/api/time-entries", {
    method: "POST",
    token: biz.token,
    body: { hours: 2 },
  });
  assert.equal(noDate.status, 400);
  const zeroHours = await api(srv.base, "/api/time-entries", {
    method: "POST",
    token: biz.token,
    body: { date: "2026-09-11", hours: 0 },
  });
  assert.equal(zeroHours.status, 400);
});

test("GET lists the week with user and project names joined", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // 2026-09-07 is the Monday of the week containing 2026-09-10/11.
  const res = await api(srv.base, "/api/time-entries?week=2026-09-07", {
    token: biz.token,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.length, 2);
  const withProject = res.json.find((e) => e.id === entryId);
  assert.ok(withProject, "created entry is listed");
  assert.equal(withProject.user_id, userId);
  assert.ok(withProject.user_name, "user_name joined from users");
  assert.equal(withProject.project_name, "Barra de café");

  const byUser = await api(
    srv.base,
    `/api/time-entries?week=2026-09-07&user_id=${userId}`,
    { token: biz.token },
  );
  assert.equal(byUser.status, 200);
  assert.equal(byUser.json.length, 2);
});

test("PUT updates hours and keeps the entry", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, `/api/time-entries/${entryId}`, {
    method: "PUT",
    token: biz.token,
    body: {
      projectId,
      date: "2026-09-11",
      hours: 6.25,
      description: "barista (short shift)",
      isBillable: false,
      hourlyRate: 12.5,
    },
  });
  assert.equal(res.status, 200, `update: ${res.json?.error}`);
  assert.equal(Number(res.json.hours), 6.25);
  assert.equal(res.json.is_billable, false);
  assert.equal(res.json.user_id, userId);
});

test("DELETE removes the entry; second delete is 404", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const del = await api(srv.base, `/api/time-entries/${entryId}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(del.status, 200);
  const again = await api(srv.base, `/api/time-entries/${entryId}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(again.status, 404);
});
