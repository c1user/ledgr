/**
 * tests/receipts.http.test.mjs — receipts over real HTTP (§1.5 harness).
 *
 * Covers the mobile-readiness hardening of routes/receipts.js:
 *   - POST /upload: uploadLimiter (50/hour per user) runs before multer,
 *     and multer rejections are clean 4xx codes (413 FILE_TOO_LARGE,
 *     415 UNSUPPORTED_TYPE) instead of a 500 from the global handler.
 *   - PUT /:id/review never demotes a linked receipt.
 *   - PUT /:id/link is idempotent (same tx → 200, other tx → 409), and
 *     releases the receipt a transaction previously carried.
 *   - GET / dedupes receipts referenced by several transactions, accepts
 *     limit/offset/include=url, and rejects non-integer params.
 *   - Multi-tenant scoping: another business cannot see the receipts.
 *
 * Receipts rows are inserted directly with a fake s3_key — the real
 * upload path (S3 + Claude) is never exercised here. Skips when the
 * database is unreachable, same as the other *.http.test.mjs suites.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

const UPLOAD_LIMIT = 50; // uploadLimiter max
const MAX_BYTES = 10 * 1024 * 1024;

let srv = null;
let biz = null;
let userId = null;
let cashId = null;
let expenseId = null;
let receiptA = null; // will be linked
let receiptB = null; // stays unlinked
let tx1 = null;
let tx2 = null;

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

async function insertReceipt(businessId, uploadedBy, merchant) {
  const r = await pool.query(
    `INSERT INTO receipts
       (business_id, uploaded_by, s3_key, original_filename,
        ai_merchant, ai_total, ai_line_items, ai_confidence, status)
     VALUES ($1, $2, $3, $4, $5, $6, '[]', 0.5, 'pending')
     RETURNING *`,
    [
      businessId,
      uploadedBy,
      `test/${crypto.randomUUID()}.jpg`,
      "receipt.jpg",
      merchant,
      12.34,
    ],
  );
  return r.rows[0];
}

/** POST /api/receipts/upload with one multipart file part named "receipt". */
async function upload(token, { bytes, type, filename }) {
  const fd = new FormData();
  fd.append("receipt", new Blob([bytes], { type }), filename);
  fd.append("idempotencyKey", crypto.randomUUID());
  const res = await fetch(`${srv.base}/api/receipts/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base);
    const u = await pool.query(
      "SELECT id FROM users WHERE business_id = $1 ORDER BY created_at LIMIT 1",
      [biz.businessId],
    );
    userId = u.rows[0]?.id;
    if (!userId) throw new Error("test user missing");

    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: biz.token,
    });
    if (coa.status !== 200) throw new Error(`coa failed (${coa.status})`);
    cashId = findCoaByKey(coa.json, "coa.accounts.cash");
    expenseId = findCoaByKey(coa.json, "coa.accounts.other_expense");
    if (!cashId || !expenseId) throw new Error("seeded COA accounts missing");
  } catch (err) {
    console.log(
      `# receipts: database not reachable — skipping (${err.message})`,
    );
    if (biz) await biz.destroy().catch(() => {});
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

// ── Upload rejections + rate limit ───────────────────────────
// Budget: 1×413 + 49×415 = 50 counted requests, then the 51st is 429.
// The oversized upload goes first so the limiter is not yet exhausted.

test("an 11 MB upload is refused with 413 FILE_TOO_LARGE", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await upload(biz.token, {
    bytes: Buffer.alloc(11 * 1024 * 1024, 0xff),
    type: "image/jpeg",
    filename: "huge.jpg",
  });
  assert.equal(res.status, 413, res.text);
  assert.equal(res.json.code, "FILE_TOO_LARGE");
  assert.equal(res.json.limitBytes, MAX_BYTES);
  assert.match(res.json.error, /10 MB/);
});

