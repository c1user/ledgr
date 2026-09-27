/**
 * tests/receiptBooking.http.test.mjs — atomic receipt booking through
 * POST /api/transactions (§1.5 harness). Starter plan (no gate involved).
 *
 * When a receiptId is sent, the receipt is claimed inside the same DB
 * transaction as the ledger posting: the receipt row is locked (FOR UPDATE),
 * refused when missing / another tenant's (404) or already linked (409
 * RECEIPT_LINKED), and flipped to status = 'linked' only once the posting
 * succeeded. The 201 body then carries an extra `receipt` field; without a
 * receiptId the body is unchanged.
 *
 * Also covers the two seams with routes/receipts.js: the web app books a
 * transaction with receiptId and THEN calls PUT /receipts/:id/link (which
 * must stay an idempotent 200), and DELETE /transactions/:id releases the
 * booked receipt so it can be booked again instead of staying 'linked' —
 * including when a link re-points the transaction while the delete is in
 * flight (the delete locks the transaction row first and releases the
 * receipt the row carried when it went, so nothing is stranded and the
 * two never deadlock). Receipts left 'linked' with nothing referencing them
 * (rows from before the delete released receipts) stay bookable/linkable:
 * the 409 guard only bites while a transaction still references them.
 *
 * Receipts rows are inserted directly with a fake s3_key — the real upload
 * endpoint talks to S3 and Claude and is never called here.
 *
 * Skips when the database is unreachable, same as httpHarness.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null; // the booking business
let other = null; // a second tenant, for the scoping check
let accountId = null;
let expenseId = null;
let receiptId = null; // pending receipt owned by `biz`
let foreignReceiptId = null; // pending receipt owned by `other`

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

/** Insert a receipt for a business without touching S3 or Claude. */
async function insertReceipt(businessId, status = "pending") {
  const user = await pool.query(
    "SELECT id FROM users WHERE business_id = $1 LIMIT 1",
    [businessId],
  );
  const s3Key = `test/${crypto.randomUUID()}.jpg`;
  const row = await pool.query(
    `INSERT INTO receipts
       (business_id, uploaded_by, s3_key, original_filename, status)
     VALUES ($1, $2, $3, 'booking-test.jpg', $4)
     RETURNING id`,
    [businessId, user.rows[0].id, s3Key, status],
  );
  return row.rows[0].id;
}

/**
 * Poll pg_stat_activity until another backend of this database is blocked
 * on a lock while running a statement that contains `fragment`.
 */
async function waitForLockWaiter(fragment, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await pool.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE $1`,
      [`%${fragment}%`],
    );
    if (r.rowCount > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `no backend blocked on a lock in "${fragment}" within ${timeoutMs} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function receiptStatus(businessId, id) {
  const r = await pool.query(
    "SELECT status FROM receipts WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );
  return r.rows[0]?.status ?? null;
}

async function txCount(businessId) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM transactions WHERE business_id = $1",
    [businessId],
  );
  return r.rows[0].n;
}

function postTx(body) {
  return api(srv.base, "/api/transactions", {
    method: "POST",
    token: biz.token,
    body: {
      accountId,
      categoryId: expenseId,
      type: "expense",
      date: "2026-09-10",
      merchant: "Receipt booking",
      totalAmount: 25,
      ...body,
    },
  });
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base);
    other = await createTestBusiness(srv.base);

    const acc = await api(srv.base, "/api/accounts", {
      method: "POST",
      token: biz.token,
      body: { name: "Checking (receipt booking)", type: "current" },
    });
    if (acc.status !== 201)
      throw new Error(`account create failed (${acc.status})`);
    accountId = acc.json.id;

    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: biz.token,
    });
    if (coa.status !== 200) throw new Error(`coa failed (${coa.status})`);
    expenseId = findCoaByKey(coa.json, "coa.accounts.other_expense");
    if (!expenseId) throw new Error("seeded expense account missing");

    receiptId = await insertReceipt(biz.businessId);
    foreignReceiptId = await insertReceipt(other.businessId);
  } catch (err) {
    console.log(
      `# receipt booking: database not reachable — skipping (${err.message})`,
    );
    if (biz) await biz.destroy().catch(() => {});
    if (other) await other.destroy().catch(() => {});
    biz = null;
    other = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (other) await other.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("booking a pending receipt links it atomically with the transaction", async (t) => {
  if (!biz) return t.skip("database not reachable");
  assert.equal(await receiptStatus(biz.businessId, receiptId), "pending");

  const res = await postTx({ receiptId });
  assert.equal(res.status, 201, res.json?.error);
  assert.deepEqual(res.json.receipt, { id: receiptId, status: "linked" });
  assert.equal(res.json.receipt_id, receiptId);
  assert.equal(res.json.business_id, biz.businessId);

  assert.equal(await receiptStatus(biz.businessId, receiptId), "linked");
  const tx = await pool.query(
    "SELECT receipt_id FROM transactions WHERE id = $1 AND business_id = $2",
    [res.json.id, biz.businessId],
  );
  assert.equal(tx.rows[0]?.receipt_id, receiptId);
});

test("a receipt that is already linked cannot be booked twice", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const before = await txCount(biz.businessId);

  const res = await postTx({ receiptId, merchant: "Second booking" });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "RECEIPT_LINKED");
  assert.equal(res.json.error, "Receipt already linked");

  assert.equal(await txCount(biz.businessId), before, "no second transaction");
  const linked = await pool.query(
    "SELECT COUNT(*)::int AS n FROM transactions WHERE business_id = $1 AND receipt_id = $2",
    [biz.businessId, receiptId],
  );
  assert.equal(linked.rows[0].n, 1);
});

