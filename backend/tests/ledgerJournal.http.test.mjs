/**
 * tests/ledgerJournal.http.test.mjs — manual journal entries + IVU
 * remittance over real HTTP (§1.5 harness).
 *
 * Exercises POST/GET /api/ledger/journal, /journal/:id/reverse and
 * POST /api/reports/ivu-remit against the real app: balance invariant,
 * per-line shape validation, cross-tenant account rejection, the
 * manual-only/once-only reversal rules, and — at the end — that the
 * trial balance still proves the whole session's postings.
 *
 * Skips when the database is unreachable (same convention as
 * httpHarness.test.mjs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null; // professional — hacienda (ivu-remit) is professional-tier
let otherBiz = null; // second tenant, only to prove account scoping

// Seeded COA account ids for `biz` (resolved in before()).
let cashId = null; // asset  — coa.accounts.cash
let rentId = null; // expense — coa.accounts.rent
let ivuId = null; // liability — coa.accounts.sales_tax_payable
let otherCashId = null; // `otherBiz`'s cash account — must be rejected

// Baseline trial-balance totals before we post anything, so the final
// assertion is exact even if registration ever seeds opening entries.
let baseDebits = 0;

// Entry ids threaded between tests (node:test runs them in file order).
let manualEntryId = null;
let ivuEntryId = null;

const ENTRY_DATE = "2026-08-01";
const MANUAL_AMOUNT = 123.45;
const IVU_AMOUNT = 57.89;
const MEMO = "Accrued August rent";

function findByKey(coaGroups, nameKey) {
  // GET /api/chart-of-accounts returns type groups of parent/child trees;
  // seeded system accounts are all roots, so one level is enough here.
  for (const group of coaGroups) {
    for (const acct of group.accounts) {
      if (acct.name_key === nameKey) return acct;
      const child = (acct.children || []).find((c) => c.name_key === nameKey);
      if (child) return child;
    }
  }
  return null;
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base, { plan: "professional" });
    otherBiz = await createTestBusiness(srv.base);

    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: biz.token,
    });
    assert.equal(coa.status, 200);
    cashId = findByKey(coa.json, "coa.accounts.cash")?.id;
    rentId = findByKey(coa.json, "coa.accounts.rent")?.id;
    ivuId = findByKey(coa.json, "coa.accounts.sales_tax_payable")?.id;

    const otherCoa = await api(srv.base, "/api/chart-of-accounts", {
      token: otherBiz.token,
    });
    otherCashId = findByKey(otherCoa.json, "coa.accounts.cash")?.id;

    if (!cashId || !rentId || !ivuId || !otherCashId) {
      throw new Error("seeded COA accounts not found");
    }

    const tb = await api(srv.base, "/api/ledger/trial-balance", {
      token: biz.token,
    });
    assert.equal(tb.status, 200);
    baseDebits = tb.json.total_debits;
  } catch (err) {
    console.log(`# harness: database not reachable — skipping (${err.message})`);
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (otherBiz) await otherBiz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("balanced manual entry posts (201)", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal", {
    method: "POST",
    token: biz.token,
    body: {
      date: ENTRY_DATE,
      description: "August rent accrual",
      lines: [
        { accountId: rentId, debit: MANUAL_AMOUNT, memo: MEMO },
        { accountId: cashId, credit: MANUAL_AMOUNT },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.entryId);
  manualEntryId = res.json.entryId;
});

test("posted entry appears in the journal as source_type 'manual' with its memo", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal?limit=50", {
    token: biz.token,
  });
  assert.equal(res.status, 200);
  const entry = res.json.entries.find((e) => e.id === manualEntryId);
  assert.ok(entry, "manual entry missing from journal listing");
  assert.equal(entry.source_type, "manual");
  assert.equal(entry.description, "August rent accrual");
  assert.equal(entry.lines.length, 2);

  const debitLine = entry.lines.find((l) => l.account_id === rentId);
  const creditLine = entry.lines.find((l) => l.account_id === cashId);
  assert.equal(Number(debitLine.debit), MANUAL_AMOUNT);
  assert.equal(Number(debitLine.credit), 0);
  assert.equal(debitLine.memo, MEMO);
  assert.equal(Number(creditLine.credit), MANUAL_AMOUNT);
});

test("unbalanced entry is rejected with a meaningful message", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal", {
    method: "POST",
    token: biz.token,
    body: {
      date: ENTRY_DATE,
      lines: [
        { accountId: rentId, debit: 100 },
        { accountId: cashId, credit: 99.99 }, // one cent off must be enough
      ],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /unbalanced/i);
});

test("fewer than 2 lines is rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal", {
    method: "POST",
    token: biz.token,
    body: {
      date: ENTRY_DATE,
      lines: [{ accountId: rentId, debit: 100 }],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /at least 2 lines/i);
});

test("a line with both a debit and a credit is rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal", {
    method: "POST",
    token: biz.token,
    body: {
      date: ENTRY_DATE,
      lines: [
        { accountId: rentId, debit: 50, credit: 50 },
        { accountId: cashId, credit: 0.0 },
      ],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /both a debit and a credit/i);
});

test("an account belonging to another business is rejected (tenant scoping)", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal", {
    method: "POST",
    token: biz.token,
    body: {
      date: ENTRY_DATE,
      lines: [
        { accountId: otherCashId, debit: 10 }, // other tenant's real cash id
        { accountId: cashId, credit: 10 },
      ],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /do not belong to this business/i);
});

test("malformed date is rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/journal", {
    method: "POST",
    token: biz.token,
    body: {
      date: "08/01/2026",
      lines: [
        { accountId: rentId, debit: 10 },
        { accountId: cashId, credit: 10 },
      ],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /YYYY-MM-DD/);
});

test("reversing the manual entry posts a mirror entry (201)", async (t) => {
  if (!biz) return t.skip("database not reachable");
  if (!manualEntryId) return t.skip("manual entry was not created");
  const res = await api(
    srv.base,
    `/api/ledger/journal/${manualEntryId}/reverse`,
    { method: "POST", token: biz.token, body: { date: ENTRY_DATE } },
  );
  assert.equal(res.status, 201);
  const reversalId = res.json.entryId;
  assert.ok(reversalId);

  // Both the original and its reversal stay visible — history is preserved,
  // and the reversal's lines are the original's with debit/credit swapped.
  const list = await api(srv.base, "/api/ledger/journal?limit=50", {
    token: biz.token,
  });
  const original = list.json.entries.find((e) => e.id === manualEntryId);
  const reversal = list.json.entries.find((e) => e.id === reversalId);
  assert.ok(original, "original entry disappeared after reversal");
  assert.ok(reversal, "reversal entry missing from journal");
  assert.equal(reversal.source_type, "reversal");
  assert.equal(reversal.reverses_entry_id, manualEntryId);
  const cashLine = reversal.lines.find((l) => l.account_id === cashId);
  assert.equal(Number(cashLine.debit), MANUAL_AMOUNT);
  assert.equal(Number(cashLine.credit), 0);
});

test("reversing the same entry again is rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  if (!manualEntryId) return t.skip("manual entry was not created");
  const res = await api(
    srv.base,
    `/api/ledger/journal/${manualEntryId}/reverse`,
    { method: "POST", token: biz.token },
  );
  assert.equal(res.status, 400);
  assert.match(res.json.error, /already been reversed/i);
});

test("IVU remittance posts debit IVU payable / credit funding asset (201)", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/reports/ivu-remit", {
    method: "POST",
    token: biz.token,
    body: { date: ENTRY_DATE, amount: IVU_AMOUNT, fundingCoaId: cashId },
  });
  assert.equal(res.status, 201);
  ivuEntryId = res.json.entryId;
  assert.ok(ivuEntryId);

  const list = await api(srv.base, "/api/ledger/journal?limit=50", {
    token: biz.token,
  });
  const entry = list.json.entries.find((e) => e.id === ivuEntryId);
  assert.ok(entry, "ivu_remittance entry missing from journal");
  assert.equal(entry.source_type, "ivu_remittance");
  const ivuLine = entry.lines.find((l) => l.account_id === ivuId);
  const fundingLine = entry.lines.find((l) => l.account_id === cashId);
  assert.equal(Number(ivuLine.debit), IVU_AMOUNT);
  assert.equal(Number(fundingLine.credit), IVU_AMOUNT);
});

test("IVU remittance funded from a non-asset account is rejected", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Paying Hacienda "from" a liability would fabricate money.
  const res = await api(srv.base, "/api/reports/ivu-remit", {
    method: "POST",
    token: biz.token,
    body: { date: ENTRY_DATE, amount: 10, fundingCoaId: ivuId },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Invalid funding account/i);
});

test("non-manual entries cannot be reversed via the journal route", async (t) => {
  if (!biz) return t.skip("database not reachable");
  if (!ivuEntryId) return t.skip("ivu entry was not created");
  const res = await api(srv.base, `/api/ledger/journal/${ivuEntryId}/reverse`, {
    method: "POST",
    token: biz.token,
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Only manual entries/i);
});

test("trial balance still balances to the cent after everything", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/ledger/trial-balance", {
    token: biz.token,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.balances, true);
  assert.equal(res.json.total_debits, res.json.total_credits);

  // Exactly the three postings that succeeded: manual + its reversal + remit.
  const expected =
    Math.round((baseDebits + 2 * MANUAL_AMOUNT + IVU_AMOUNT) * 100) / 100;
  assert.equal(res.json.total_debits, expected);

  // The remit drained IVU payable below what was collected (nothing was
  // collected) — natural balance goes negative, but the books still balance.
  const ivuRow = res.json.accounts.find((a) => a.id === ivuId);
  assert.equal(ivuRow.natural_balance, -IVU_AMOUNT);
});
