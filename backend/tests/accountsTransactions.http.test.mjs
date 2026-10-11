/**
 * tests/accountsTransactions.http.test.mjs — the endpoints the phone's
 * Accounts tab (ROADMAP-V6 2.15: account list, per-account transaction
 * list, CSV import/export) reads, pinned over real HTTP (§1.5 harness).
 * None of them changed for the phone; these tests freeze the shapes it
 * depends on so a later edit surfaces here first. Any shape change below
 * must bump MIN_MOBILE_BUILD (app.js) so older builds show "update".
 *
 *   GET  /api/accounts                   array; NUMERIC/COUNT columns are
 *                                        strings; is_active boolean; active
 *                                        accounts first
 *   GET  /api/accounts/:id               live header, 404 for unknown and
 *                                        malformed ids
 *   GET  /api/accounts/summary/balances  SUMs are null with zero active
 *                                        accounts; account_count is a string
 *   GET  /api/transactions               { transactions, total, limit, offset }
 *                                        envelope; dates as ISO timestamps
 *   POST /api/transactions/import        { imported, skipped, total };
 *                                        400 { error, errors[{ row, error }] };
 *                                        duplicate skip on re-import; 2001 rows
 *   GET  /api/transactions/export        200 text/csv, fixed header, CRLF,
 *                                        signed amounts, Content-Disposition
 *
 * Accounts are created through the real POST /api/accounts (ledger twin +
 * opening entry), rows through the real import. Skips when the database is
 * unreachable, same as the other *.http.test.mjs suites.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

const MAX_IMPORT_ROWS = 2000; // routes/transactions.js MAX_IMPORT_ROWS
const EXPORT_HEADER = "Date,Merchant,Category,Account,Type,Amount,Notes";
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The first file the phone would send: one income with notes, one expense
// whose merchant needs CSV quoting (comma + quotes), one expense with no
// merchant at all.
const FIRST_BATCH = [
  {
    date: "2026-09-01",
    amount: 50,
    merchant: "Client payment",
    notes: "Invoice 12",
  },
  { date: "2026-09-02", amount: -25.5, merchant: 'Ferretería, "La Esquina"' },
  { date: "2026-09-03", amount: -10 },
];

let srv = null;
let biz = null;
let checking = null; // active current account; receives every import
let dormant = null; // savings account deactivated right after creation

/** NUMERIC/COUNT columns reach the client as plain decimal strings. */
function assertNumeric(value, expected, label) {
  assert.equal(typeof value, "string", `${label} is a string`);
  assert.match(value, NUMERIC_RE, `${label} is a plain decimal string`);
  assert.equal(Number(value), expected, label);
}

/**
 * pg parses a DATE column at local midnight and JSON serialises it as an
 * ISO timestamp; reading it back in the same process recovers the calendar
 * day regardless of the machine's timezone.
 */
function localDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function accountsList(token = biz.token) {
  const res = await api(srv.base, "/api/accounts", { token });
  assert.equal(res.status, 200, res.json?.error);
  assert.ok(Array.isArray(res.json), "GET /accounts is a bare array");
  return res.json;
}

async function balances(token = biz.token) {
  const res = await api(srv.base, "/api/accounts/summary/balances", { token });
  assert.equal(res.status, 200, res.json?.error);
  return res.json;
}

async function listTx(query = "", token = biz.token) {
  const res = await api(srv.base, `/api/transactions${query}`, { token });
  assert.equal(res.status, 200, res.json?.error);
  return res.json;
}

async function importRows(body, token = biz.token) {
  return api(srv.base, "/api/transactions/import", {
    method: "POST",
    token,
    body,
  });
}

