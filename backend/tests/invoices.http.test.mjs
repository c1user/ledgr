/**
 * tests/invoices.http.test.mjs — invoicing + IVU money flow over real HTTP
 * (§1.5 harness). Professional plan (invoicing + hacienda gates).
 *
 * What must never break here: totals are computed SERVER-side from line
 * items (the client can't dictate money), the SC 2915 state/muni split
 * always satisfies state + muni === tax_total, and the invoice lifecycle
 * (send → pay → void) posts/removes balanced journal entries.
 *
 * Skips when the database is unreachable, same as httpHarness.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

let srv = null;
let biz = null;
let clientId = null; // regular (taxable) client
let exemptClientId = null; // tax_exempt client
let depositAccountId = null; // operational account for PAY
let depositCoaId = null; // its ledger (COA) twin
let lifecycle = null; // invoice shared across send → put → pay → void

// Compare money as integer cents so 0.1+0.2 float noise can't pass/fail a test.
const cents = (v) => Math.round(Number(v) * 100);

async function createInvoice(body) {
  const res = await api(srv.base, "/api/invoices", {
    method: "POST",
    token: biz.token,
    body,
  });
  assert.equal(res.status, 201, `create invoice: ${res.json?.error}`);
  return res.json;
}

async function journalEntriesFor(sourceType, sourceId) {
  const res = await api(srv.base, "/api/ledger/journal?limit=200", {
    token: biz.token,
  });
  assert.equal(res.status, 200);
  return res.json.entries.filter(
    (e) => e.source_type === sourceType && e.source_id === sourceId,
  );
}

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base, { plan: "professional" });

    // Clients get NO billing_email on purpose: send/resend then short-circuits
    // email delivery ("Client has no billing email") instead of touching SMTP,
    // keeping the suite fast and offline while still exercising the ledger.
    const c1 = await api(srv.base, "/api/clients", {
      method: "POST",
      token: biz.token,
      body: { name: "Cafetería Borinquen" },
    });
    if (c1.status !== 201) throw new Error(`client create failed (${c1.status})`);
    clientId = c1.json.id;

    const c2 = await api(srv.base, "/api/clients", {
      method: "POST",
      token: biz.token,
      body: { name: "Municipio Exento", tax_exempt: true },
    });
    if (c2.status !== 201)
      throw new Error(`exempt client create failed (${c2.status})`);
    exemptClientId = c2.json.id;

    // Deposit-to account for PAY. The create response is echoed before the
    // COA twin is linked, so re-read the account to learn coa_account_id.
    const acc = await api(srv.base, "/api/accounts", {
      method: "POST",
      token: biz.token,
      body: { name: "Checking (invoice tests)", type: "current" },
    });
    if (acc.status !== 201)
      throw new Error(`account create failed (${acc.status})`);
    depositAccountId = acc.json.id;
    const acc2 = await api(srv.base, `/api/accounts/${depositAccountId}`, {
      token: biz.token,
    });
    depositCoaId = acc2.json?.coa_account_id;
    if (!depositCoaId)
      throw new Error("deposit account has no linked COA account");
  } catch (err) {
    console.log(
      `# invoices: database not reachable — skipping (${err.message})`,
    );
    biz = null;
  }
});

test.after(async () => {
  if (biz) await biz.destroy();
  if (srv) await srv.close();
  await pool.end().catch(() => {});
});

test("IVU 11.5% + 1% muni: server-computed totals exact to the cent", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // 3 × $33.33 = $99.99 → 11.5% = 11.49885, which must round UP to 11.50.
  const inv = await createInvoice({
    clientId,
    issueDate: "2026-01-10",
    dueDate: "2026-02-09",
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    lineItems: [{ description: "Cajas de café", quantity: 3, unitPrice: 33.33 }],
  });
  assert.equal(inv.status, "draft");
  assert.equal(inv.tax_type, "ivu");
  assert.equal(cents(inv.subtotal), 9999);
  assert.equal(cents(inv.tax_total), 1150);
  assert.equal(cents(inv.tax_muni_total), 100); // 0.9999 → 1.00
  assert.equal(cents(inv.tax_state_total), 1050); // derived: 11.50 − 1.00
  assert.equal(cents(inv.total), 11149);
  // SC 2915 identity — state + muni must reconstruct the combined tax exactly.
  assert.equal(
    cents(inv.tax_state_total) + cents(inv.tax_muni_total),
    cents(inv.tax_total),
  );
});

test("4% designated-services SUT is state-only", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const inv = await createInvoice({
    clientId,
    issueDate: "2026-01-15",
    dueDate: "2026-02-14",
    taxType: "ivu",
    taxRate: 4,
    taxMuniRate: 0,
    lineItems: [
      { description: "Servicios profesionales", quantity: 1, unitPrice: 250 },
    ],
  });
  assert.equal(cents(inv.subtotal), 25000);
  assert.equal(cents(inv.tax_total), 1000);
  assert.equal(cents(inv.tax_state_total), 1000);
  assert.equal(cents(inv.tax_muni_total), 0);
  assert.equal(cents(inv.total), 26000);
});

test("omitted taxMuniRate defaults by rate: >=5% assumes 1% muni, 4% assumes none", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const std = await createInvoice({
    clientId,
    issueDate: "2026-01-20",
    dueDate: "2026-02-19",
    taxType: "ivu",
    taxRate: 11.5,
    // taxMuniRate omitted → defaults to the 1% municipal SUT
    lineItems: [{ description: "Mercancía", quantity: 4, unitPrice: 50 }],
  });
  assert.equal(Number(std.tax_muni_rate), 1);
  assert.equal(cents(std.tax_total), 2300); // 200 × 11.5%
  assert.equal(cents(std.tax_muni_total), 200); // 200 × 1%
  assert.equal(cents(std.tax_state_total), 2100);

  const svc = await createInvoice({
    clientId,
    issueDate: "2026-01-21",
    dueDate: "2026-02-20",
    taxType: "ivu",
    taxRate: 4,
    // taxMuniRate omitted → below 5% means state-only
    lineItems: [{ description: "Consultoría B2B", quantity: 4, unitPrice: 50 }],
  });
  assert.equal(Number(svc.tax_muni_rate), 0);
  assert.equal(cents(svc.tax_total), 800);
  assert.equal(cents(svc.tax_state_total), 800);
  assert.equal(cents(svc.tax_muni_total), 0);
});

test("tax-exempt client forces zero tax regardless of requested rates", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const inv = await createInvoice({
    clientId: exemptClientId,
    issueDate: "2026-02-01",
    dueDate: "2026-03-03",
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    lineItems: [{ description: "Suministros", quantity: 2, unitPrice: 75.5 }],
  });
  assert.equal(cents(inv.subtotal), 15100);
  assert.equal(cents(inv.tax_total), 0);
  assert.equal(cents(inv.tax_state_total), 0);
  assert.equal(cents(inv.tax_muni_total), 0);
  assert.equal(cents(inv.total), cents(inv.subtotal));
});

test("client-sent money fields are ignored and recomputed", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Bogus totals in the body AND on the line item — the server must derive
  // everything from quantity × unit_price only.
  const inv = await createInvoice({
    clientId,
    issueDate: "2026-02-05",
    dueDate: "2026-03-07",
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    subtotal: 0.01,
    tax_total: 0,
    tax_state_total: 0,
    tax_muni_total: 0,
    total: 0.02,
    lineItems: [
      { description: "Item", quantity: 2, unitPrice: 10, total: 999999 },
    ],
  });
  assert.equal(cents(inv.subtotal), 2000);
  assert.equal(cents(inv.line_items[0].total), 2000);
  assert.equal(cents(inv.tax_total), 230);
  assert.equal(cents(inv.tax_muni_total), 20);
  assert.equal(cents(inv.tax_state_total), 210);
  assert.equal(cents(inv.total), 2230);
});

test("SEND posts one balanced journal entry with the sales-tax credit", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // 7 × $19.99 = $139.93 → tax 16.09, muni 1.40, state 14.69, total 156.02.
  const inv = await createInvoice({
    clientId,
    issueDate: "2026-03-10",
    dueDate: "2026-04-09",
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    lineItems: [{ description: "Almuerzos", quantity: 7, unitPrice: 19.99 }],
  });

  const sent = await api(srv.base, `/api/invoices/${inv.id}/send`, {
    method: "POST",
    token: biz.token,
    body: {},
  });
  assert.equal(sent.status, 200, sent.json?.error);
  assert.equal(sent.json.status, "sent");

  const entries = await journalEntriesFor("invoice", inv.id);
  assert.equal(entries.length, 1);
  const lines = entries[0].lines;

  const debits = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credits = lines.reduce((s, l) => s + cents(l.credit), 0);
  assert.equal(debits, credits); // the double-entry invariant
  assert.equal(debits, 15602); // AR carries the full total

  const ar = lines.find(
    (l) => l.account_name_key === "coa.accounts.accounts_receivable",
  );
  const rev = lines.find(
    (l) => l.account_name_key === "coa.accounts.sales_revenue",
  );
  const tax = lines.find(
    (l) => l.account_name_key === "coa.accounts.sales_tax_payable",
  );
  assert.equal(cents(ar?.debit), 15602);
  assert.equal(cents(rev?.credit), 13993);
  assert.equal(cents(tax?.credit), cents(sent.json.tax_total));
  assert.equal(cents(tax?.credit), 1609);

  lifecycle = sent.json; // reused by the PUT / PAY / VOID tests below
});

test("sent invoices are immutable — PUT returns 400", async (t) => {
  if (!biz) return t.skip("database not reachable");
  if (!lifecycle) return t.skip("send test did not run");
  const res = await api(srv.base, `/api/invoices/${lifecycle.id}`, {
    method: "PUT",
    token: biz.token,
    body: {
      lineItems: [{ description: "Rewrite history", quantity: 1, unitPrice: 1 }],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /draft/i);
});

test("PAY posts the cash receipt against the account's linked COA twin", async (t) => {
  if (!biz) return t.skip("database not reachable");
  if (!lifecycle) return t.skip("send test did not run");
  const res = await api(srv.base, `/api/invoices/${lifecycle.id}/pay`, {
    method: "POST",
    token: biz.token,
    body: { accountId: depositAccountId, paidDate: "2026-04-02" },
  });
  assert.equal(res.status, 200, res.json?.error);
  assert.equal(res.json.status, "paid");

  const entries = await journalEntriesFor("invoice_payment", lifecycle.id);
  assert.equal(entries.length, 1);
  const lines = entries[0].lines;

  const cash = lines.find((l) => l.account_id === depositCoaId);
  const ar = lines.find(
    (l) => l.account_name_key === "coa.accounts.accounts_receivable",
  );
  assert.equal(cents(cash?.debit), cents(lifecycle.total)); // 156.02 in
  assert.equal(cents(ar?.credit), cents(lifecycle.total)); // AR cleared
  const debits = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credits = lines.reduce((s, l) => s + cents(l.credit), 0);
  assert.equal(debits, credits);
});

test("VOID removes both the invoice and payment journal entries", async (t) => {
  if (!biz) return t.skip("database not reachable");
  if (!lifecycle) return t.skip("send test did not run");
  const res = await api(srv.base, `/api/invoices/${lifecycle.id}/void`, {
    method: "POST",
    token: biz.token,
    body: {},
  });
  assert.equal(res.status, 200, res.json?.error);
  assert.equal(res.json.status, "void");
  assert.equal(res.json.paid_at, null);

  // Ledger impact fully reversed — nothing left under either source type.
  assert.equal((await journalEntriesFor("invoice", lifecycle.id)).length, 0);
  assert.equal(
    (await journalEntriesFor("invoice_payment", lifecycle.id)).length, 0);
});

test("ivu-summary reflects the invoice month's state/muni figures", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // May is used by no other test, so the month's figures are exactly this
  // invoice: $1,000 → state 105.00, muni 10.00, tax 115.00.
  const inv = await createInvoice({
    clientId,
    issueDate: "2026-05-12",
    dueDate: "2026-06-11",
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    lineItems: [{ description: "Catering mayo", quantity: 1, unitPrice: 1000 }],
  });
  const sent = await api(srv.base, `/api/invoices/${inv.id}/send`, {
    method: "POST",
    token: biz.token,
    body: {},
  });
  assert.equal(sent.status, 200, sent.json?.error);

  const res = await api(srv.base, "/api/reports/ivu-summary?year=2026", {
    token: biz.token,
  });
  assert.equal(res.status, 200, res.json?.error);

  const may = res.json.months.find((m) => m.month === 5);
  assert.equal(cents(may.taxable_sales), 100000);
  assert.equal(cents(may.state_tax), 10500);
  assert.equal(cents(may.muni_tax), 1000);
  assert.equal(cents(may.tax_total), 11500);
  assert.equal(cents(may.state_tax) + cents(may.muni_tax), cents(may.tax_total));

  // March's only invoice was voided above — accrual figures must drop to 0,
  // proving voids flow through to the SC 2915 prep.
  const march = res.json.months.find((m) => m.month === 3);
  assert.equal(cents(march.tax_total), 0);
  assert.equal(cents(march.taxable_sales), 0);
});
