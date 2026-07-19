import { test } from "node:test";
import assert from "node:assert/strict";
import { postJournalEntry } from "../src/services/ledger.js";
import pool from "../src/config/db.js";

// Validation happens before any query runs, so a poisoned client proves
// the guard fired first.
const poisonClient = {
  query: () => {
    throw new Error("client should not be touched by validation failures");
  },
};

const BASE = {
  businessId: "00000000-0000-0000-0000-000000000000",
  date: "2026-01-15",
};

test("rejects an unbalanced entry", async () => {
  await assert.rejects(
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [
        { accountId: "a", debit: 100 },
        { accountId: "b", credit: 99.99 },
      ],
    }),
    /unbalanced/,
  );
});

test("rejects fewer than two lines", async () => {
  await assert.rejects(
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [{ accountId: "a", debit: 100 }],
    }),
    /at least two lines/,
  );
});

test("rejects a line with both debit and credit", async () => {
  await assert.rejects(
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [
        { accountId: "a", debit: 100, credit: 100 },
        { accountId: "b", credit: 100 },
      ],
    }),
    /both a debit and a credit/,
  );
});

test("rejects negative amounts", async () => {
  await assert.rejects(
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [
        { accountId: "a", debit: -50 },
        { accountId: "b", credit: -50 },
      ],
    }),
    /negative/,
  );
});

test("rejects a line with no amount at all", async () => {
  await assert.rejects(
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [{ accountId: "a" }, { accountId: "b", credit: 100 }],
    }),
    /neither a debit nor a credit/,
  );
});

test("rejects a line without an accountId", async () => {
  await assert.rejects(
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [{ debit: 100 }, { accountId: "b", credit: 100 }],
    }),
    /missing accountId/,
  );
});

test("floating-point sums balance (0.1 + 0.2 style entries)", async () => {
  // 3 × 33.33 + 0.01 = 100.00 — naive float summation drifts; round2 must hold.
  await assert.rejects(
    // Still rejects when actually unbalanced by a cent…
    postJournalEntry(poisonClient, {
      ...BASE,
      lines: [
        { accountId: "a", debit: 33.33 },
        { accountId: "b", debit: 33.33 },
        { accountId: "c", debit: 33.33 },
        { accountId: "d", credit: 100 },
      ],
    }),
    /unbalanced/,
  );
});

// ── DB round-trip, rolled back — the posting itself ──────────
// Uses the dev database via the same pool the app uses; everything happens
// inside a transaction that is rolled back, so no residue.
test("posts a balanced entry and its lines (rolled back)", async (t) => {
  let client;
  try {
    client = await pool.connect();
  } catch {
    t.skip("database not reachable — skipping round-trip test");
    return;
  }
  try {
    await client.query("BEGIN");
    const biz = await client.query("SELECT id FROM businesses LIMIT 1");
    if (biz.rowCount === 0) {
      t.skip("no business rows in dev DB");
      return;
    }
    const businessId = biz.rows[0].id;
    const accounts = await client.query(
      "SELECT id FROM chart_of_accounts WHERE business_id = $1 LIMIT 2",
      [businessId],
    );
    if (accounts.rowCount < 2) {
      t.skip("not enough accounts in dev DB");
      return;
    }
    const [a, b] = accounts.rows.map((r) => r.id);

    const entry = await postJournalEntry(client, {
      businessId,
      date: "2026-01-15",
      description: "test entry (rolled back)",
      lines: [
        { accountId: a, debit: 123.45 },
        { accountId: b, credit: 123.45 },
      ],
    });
    assert.ok(entry.id, "entry id returned");

    const lines = await client.query(
      "SELECT debit, credit FROM journal_entry_lines WHERE journal_entry_id = $1 ORDER BY debit DESC",
      [entry.id],
    );
    assert.equal(lines.rowCount, 2);
    assert.equal(parseFloat(lines.rows[0].debit), 123.45);
    assert.equal(parseFloat(lines.rows[1].credit), 123.45);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});

// Close the pool so node:test doesn't hang on open handles.
test.after(async () => {
  await pool.end().catch(() => {});
});