async function exportCsv(query = "", token = biz.token) {
  return api(srv.base, `/api/transactions/export${query}`, { token });
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base); // starter: no gate on either router
  } catch (err) {
    console.log(
      `# accounts/transactions: database not reachable — skipping (${err.message})`,
    );
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

// ── Accounts ─────────────────────────────────────────────────

test('a fresh business has no accounts and the balance summary is all-null SUMs with account_count "0"', async (t) => {
  if (!biz) return t.skip("database not reachable");
  assert.deepEqual(await accountsList(), []);
  // SUM over zero rows is NULL in SQL; COUNT(*) is a bigint → string.
  assert.deepEqual(await balances(), {
    total_balance: null,
    bank_balance: null,
    credit_balance: null,
    cash_balance: null,
    account_count: "0",
  });
});

test("POST /accounts creates operational accounts; the list carries string NUMERICs, is_active, and puts active accounts first", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const created = await api(srv.base, "/api/accounts", {
    method: "POST",
    token: biz.token,
    body: {
      name: "Checking",
      type: "current",
      currency: "USD",
      currentBalance: 100,
    },
  });
  assert.equal(created.status, 201, created.json?.error);
  checking = created.json;
  assert.match(checking.id, UUID_RE);
  assert.match(checking.coa_account_id, UUID_RE, "ledger twin linked");
  assert.equal(checking.is_active, true);

  const second = await api(srv.base, "/api/accounts", {
    method: "POST",
    token: biz.token,
    body: { name: "Old savings", type: "savings", currentBalance: 40 },
  });
  assert.equal(second.status, 201, second.json?.error);
  dormant = second.json;
  const off = await api(srv.base, `/api/accounts/${dormant.id}`, {
    method: "PUT",
    token: biz.token,
    body: { isActive: false },
  });
  assert.equal(off.status, 200, off.json?.error);
  assert.equal(off.json.is_active, false);

  const list = await accountsList();
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((a) => a.id),
    [checking.id, dormant.id],
    "active first, then creation order",
  );

  const row = list[0];
  assert.equal(row.name, "Checking");
  assert.equal(row.type, "current");
  assert.equal(row.currency, "USD");
  assert.equal(row.is_active, true);
  assert.equal(row.coa_account_id, checking.coa_account_id);
  assert.equal(row.plaid_account_id, null);
  assertNumeric(row.current_balance, 100, "current_balance");
  assertNumeric(row.total_income, 0, "total_income");
  assertNumeric(row.total_expenses, 0, "total_expenses");
  assertNumeric(row.transaction_count, 0, "transaction_count");
  assert.equal(typeof row.created_at, "string");
  assert.ok(!Number.isNaN(Date.parse(row.created_at)), "created_at is ISO");

  assert.equal(list[1].is_active, false);
  assert.equal(list[1].type, "savings");
  assertNumeric(list[1].current_balance, 40, "dormant current_balance");

  // The summary only counts active accounts; the inactive 40 is excluded.
  const sum = await balances();
  assert.equal(sum.account_count, "1");
  assertNumeric(sum.total_balance, 100, "total_balance");
  assertNumeric(sum.bank_balance, 100, "bank_balance (current + savings)");
  assertNumeric(sum.credit_balance, 0, "credit_balance");
  assertNumeric(sum.cash_balance, 0, "cash_balance");
});

test("GET /accounts/:id serves the live header without the list-only totals; unknown and malformed ids are 404", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const one = await api(srv.base, `/api/accounts/${checking.id}`, {
    token: biz.token,
  });
  assert.equal(one.status, 200, one.json?.error);
  assert.equal(one.json.id, checking.id);
  assert.equal(one.json.name, "Checking");
  assert.equal(one.json.type, "current");
  assert.equal(one.json.currency, "USD");
  assert.equal(one.json.is_active, true);
  assertNumeric(one.json.current_balance, 100, "detail current_balance");
  assert.deepEqual(one.json.recent_transactions, []);
  // The phone reads transaction_count / total_income / total_expenses from
  // the list row because the detail endpoint does not carry them.
  assert.equal("transaction_count" in one.json, false);
  assert.equal("total_income" in one.json, false);

  const missing = await api(srv.base, `/api/accounts/${crypto.randomUUID()}`, {
    token: biz.token,
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: "Account not found" });

  const malformed = await api(srv.base, "/api/accounts/not-a-uuid", {
    token: biz.token,
  });
  assert.equal(malformed.status, 404);
  assert.deepEqual(malformed.json, { error: "Account not found" });
});

// ── Import ───────────────────────────────────────────────────

