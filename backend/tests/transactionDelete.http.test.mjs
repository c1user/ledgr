/**
 * tests/transactionDelete.http.test.mjs — deleting transactions over real
 * HTTP (§1.5 harness). Professional plan (reconciliation gate).
 *
 * Only transactions that have never been reconciled can be deleted. Once a
 * transaction is cleared in a reconciliation — in progress OR completed —
 * DELETE is refused with code RECONCILED, and the list exposes
 * reconciliation_id / reconciliation_status so the UI can lock the button.
 *
 * Skips when the database is unreachable, same as httpHarness.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null;
let cashId = null;
let expenseId = null;
let freeTx = null; // never reconciled
let clearedTx = null; // cleared in a reconciliation
let reconId = null;

function findCoaByKey(groups, key) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.name_key === key) return n.id;
      const hit = walk(n.children || []);
      if (hit) return hit;
    }
    return null;
  };
  for (const g of groups) {
    const hit = walk(g.accounts);
    if (hit) return hit;
  }
  return null;
}

async function createTx(body) {
  const res = await api(srv.base, "/api/transactions", {
    method: "POST",
    token: biz.token,
    body: {
      fundingCoaId: cashId,
      categoryId: expenseId,
      type: "expense",
      ...body,
    },
  });
  assert.equal(res.status, 201, `create tx: ${res.json?.error}`);
  return res.json;
}

async function listRow(id) {
  const res = await api(srv.base, "/api/transactions?limit=50", {
    token: biz.token,
  });
  assert.equal(res.status, 200);
  return res.json.transactions.find((t) => t.id === id) || null;
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base, { plan: "professional" });
    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: biz.token,
    });
    if (coa.status !== 200) throw new Error(`coa failed (${coa.status})`);
    cashId = findCoaByKey(coa.json, "coa.accounts.cash");
    expenseId = findCoaByKey(coa.json, "coa.accounts.other_expense");
    if (!cashId || !expenseId) throw new Error("seeded COA accounts missing");

    freeTx = await createTx({
      date: "2026-09-01",
      merchant: "Free to delete",
      totalAmount: 100,
    });
    clearedTx = await createTx({
      date: "2026-09-02",
      merchant: "Cleared on statement",
      totalAmount: 40,
    });
  } catch (err) {
    console.log(`# delete: database not reachable — skipping (${err.message})`);
    if (biz) await biz.destroy().catch(() => {});
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("an unreconciled transaction can be deleted", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const before = await listRow(freeTx.id);
  assert.ok(before, "listed before delete");
  assert.equal(before.reconciliation_id, null);
  assert.equal(before.reconciliation_status, null);

  const del = await api(srv.base, `/api/transactions/${freeTx.id}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(del.status, 200, del.json?.error);
  assert.equal(await listRow(freeTx.id), null);
});

test("a transaction cleared in an in-progress reconciliation cannot be deleted", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const recon = await api(srv.base, "/api/reconciliations", {
    method: "POST",
    token: biz.token,
    body: {
      fundingCoaId: cashId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      statementStartBalance: 0,
      statementEndBalance: -40, // exactly the one cleared expense
    },
  });
  assert.equal(recon.status, 201, recon.json?.error);
  reconId = recon.json.id;

  const cleared = await api(
    srv.base,
    `/api/reconciliations/${reconId}/transactions`,
    { method: "PUT", token: biz.token, body: { add: [clearedTx.id] } },
  );
  assert.equal(cleared.status, 200, cleared.json?.error);

  const row = await listRow(clearedTx.id);
  assert.equal(row.reconciliation_id, reconId);
  assert.equal(row.reconciliation_status, "in_progress");

  const del = await api(srv.base, `/api/transactions/${clearedTx.id}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(del.status, 400);
  assert.equal(del.json.code, "RECONCILED");
  assert.match(del.json.error, /in-progress/i);
  assert.ok(await listRow(clearedTx.id), "still listed");
});

test("a transaction locked by a completed reconciliation cannot be deleted", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const done = await api(srv.base, `/api/reconciliations/${reconId}/complete`, {
    method: "POST",
    token: biz.token,
  });
  assert.equal(done.status, 200, done.json?.error);
  assert.equal(done.json.status, "completed");

  const row = await listRow(clearedTx.id);
  assert.equal(row.reconciliation_status, "completed");

  const del = await api(srv.base, `/api/transactions/${clearedTx.id}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(del.status, 400);
  assert.equal(del.json.code, "RECONCILED");
  assert.match(del.json.error, /completed reconciliation/i);
  assert.ok(await listRow(clearedTx.id), "still listed");
});