test("a text/plain upload is refused with 415 UNSUPPORTED_TYPE, and rejections count toward the hourly limit", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // 49 more rejected uploads exhaust the 50/hour budget (413 above + 49).
  for (let i = 0; i < UPLOAD_LIMIT - 1; i++) {
    const res = await upload(biz.token, {
      bytes: "not a receipt",
      type: "text/plain",
      filename: "note.txt",
    });
    assert.equal(res.status, 415, `request ${i + 2}: ${res.text}`);
    assert.equal(res.json.code, "UNSUPPORTED_TYPE");
    assert.deepEqual(res.json.allowed, [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]);
    assert.match(res.json.error, /JPEG, PNG, WEBP, and PDF/);
  }

  // 51st request: the limiter answers before multer ever runs.
  const over = await upload(biz.token, {
    bytes: "not a receipt",
    type: "text/plain",
    filename: "note.txt",
  });
  assert.equal(over.status, 429, over.text);
  assert.match(over.json.error, /Upload limit reached/);
});

// ── Review + link semantics ──────────────────────────────────

test("review never demotes a linked receipt; link is idempotent", async (t) => {
  if (!biz) return t.skip("database not reachable");
  receiptA = await insertReceipt(biz.businessId, userId, "Ferretería A");
  receiptB = await insertReceipt(biz.businessId, userId, "Colmado B");
  assert.equal(receiptA.status, "pending");

  tx1 = await createTx({
    date: "2026-09-01",
    merchant: "Ferretería A",
    totalAmount: 12.34,
  });

  // First link → 200, receipt becomes linked, tx points at it.
  const link1 = await api(srv.base, `/api/receipts/${receiptA.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx1.id },
  });
  assert.equal(link1.status, 200, link1.json?.error);
  assert.equal(link1.json.message, "Receipt linked to transaction");

  // Reviewing a linked receipt keeps status = linked (data still updates).
  const review = await api(srv.base, `/api/receipts/${receiptA.id}/review`, {
    method: "PUT",
    token: biz.token,
    body: { merchant: "Ferretería A (corrected)", total: 12.34 },
  });
  assert.equal(review.status, 200, review.json?.error);
  assert.equal(review.json.status, "linked");
  assert.equal(review.json.ai_merchant, "Ferretería A (corrected)");

  // Reviewing an unlinked receipt still marks it reviewed (unchanged path).
  const reviewB = await api(srv.base, `/api/receipts/${receiptB.id}/review`, {
    method: "PUT",
    token: biz.token,
    body: {},
  });
  assert.equal(reviewB.status, 200, reviewB.json?.error);
  assert.equal(reviewB.json.status, "reviewed");

  // Same transaction again → idempotent 200.
  const link2 = await api(srv.base, `/api/receipts/${receiptA.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx1.id },
  });
  assert.equal(link2.status, 200, link2.json?.error);
  assert.equal(link2.json.message, "Receipt linked to transaction");

  // A different transaction → 409 RECEIPT_LINKED, nothing changes.
  tx2 = await createTx({
    date: "2026-09-02",
    merchant: "Something else",
    totalAmount: 5,
  });
  const link3 = await api(srv.base, `/api/receipts/${receiptA.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx2.id },
  });
  assert.equal(link3.status, 409, link3.json?.error);
  assert.equal(link3.json.code, "RECEIPT_LINKED");
  assert.equal(link3.json.error, "Receipt already linked");

  const rows = await pool.query(
    "SELECT id, receipt_id FROM transactions WHERE business_id = $1 AND id = ANY($2::uuid[])",
    [biz.businessId, [tx1.id, tx2.id]],
  );
  const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.receipt_id]));
  assert.equal(byId[tx1.id], receiptA.id);
  assert.equal(byId[tx2.id], null);
});

// ── Listing ──────────────────────────────────────────────────

test("GET /receipts lists each receipt once, even when several transactions reference it", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Nothing in the API should produce this state any more, but rows written
  // before the guards existed can carry it: point a second transaction at
  // receipt A directly (tenant-scoped) so A is referenced twice.
  await pool.query(
    "UPDATE transactions SET receipt_id = $1 WHERE id = $2 AND business_id = $3",
    [receiptA.id, tx2.id, biz.businessId],
  );

  const list = await api(srv.base, "/api/receipts", { token: biz.token });
  assert.equal(list.status, 200, list.json?.error);
  assert.ok(Array.isArray(list.json));
  assert.equal(list.json.length, 2);
  const ids = list.json.map((r) => r.id);
  assert.deepEqual(new Set(ids), new Set([receiptA.id, receiptB.id]));
  // Newest receipt first (default order unchanged).
  assert.equal(ids[0], receiptB.id);

  const rowA = list.json.find((r) => r.id === receiptA.id);
  assert.equal(rowA.status, "linked");
  assert.equal(rowA.transaction_id, tx2.id, "most recent linked tx wins");
  assert.equal(rowA.transaction_merchant, "Something else");
  assert.equal(rowA.uploaded_by_name !== undefined, true);
  assert.equal("signed_url" in rowA, false, "no signed_url unless asked");

  const rowB = list.json.find((r) => r.id === receiptB.id);
  assert.equal(rowB.status, "reviewed");
  assert.equal(rowB.transaction_id, null);
  assert.equal(rowB.transaction_merchant, null);

  // status filter still works alongside the dedup join.
  const linked = await api(srv.base, "/api/receipts?status=linked", {
    token: biz.token,
  });
  assert.equal(linked.status, 200);
  assert.deepEqual(
    linked.json.map((r) => r.id),
    [receiptA.id],
  );
});

test("GET /receipts supports limit/offset/include=url and validates them", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const page1 = await api(srv.base, "/api/receipts?limit=1", {
    token: biz.token,
  });
  assert.equal(page1.status, 200, page1.json?.error);
  assert.equal(page1.json.length, 1);
  assert.equal(page1.json[0].id, receiptB.id);

  const page2 = await api(srv.base, "/api/receipts?limit=1&offset=1", {
    token: biz.token,
  });
  assert.equal(page2.status, 200, page2.json?.error);
  assert.equal(page2.json.length, 1);
  assert.equal(page2.json[0].id, receiptA.id);

  // limit above the cap is clamped, not rejected.
  const big = await api(srv.base, "/api/receipts?limit=500", {
    token: biz.token,
  });
  assert.equal(big.status, 200, big.json?.error);
  assert.equal(big.json.length, 2);

  const withUrl = await api(srv.base, "/api/receipts?include=url", {
    token: biz.token,
  });
  assert.equal(withUrl.status, 200, withUrl.json?.error);
  assert.equal(withUrl.json.length, 2);
  for (const row of withUrl.json) {
    assert.equal(typeof row.signed_url, "string");
    assert.match(row.signed_url, /^https?:\/\//);
    assert.ok(
      row.signed_url.includes(row.s3_key),
      "signed url targets the row's key",
    );
  }

  for (const bad of [
    "limit=abc",
    "limit=0",
    "limit=-1",
    "limit=1.5",
    "offset=abc",
    "offset=-1",
  ]) {
    const res = await api(srv.base, `/api/receipts?${bad}`, {
      token: biz.token,
    });
    assert.equal(res.status, 400, `${bad}: ${res.text}`);
    assert.equal(typeof res.json.error, "string");
  }
});

// ── Multi-tenant scoping ─────────────────────────────────────

test("another business cannot see or link the receipts", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const other = await createTestBusiness(srv.base);
  try {
    const list = await api(srv.base, "/api/receipts", { token: other.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json, []);

    const withUrl = await api(srv.base, "/api/receipts?include=url", {
      token: other.token,
    });
    assert.equal(withUrl.status, 200);
    assert.deepEqual(withUrl.json, []);

    const one = await api(srv.base, `/api/receipts/${receiptA.id}`, {
      token: other.token,
    });
    assert.equal(one.status, 404);

    const review = await api(srv.base, `/api/receipts/${receiptB.id}/review`, {
      method: "PUT",
      token: other.token,
      body: { merchant: "hijack" },
    });
    assert.equal(review.status, 404);

    const link = await api(srv.base, `/api/receipts/${receiptB.id}/link`, {
      method: "PUT",
      token: other.token,
      body: { transactionId: tx2.id },
    });
    assert.equal(link.status, 404);

    // Nothing leaked across: B is still reviewed and unlinked.
    const check = await pool.query(
      "SELECT status, ai_merchant FROM receipts WHERE id = $1 AND business_id = $2",
      [receiptB.id, biz.businessId],
    );
    assert.equal(check.rows[0].status, "reviewed");
    assert.equal(check.rows[0].ai_merchant, "Colmado B");
  } finally {
    await other.destroy();
  }
});

// ── Re-pointing a transaction releases the receipt it carried ─

test("linking another receipt to a transaction releases the receipt it replaced", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const receiptC = await insertReceipt(biz.businessId, userId, "Panadería C");
  const receiptD = await insertReceipt(biz.businessId, userId, "Gasolinera D");
  const tx3 = await createTx({
    date: "2026-09-03",
    merchant: "Panadería C",
    totalAmount: 8,
  });

  const linkC = await api(srv.base, `/api/receipts/${receiptC.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx3.id },
  });
  assert.equal(linkC.status, 200, linkC.json?.error);

  // The web app's picker lists every transaction, so D can be pointed at
  // tx3 too. That replaces C, which must not stay 'linked' with nothing
  // referencing it (it could never be re-linked, booked or deleted again).
  const linkD = await api(srv.base, `/api/receipts/${receiptD.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx3.id },
  });
  assert.equal(linkD.status, 200, linkD.json?.error);

  const rows = await pool.query(
    "SELECT id, status FROM receipts WHERE business_id = $1 AND id = ANY($2::uuid[])",
    [biz.businessId, [receiptC.id, receiptD.id]],
  );
  const status = Object.fromEntries(rows.rows.map((r) => [r.id, r.status]));
  assert.equal(status[receiptD.id], "linked");
  assert.equal(status[receiptC.id], "reviewed", "replaced receipt released");
  const tx = await pool.query(
    "SELECT receipt_id FROM transactions WHERE id = $1 AND business_id = $2",
    [tx3.id, biz.businessId],
  );
  assert.equal(tx.rows[0].receipt_id, receiptD.id);

  // C is free again: linking it elsewhere is a 200, not a 409.
  const tx4 = await createTx({
    date: "2026-09-04",
    merchant: "Panadería C again",
    totalAmount: 8,
  });
  const relink = await api(srv.base, `/api/receipts/${receiptC.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx4.id },
  });
  assert.equal(relink.status, 200, relink.json?.error);
  assert.equal(await receiptStatusOf(receiptC.id), "linked");
});