test("POST /transactions/import books a batch into the account and answers { imported, skipped, total }", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await importRows({
    accountId: checking.id,
    rows: FIRST_BATCH,
    skipDuplicates: true,
  });
  assert.equal(res.status, 200, res.json?.error);
  assert.deepEqual(res.json, { imported: 3, skipped: 0, total: 3 });

  // The paged list the phone reads: object envelope, newest first.
  const page = await listTx(`?accountId=${checking.id}`);
  assert.deepEqual(Object.keys(page).sort(), [
    "limit",
    "offset",
    "total",
    "transactions",
  ]);
  assert.equal(page.total, 3);
  assert.equal(page.limit, 50);
  assert.equal(page.offset, 0);
  assert.equal(page.transactions.length, 3);
  assert.deepEqual(
    page.transactions.map((tx) => tx.merchant),
    [null, 'Ferretería, "La Esquina"', "Client payment"],
  );

  for (const tx of page.transactions) {
    assert.equal(tx.account_id, checking.id);
    assert.equal(tx.funding_coa_id, null, "account imports carry no COA id");
    assert.equal(tx.account_name, "Checking");
    assert.equal(typeof tx.total_amount, "string");
    assert.match(tx.total_amount, NUMERIC_RE);
    // DATE columns arrive as ISO timestamps, never "YYYY-MM-DD".
    assert.equal(typeof tx.date, "string");
    assert.match(tx.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(tx.is_split, false);
    assert.equal(tx.receipt_id, null);
    assert.equal(tx.reconciliation_id, null);
    assert.equal(tx.recurring_id, null);
    assert.equal(tx.original_currency, null);
    assert.ok(Array.isArray(tx.splits));
    assert.equal(tx.splits.length, 1);
    assert.equal(typeof tx.splits[0].amount, "number", "splits[].amount");
  }

  const income = page.transactions.find(
    (tx) => tx.merchant === "Client payment",
  );
  assert.equal(income.type, "income");
  assertNumeric(income.total_amount, 50, "income total_amount");
  assert.equal(income.notes, "Invoice 12");
  assert.equal(localDate(income.date), "2026-09-01");
  assert.equal(income.splits[0].name_key, "coa.accounts.other_income");
  assert.equal(income.splits[0].amount, 50);

  const quoted = page.transactions.find(
    (tx) => tx.merchant === 'Ferretería, "La Esquina"',
  );
  assert.equal(quoted.type, "expense", "negative amount books an expense");
  assertNumeric(quoted.total_amount, 25.5, "expense total_amount (abs)");
  assert.equal(quoted.notes, null);
  assert.equal(localDate(quoted.date), "2026-09-02");
  assert.equal(quoted.splits[0].name_key, "coa.accounts.other_expense");

  const bare = page.transactions.find((tx) => tx.merchant === null);
  assert.equal(bare.type, "expense");
  assertNumeric(bare.total_amount, 10, "bare total_amount");
  assert.equal(localDate(bare.date), "2026-09-03");

  // Account totals and the summary moved with the ledger: 100 + 50 − 35.5.
  const row = (await accountsList()).find((a) => a.id === checking.id);
  assertNumeric(row.transaction_count, 3, "transaction_count");
  assertNumeric(row.total_income, 50, "total_income");
  assertNumeric(row.total_expenses, 35.5, "total_expenses");
  assertNumeric(row.current_balance, 114.5, "current_balance");
  const sum = await balances();
  assert.equal(sum.account_count, "1");
  assertNumeric(sum.total_balance, 114.5, "summary total_balance");
});

