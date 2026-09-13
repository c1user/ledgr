/**
 * tests/categories.http.test.mjs — "transactions by category" over real HTTP
 * (§1.5 harness). Starter plan (chart of accounts + transactions).
 *
 * GET /api/chart-of-accounts/:id/transactions backs the category drawer:
 * every transaction whose journal entry posted to that revenue/expense
 * account OR one of its sub-accounts, newest first, plus all-time totals.
 * For a split transaction only the split that hit the category counts.
 *
 * Skips when the database is unreachable, same as httpHarness.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null;
let other = null; // second tenant for the cross-tenant probe
let cashId = null; // seeded asset account — funds the postings
let parentId = null; // seeded expense account — the category under test
let childId = null; // sub-account created under parentId
let siblingId = null; // a different expense account

const cents = (v) => Math.round(Number(v) * 100);

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

async function createTx(token, body) {
  const res = await api(srv.base, "/api/transactions", {
    method: "POST",
    token,
    body: { fundingCoaId: cashId, type: "expense", ...body },
  });
  assert.equal(res.status, 201, `create tx: ${res.json?.error}`);
  return res.json;
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base);
    other = await createTestBusiness(srv.base);

    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: biz.token,
    });
    if (coa.status !== 200) throw new Error(`coa failed (${coa.status})`);
    cashId = findCoaByKey(coa.json, "coa.accounts.cash");
    parentId = findCoaByKey(coa.json, "coa.accounts.other_expense");
    siblingId = findCoaByKey(coa.json, "coa.accounts.rent");
    if (!cashId || !parentId || !siblingId)
      throw new Error("seeded COA accounts missing");

    const sub = await api(srv.base, "/api/chart-of-accounts", {
      method: "POST",
      token: biz.token,
      body: { name: "Sub-expense", accountType: "expense", parentId },
    });
    if (sub.status !== 201) throw new Error(`sub-account (${sub.status})`);
    childId = sub.json.id;

    // Postings: parent ×1, child ×1, sibling ×1, and a split that touches
    // the parent for $30 and the sibling for $50.
    await createTx(biz.token, {
      categoryId: parentId,
      date: "2026-09-01",
      merchant: "Parent only",
      totalAmount: 100,
    });
    await createTx(biz.token, {
      categoryId: childId,
      date: "2026-09-02",
      merchant: "Child only",
      totalAmount: 50,
    });
    await createTx(biz.token, {
      categoryId: siblingId,
      date: "2026-09-03",
      merchant: "Sibling only",
      totalAmount: 30,
    });
    await createTx(biz.token, {
      date: "2026-09-04",
      merchant: "Split parent + sibling",
      totalAmount: 80,
      splits: [
        { categoryId: parentId, amount: 30 },
        { categoryId: siblingId, amount: 50 },
      ],
    });
  } catch (err) {
    console.log(
      `# categories: database not reachable — skipping (${err.message})`,
    );
    if (biz) await biz.destroy().catch(() => {});
    if (other) await other.destroy().catch(() => {});
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (other) await other.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("parent category lists its own, sub-account, and split postings", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(
    srv.base,
    `/api/chart-of-accounts/${parentId}/transactions`,
    { token: biz.token },
  );
  assert.equal(res.status, 200, res.json?.error);
  const { transactions, summary } = res.json;
  assert.equal(summary.count, 3);
  assert.equal(cents(summary.total), 18000); // 100 + 50 + 30 (the split's share)
  assert.equal(summary.includes_subcategories, true);
  assert.deepEqual(
    transactions.map((x) => x.merchant),
    ["Split parent + sibling", "Child only", "Parent only"], // newest first
  );
  const split = transactions[0];
  assert.equal(split.is_split, true);
  assert.equal(cents(split.category_amount), 3000); // not the $80 total
  assert.equal(cents(split.total_amount), 8000);
  assert.equal(transactions[2].date, "2026-09-01"); // plain YYYY-MM-DD
  assert.ok(transactions[2].account_name_key || transactions[2].account_name);
});

test("sub-account lists only its own postings", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(
    srv.base,
    `/api/chart-of-accounts/${childId}/transactions`,
    { token: biz.token },
  );
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.count, 1);
  assert.equal(cents(res.json.summary.total), 5000);
  assert.equal(res.json.summary.includes_subcategories, false);
  assert.equal(res.json.transactions[0].merchant, "Child only");
});

test("sibling category counts its split share", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(
    srv.base,
    `/api/chart-of-accounts/${siblingId}/transactions`,
    { token: biz.token },
  );
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.count, 2);
  assert.equal(cents(res.json.summary.total), 8000); // 30 + 50
});

test("a category with no postings returns an empty list and zero totals", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const coa = await api(srv.base, "/api/chart-of-accounts", {
    token: biz.token,
  });
  const revenueId = findCoaByKey(coa.json, "coa.accounts.sales_revenue");
  assert.ok(revenueId, "seeded revenue account");
  const res = await api(
    srv.base,
    `/api/chart-of-accounts/${revenueId}/transactions`,
    { token: biz.token },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.transactions, []);
  assert.equal(res.json.summary.count, 0);
  assert.equal(cents(res.json.summary.total), 0);
});

test("another tenant cannot read the category (404), bad ids are rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const cross = await api(
    srv.base,
    `/api/chart-of-accounts/${parentId}/transactions`,
    { token: other.token },
  );
  assert.equal(cross.status, 404);
  const bogus = await api(
    srv.base,
    "/api/chart-of-accounts/not-a-uuid/transactions",
    { token: biz.token },
  );
  assert.equal(bogus.status, 404); // uuidParam rejects malformed ids as 404
  const anon = await api(
    srv.base,
    `/api/chart-of-accounts/${parentId}/transactions`,
  );
  assert.equal(anon.status, 401);
});