async function receiptStatusOf(id) {
  const r = await pool.query(
    "SELECT status FROM receipts WHERE id = $1 AND business_id = $2",
    [id, biz.businessId],
  );
  return r.rows[0]?.status ?? null;
}

test("DELETE refuses a receipt a transaction still references, but not a dangling 'linked' one", async (t) => {
  if (!biz) return t.skip("database not reachable");

  // Truly linked: created and linked through the API → 400.
  const referenced = await insertReceipt(biz.businessId, userId, "Óptica E");
  const tx = await createTx({
    date: "2026-09-05",
    merchant: "Óptica E",
    totalAmount: 12,
  });
  const link = await api(srv.base, `/api/receipts/${referenced.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx.id },
  });
  assert.equal(link.status, 200, link.json?.error);
  const refused = await api(srv.base, `/api/receipts/${referenced.id}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /linked to a transaction/);

  // Dangling: status says 'linked' but nothing references it (legacy rows
  // from before DELETE /transactions/:id released receipts) → deletable.
  const dangling = await insertReceipt(biz.businessId, userId, "Farmacia F");
  await pool.query(
    "UPDATE receipts SET status = 'linked' WHERE id = $1 AND business_id = $2",
    [dangling.id, biz.businessId],
  );
  const deleted = await api(srv.base, `/api/receipts/${dangling.id}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(deleted.status, 200, deleted.json?.error);
  assert.equal(await receiptStatusOf(dangling.id), null, "row is gone");
});

test("GET /receipts/:id carries the linked transaction like the list does", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const receipt = await insertReceipt(biz.businessId, userId, "Librería G");
  const tx = await createTx({
    date: "2026-09-06",
    merchant: "Librería G",
    totalAmount: 21,
  });
  const link = await api(srv.base, `/api/receipts/${receipt.id}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: tx.id },
  });
  assert.equal(link.status, 200, link.json?.error);
  const detail = await api(srv.base, `/api/receipts/${receipt.id}`, {
    token: biz.token,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.transaction_id, tx.id);
  assert.equal(detail.json.transaction_merchant, "Librería G");
  assert.equal(typeof detail.json.signed_url, "string");
  const unlinked = await insertReceipt(biz.businessId, userId, "Kiosko H");
  const d2 = await api(srv.base, `/api/receipts/${unlinked.id}`, {
    token: biz.token,
  });
  assert.equal(d2.json.transaction_id, null);
});