test("re-importing the same file skips every row; a mixed batch books only the new ones", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // skipDuplicates defaults to true — the phone's forced-skip retry relies on it.
  const again = await importRows({ accountId: checking.id, rows: FIRST_BATCH });
  assert.equal(again.status, 200, again.json?.error);
  assert.deepEqual(again.json, { imported: 0, skipped: 3, total: 3 });
  assert.equal((await listTx(`?accountId=${checking.id}`)).total, 3);

  // Dedupe key is date + amount + merchant within the account: a row that
  // differs only by merchant (same date, amount AND notes) is new.
  const partial = await importRows({
    accountId: checking.id,
    rows: [
      FIRST_BATCH[0],
      { ...FIRST_BATCH[0], merchant: "Other client" },
      { date: "2026-09-04", amount: -7.25, merchant: "Parking" },
    ],
  });
  assert.equal(partial.status, 200, partial.json?.error);
  assert.deepEqual(partial.json, { imported: 2, skipped: 1, total: 3 });

  const all = await listTx(`?accountId=${checking.id}`);
  assert.equal(all.total, 5);
  assert.equal(all.transactions.length, 5);

  // List filters the phone writes: type, date range, limit/offset.
  const expenses = await listTx(`?accountId=${checking.id}&type=expense`);
  assert.equal(expenses.total, 3);
  assert.ok(expenses.transactions.every((tx) => tx.type === "expense"));

  const ranged = await listTx(
    `?accountId=${checking.id}&startDate=2026-09-02&endDate=2026-09-03`,
  );
  assert.equal(ranged.total, 2);
  assert.deepEqual(
    ranged.transactions.map((tx) => localDate(tx.date)),
    ["2026-09-03", "2026-09-02"],
  );

  const page2 = await listTx(`?accountId=${checking.id}&limit=2&offset=1`);
  assert.equal(page2.total, 5, "total ignores paging");
  assert.equal(page2.limit, 2);
  assert.equal(page2.offset, 1);
  assert.equal(page2.transactions.length, 2);
  assert.deepEqual(
    page2.transactions.map((tx) => tx.id),
    all.transactions.slice(1, 3).map((tx) => tx.id),
  );

  const row = (await accountsList()).find((a) => a.id === checking.id);
  assertNumeric(row.transaction_count, 5, "transaction_count");
  assertNumeric(row.total_income, 100, "total_income");
  assertNumeric(row.total_expenses, 42.75, "total_expenses");
  assertNumeric(row.current_balance, 157.25, "current_balance");
  assertNumeric((await balances()).total_balance, 157.25, "total_balance");
});

test("a batch with invalid rows is refused as a whole with a per-row errors[] list", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const before = (await listTx(`?accountId=${checking.id}`)).total;

  const res = await importRows({
    accountId: checking.id,
    rows: [
      { date: "2026-09-10", amount: 12, merchant: "Fine" },
      { date: "09/10/2026", amount: 12 },
      { date: "2026-09-10", amount: 0 },
      { date: "2026-09-10", amount: "abc" },
      { amount: 5 },
    ],
  });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.json.error, "Some rows are invalid");
  assert.deepEqual(res.json.errors, [
    { row: 2, error: "Invalid date (expected YYYY-MM-DD)" },
    { row: 3, error: "Invalid or zero amount" },
    { row: 4, error: "Invalid or zero amount" },
    { row: 5, error: "Invalid date (expected YYYY-MM-DD)" },
  ]);
  assert.equal(
    (await listTx(`?accountId=${checking.id}`)).total,
    before,
    "the valid row 1 was not booked either",
  );

  // errors[] is capped at 25 entries.
  const many = await importRows({
    accountId: checking.id,
    rows: Array.from({ length: 30 }, () => ({ date: "bad", amount: 1 })),
  });
  assert.equal(many.status, 400);
  assert.equal(many.json.errors.length, 25);
  assert.equal(many.json.errors[24].row, 25);
});

test("the remaining 400 shapes the phone shows verbatim, and 2001 rows are refused", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const noAccount = await importRows({ rows: FIRST_BATCH });
  assert.equal(noAccount.status, 400);
  assert.deepEqual(noAccount.json, { error: "A funding account is required" });

  const empty = await importRows({ accountId: checking.id, rows: [] });
  assert.equal(empty.status, 400);
  assert.deepEqual(empty.json, { error: "No rows to import" });

  const unknown = await importRows({
    accountId: crypto.randomUUID(),
    rows: [FIRST_BATCH[0]],
  });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.json, { error: "Account not found" });

  const tooMany = await importRows({
    accountId: checking.id,
    rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({
      date: "2026-01-01",
      amount: i + 1,
    })),
  });
  assert.equal(tooMany.status, 400, tooMany.text);
  assert.deepEqual(tooMany.json, {
    error: `Too many rows (max ${MAX_IMPORT_ROWS} per import)`,
  });
  assert.equal((await listTx(`?accountId=${checking.id}`)).total, 5);
});