test("an unknown receiptId is a 404 and posts nothing", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const before = await txCount(biz.businessId);

  const res = await postTx({ receiptId: crypto.randomUUID() });
  assert.equal(res.status, 404);
  assert.equal(res.json.error, "Receipt not found");
  assert.equal(await txCount(biz.businessId), before);
});

test("a malformed receiptId is a 400, never a pg error", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const before = await txCount(biz.businessId);

  const res = await postTx({ receiptId: "not-a-uuid" });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "receiptId must be a UUID");
  assert.equal(await txCount(biz.businessId), before);
});

test("another tenant's receipt is indistinguishable from a missing one", async (t) => {
  if (!biz) return t.skip("database not reachable");
  assert.equal(
    await receiptStatus(other.businessId, foreignReceiptId),
    "pending",
  );
  const before = await txCount(biz.businessId);

  const res = await postTx({ receiptId: foreignReceiptId });
  assert.equal(res.status, 404);
  assert.equal(res.json.error, "Receipt not found");

  assert.equal(await txCount(biz.businessId), before);
  // The other tenant's receipt was neither claimed nor touched.
  assert.equal(
    await receiptStatus(other.businessId, foreignReceiptId),
    "pending",
  );
  const leaked = await pool.query(
    "SELECT 1 FROM transactions WHERE receipt_id = $1",
    [foreignReceiptId],
  );
  assert.equal(leaked.rowCount, 0);
});

test("without a receiptId the response shape is unchanged", async (t) => {
  if (!biz) return t.skip("database not reachable");

  const res = await postTx({ merchant: "No receipt" });
  assert.equal(res.status, 201, res.json?.error);
  assert.equal("receipt" in res.json, false, "no receipt field");
  assert.equal(res.json.receipt_id, null);
  assert.equal(res.json.business_id, biz.businessId);
});

// ── Seams with routes/receipts.js ────────────────────────────

test("the web app's book-then-link sequence stays a 200 (idempotent link)", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Receipts.jsx creates the transaction with receiptId and THEN calls
  // PUT /receipts/:id/link with the new id. The booking already flipped the
  // receipt to 'linked', so the link must recognise "same transaction" and
  // answer 200 rather than 409 RECEIPT_LINKED.
  const rid = await insertReceipt(biz.businessId);
  const created = await postTx({ receiptId: rid, merchant: "Web flow" });
  assert.equal(created.status, 201, created.json?.error);

  const link = await api(srv.base, `/api/receipts/${rid}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: created.json.id },
  });
  assert.equal(link.status, 200, link.json?.error);
  assert.equal(link.json.message, "Receipt linked to transaction");
  assert.equal(await receiptStatus(biz.businessId, rid), "linked");
});

test("deleting the transaction releases its receipt so it can be booked again", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const rid = await insertReceipt(biz.businessId);
  const first = await postTx({ receiptId: rid, merchant: "To be deleted" });
  assert.equal(first.status, 201, first.json?.error);
  assert.equal(await receiptStatus(biz.businessId, rid), "linked");

  const del = await api(srv.base, `/api/transactions/${first.json.id}`, {
    method: "DELETE",
    token: biz.token,
  });
  assert.equal(del.status, 200, del.json?.error);
  assert.equal(del.json.message, "Transaction deleted");

  // Released: back to 'reviewed', nothing references it any more.
  assert.equal(await receiptStatus(biz.businessId, rid), "reviewed");
  const refs = await pool.query(
    "SELECT 1 FROM transactions WHERE receipt_id = $1 AND business_id = $2",
    [rid, biz.businessId],
  );
  assert.equal(refs.rowCount, 0);

  // …and bookable again — not a 409.
  const again = await postTx({ receiptId: rid, merchant: "Booked again" });
  assert.equal(again.status, 201, again.json?.error);
  assert.deepEqual(again.json.receipt, { id: rid, status: "linked" });
  assert.equal(await receiptStatus(biz.businessId, rid), "linked");
});

test("a link that re-points the transaction while it is being deleted cannot strand the new receipt", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Tx T carries receipt B. PUT /receipts/A/link {transactionId: T} and
  // DELETE /transactions/T race. The delete must release whatever T carries
  // at the moment the row goes — A, once the link has committed — and must
  // not deadlock with the link, which locks A, then T, then releases B.
  const receiptB = await insertReceipt(biz.businessId);
  const receiptA = await insertReceipt(biz.businessId);
  const created = await postTx({
    receiptId: receiptB,
    merchant: "Re-pointed while deleting",
  });
  assert.equal(created.status, 201, created.json?.error);
  const txId = created.json.id;

  // Stand in for the link route with a second pool client: take its locks
  // (receipt A, then T) so the delete's locking read has to wait on T, then
  // run the link's exact statement sequence and commit. The delete then
  // continues against the committed row, which now carries A.
  const link = await pool.connect();
  let del = null;
  try {
    await link.query("BEGIN");
    await link.query(
      "SELECT id FROM receipts WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [receiptA, biz.businessId],
    );
    await link.query(
      "SELECT id FROM transactions WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [txId, biz.businessId],
    );

    del = api(srv.base, `/api/transactions/${txId}`, {
      method: "DELETE",
      token: biz.token,
    }).catch((err) => ({ status: 0, json: { error: err.message } }));
    await waitForLockWaiter(
      "FROM transactions WHERE id = $1 AND business_id = $2",
    );

    await link.query(
      "UPDATE transactions SET receipt_id = $1 WHERE id = $2 AND business_id = $3",
      [receiptA, txId, biz.businessId],
    );
    await link.query(
      "UPDATE receipts SET status = 'linked' WHERE id = $1 AND business_id = $2",
      [receiptA, biz.businessId],
    );
    await link.query(
      `UPDATE receipts SET status = 'reviewed'
        WHERE id = $1 AND business_id = $2 AND status = 'linked'
          AND NOT EXISTS (
            SELECT 1 FROM transactions
             WHERE receipt_id = $1 AND business_id = $2
          )`,
      [receiptB, biz.businessId],
    );
    await link.query("COMMIT");
  } catch (err) {
    await link.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    link.release();
  }

  const res = await del;
  assert.equal(res.status, 200, res.json?.error);
  assert.equal(res.json.message, "Transaction deleted");

  // T went away carrying A, so A — not the B read before the lock — is the
  // receipt to release. Neither is left 'linked' with nothing referencing it.
  assert.equal(await receiptStatus(biz.businessId, receiptA), "reviewed");
  assert.equal(await receiptStatus(biz.businessId, receiptB), "reviewed");
  const refs = await pool.query(
    "SELECT COUNT(*)::int AS n FROM transactions WHERE business_id = $1 AND receipt_id = ANY($2::uuid[])",
    [biz.businessId, [receiptA, receiptB]],
  );
  assert.equal(refs.rows[0].n, 0);

  // …and A is bookable again — not stuck behind 409 RECEIPT_LINKED.
  const again = await postTx({
    receiptId: receiptA,
    merchant: "Booked after the race",
  });
  assert.equal(again.status, 201, again.json?.error);
  assert.deepEqual(again.json.receipt, { id: receiptA, status: "linked" });
});

test("a receipt left 'linked' with nothing referencing it can be booked and linked again", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Before DELETE /transactions/:id released receipts, deleting a booked
  // transaction left its receipt at 'linked' (the FK is ON DELETE SET NULL).
  // Such rows must not sit behind 409 RECEIPT_LINKED forever — there is no
  // unlink endpoint — so the guard only bites while a transaction of this
  // business still references the receipt.
  const stuckA = await insertReceipt(biz.businessId, "linked");
  const stuckB = await insertReceipt(biz.businessId, "linked");
  const dangling = await pool.query(
    "SELECT COUNT(*)::int AS n FROM transactions WHERE business_id = $1 AND receipt_id = ANY($2::uuid[])",
    [biz.businessId, [stuckA, stuckB]],
  );
  assert.equal(dangling.rows[0].n, 0);

  // Booking self-heals.
  const booked = await postTx({
    receiptId: stuckA,
    merchant: "Self-healed booking",
  });
  assert.equal(booked.status, 201, booked.json?.error);
  assert.deepEqual(booked.json.receipt, { id: stuckA, status: "linked" });
  assert.equal(booked.json.receipt_id, stuckA);
  // Now really referenced: the guard is back.
  const twice = await postTx({ receiptId: stuckA, merchant: "Twice" });
  assert.equal(twice.status, 409);
  assert.equal(twice.json.code, "RECEIPT_LINKED");

  // Linking self-heals too.
  const plain = await postTx({ merchant: "Plain, then linked" });
  assert.equal(plain.status, 201, plain.json?.error);
  const link = await api(srv.base, `/api/receipts/${stuckB}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: plain.json.id },
  });
  assert.equal(link.status, 200, link.json?.error);
  assert.equal(link.json.message, "Receipt linked to transaction");
  const tx = await pool.query(
    "SELECT receipt_id FROM transactions WHERE id = $1 AND business_id = $2",
    [plain.json.id, biz.businessId],
  );
  assert.equal(tx.rows[0].receipt_id, stuckB);
  assert.equal(await receiptStatus(biz.businessId, stuckB), "linked");
  // Referenced now: pointing it at another transaction is refused again.
  const elsewhere = await api(srv.base, `/api/receipts/${stuckB}/link`, {
    method: "PUT",
    token: biz.token,
    body: { transactionId: booked.json.id },
  });
  assert.equal(elsewhere.status, 409);
  assert.equal(elsewhere.json.code, "RECEIPT_LINKED");
});