// ── Export ───────────────────────────────────────────────────

test("GET /transactions/export is text/csv with the fixed header, CRLF rows, signed amounts and a download filename", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await exportCsv(`?accountId=${checking.id}`);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(
    res.headers.get("content-disposition"),
    /^attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"$/,
  );
  assert.equal(res.json, null, "body is not JSON");

  const { text } = res;
  assert.ok(text.startsWith(EXPORT_HEADER), "no BOM; header is the first line");
  assert.ok(text.includes("\r\n"));
  assert.equal(
    text.split("\n").length,
    text.split("\r\n").length,
    "every line break is CRLF",
  );
  assert.ok(!text.endsWith("\n"), "no trailing newline");

  const lines = text.split("\r\n");
  assert.equal(lines[0], EXPORT_HEADER);
  assert.equal(lines.length, 1 + 5, "one line per transaction, no cap");
  // Newest first (date DESC, created_at DESC); expense amounts negative;
  // cells quoted only when needed; null merchant/notes are empty cells;
  // system categories are prettified from their name_key.
  assert.deepEqual(lines.slice(1), [
    "2026-09-04,Parking,Other Expense,Checking,expense,-7.25,",
    "2026-09-03,,Other Expense,Checking,expense,-10.00,",
    '2026-09-02,"Ferretería, ""La Esquina""",Other Expense,Checking,expense,-25.50,',
    "2026-09-01,Other client,Other Income,Checking,income,50.00,Invoice 12",
    "2026-09-01,Client payment,Other Income,Checking,income,50.00,Invoice 12",
  ]);

  // Same filters as the list.
  const expenses = await exportCsv(`?accountId=${checking.id}&type=expense`);
  assert.equal(expenses.status, 200, expenses.text);
  const expenseLines = expenses.text.split("\r\n");
  assert.equal(expenseLines.length, 1 + 3);
  assert.ok(expenseLines.slice(1).every((l) => l.includes(",expense,-")));

  const ranged = await exportCsv(
    `?accountId=${checking.id}&startDate=2026-09-02&endDate=2026-09-03`,
  );
  assert.equal(ranged.status, 200, ranged.text);
  assert.deepEqual(
    ranged.text.split("\r\n").map((l) => l.slice(0, 10)),
    ["Date,Merch", "2026-09-03", "2026-09-02"],
  );
});

test("an export with nothing to list is the header line alone", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // The phone treats a body with no line break after the header as empty.
  const future = await exportCsv(
    `?accountId=${checking.id}&startDate=2030-01-01`,
  );
  assert.equal(future.status, 200, future.text);
  assert.equal(future.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(future.text, EXPORT_HEADER);

  const noRows = await exportCsv(`?accountId=${dormant.id}`);
  assert.equal(noRows.status, 200, noRows.text);
  assert.equal(noRows.text, EXPORT_HEADER);
});

// ── Multi-tenant scoping ─────────────────────────────────────

test("another business sees none of it: empty list, 404 detail, header-only export, import refused", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const other = await createTestBusiness(srv.base);
  try {
    assert.deepEqual(await accountsList(other.token), []);
    assert.equal((await balances(other.token)).account_count, "0");

    const detail = await api(srv.base, `/api/accounts/${checking.id}`, {
      token: other.token,
    });
    assert.equal(detail.status, 404);

    const list = await listTx(`?accountId=${checking.id}`, other.token);
    assert.equal(list.total, 0);
    assert.deepEqual(list.transactions, []);

    const csv = await exportCsv(`?accountId=${checking.id}`, other.token);
    assert.equal(csv.status, 200, csv.text);
    assert.equal(csv.text, EXPORT_HEADER);

    const imp = await importRows(
      { accountId: checking.id, rows: [FIRST_BATCH[0]] },
      other.token,
    );
    assert.equal(imp.status, 400);
    assert.deepEqual(imp.json, { error: "Account not found" });

    // Nothing leaked into the owning account.
    assert.equal((await listTx(`?accountId=${checking.id}`)).total, 5);
  } finally {
    await other.destroy();
  }
});
