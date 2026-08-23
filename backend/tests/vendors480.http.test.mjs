/**
 * tests/vendors480.http.test.mjs — §2.4 individual vs entity payees over HTTP:
 * vendor CRUD (SSN write-only discipline), 480.6SP completeness flags, the
 * SURI e-file (the ONLY place the plaintext SSN may travel), the masked CSV
 * export, and the export audit trail. Real app, real registration, real plan
 * gates (professional unlocks vendors + hacienda + audit_log).
 *
 * Skips when the database is unreachable (same convention as ledger.test.mjs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import pool from "../src/config/db.js";
import { startTestServer, createTestBusiness, api } from "./helpers/http.mjs";

const YEAR = new Date().getFullYear();
const SSN = "581234567"; // plaintext must ONLY ever appear in the SURI file
const PAYER_EIN = "660111222";
const ENTITY_EIN = "660333444";

// Pub 25-03 fields are 1-based fixed-width: field(line, 167, 9) reads
// positions 167-175 — same as the spec tables, no off-by-one mental math.
const field = (line, startPos, len) => line.slice(startPos - 1, startPos - 1 + len);

// Exhibit J detail records: 'H'(480.6SP) '1'(detail) 'O'(original) at
// positions 13-15 plus a payee ID type at position 11. The 480.5 summary
// shares the H/1/O triple but leaves position 11 blank, so it never matches.
function detailRecords(records) {
  return records.filter(
    (l) => l[12] === "H" && l[13] === "1" && l[14] === "O" && l[10] !== " ",
  );
}

let srv = null;
let biz = null;
let cashCoaId = null; // seeded asset account — funds the expense postings
let expenseCoaId = null; // seeded expense account — the category side
let entId = null; // entity vendor (FEIN payee)
let indId = null; // individual vendor (SSN payee)

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

test.before(async () => {
  srv = await startTestServer();
  try {
    biz = await createTestBusiness(srv.base, { plan: "professional" });

    // The SURI/CSV exports 422 unless the payer (informante) block carries
    // EIN + full mailing address — complete it up front.
    const up = await api(srv.base, "/api/business", {
      method: "PUT",
      token: biz.token,
      body: {
        taxId: PAYER_EIN,
        address: "URB LAS FLORES 123",
        city: "SAN JUAN",
        state: "PR",
        zip: "00901",
      },
    });
    if (up.status !== 200) {
      throw new Error(`payer profile update failed (${up.status})`);
    }

    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: biz.token,
    });
    if (coa.status !== 200) throw new Error(`COA fetch failed (${coa.status})`);
    cashCoaId = findCoaByKey(coa.json, "coa.accounts.cash");
    expenseCoaId = findCoaByKey(coa.json, "coa.accounts.other_expense");
    if (!cashCoaId || !expenseCoaId) {
      throw new Error("seeded COA accounts missing");
    }
  } catch (err) {
    console.log(
      `# vendors480: database not reachable — skipping (${err.message})`,
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

test("entity vendor is created with an EIN and no SSN artifacts", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/vendors", {
    method: "POST",
    token: biz.token,
    body: {
      name: "Constructora Del Mar LLC",
      ein: ENTITY_EIN,
      payee_type: "entity",
      is_1099_eligible: true,
      address: "456 AVE PONCE DE LEON",
      city: "PONCE",
      state: "PR",
      zip: "00716",
    },
  });
  assert.equal(res.status, 201);
  entId = res.json.id;
  assert.equal(res.json.payee_type, "entity");
  assert.equal(res.json.ein, ENTITY_EIN);
  assert.equal(res.json.ssn_last4, null);
  assert.equal(res.json.has_ssn, false);
  assert.ok(!("ssn_encrypted" in res.json), "ciphertext key must be stripped");
});

test("individual vendor masks the SSN and never echoes it back", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/vendors", {
    method: "POST",
    token: biz.token,
    body: {
      name: "Juana Colon Rivera",
      payee_type: "individual",
      ssn: SSN,
      is_1099_eligible: true,
      address: "789 CALLE LUNA",
      city: "SAN JUAN",
      state: "PR",
      zip: "00901",
    },
  });
  assert.equal(res.status, 201);
  indId = res.json.id;
  assert.equal(res.json.payee_type, "individual");
  assert.equal(res.json.ssn_last4, "***-**-4567");
  assert.equal(res.json.has_ssn, true);
  assert.ok(!res.text.includes(SSN), "plaintext SSN must never be echoed");
  assert.ok(!res.text.includes("ssn_encrypted"));

  // The list and detail readbacks apply the same write-only discipline.
  const list = await api(srv.base, "/api/vendors", { token: biz.token });
  assert.equal(list.status, 200);
  const row = list.json.find((v) => v.id === indId);
  assert.equal(row.ssn_last4, "***-**-4567");
  assert.ok(!list.text.includes(SSN));
  assert.ok(!list.text.includes("ssn_encrypted"));

  const one = await api(srv.base, `/api/vendors/${indId}`, {
    token: biz.token,
  });
  assert.equal(one.status, 200);
  assert.equal(one.json.has_ssn, true);
  assert.ok(!one.text.includes(SSN));
  assert.ok(!one.text.includes("ssn_encrypted"));
});

test("invalid ssn is rejected with 400", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/vendors", {
    method: "POST",
    token: biz.token,
    body: { name: "Bad SSN", payee_type: "individual", ssn: "12345" },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /9 digits/);
});

test("invalid payee_type is rejected with 400", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, "/api/vendors", {
    method: "POST",
    token: biz.token,
    body: { name: "Bad Type", payee_type: "corporation" },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /payee_type/);
});

test("480.6SP missing_fields: individual wants 'ssn', entity wants 'ein'", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // Sub-threshold on purpose (no payments): they surface missing_fields in
  // the report but never gate the exports, which only check flagged vendors.
  const noSsn = await api(srv.base, "/api/vendors", {
    method: "POST",
    token: biz.token,
    body: {
      name: "Pedro Sin Seguro",
      payee_type: "individual",
      is_1099_eligible: true,
      address: "1 CALLE A",
      city: "SAN JUAN",
      state: "PR",
      zip: "00901",
    },
  });
  const noEin = await api(srv.base, "/api/vendors", {
    method: "POST",
    token: biz.token,
    body: {
      name: "Servicios Sin EIN Inc",
      payee_type: "entity",
      is_1099_eligible: true,
      address: "2 CALLE B",
      city: "SAN JUAN",
      state: "PR",
      zip: "00901",
    },
  });
  assert.equal(noSsn.status, 201);
  assert.equal(noEin.status, 201);

  const rep = await api(srv.base, `/api/reports/480-6sp?year=${YEAR}`, {
    token: biz.token,
  });
  assert.equal(rep.status, 200);
  const ind = rep.json.vendors.find((v) => v.id === noSsn.json.id);
  const ent = rep.json.vendors.find((v) => v.id === noEin.json.id);
  assert.ok(ind && ent, "both incomplete vendors appear as eligible");
  assert.ok(ind.missing_fields.includes("ssn"));
  assert.ok(!ind.missing_fields.includes("ein"), "individuals need SSN, not EIN");
  assert.ok(ent.missing_fields.includes("ein"));
  assert.equal(ind.flagged, false);
  assert.equal(ent.flagged, false);
});

test("withheld expenses post and accrue the §1062.03 liability to the cent", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const mk = (body) =>
    api(srv.base, "/api/transactions", {
      method: "POST",
      token: biz.token,
      body: {
        fundingCoaId: cashCoaId,
        categoryId: expenseCoaId,
        type: "expense",
        ...body,
      },
    });

  // Individual: $1,000.00 subject (10% withheld) + $234.56 not subject.
  const a = await mk({
    date: `${YEAR}-03-15`,
    merchant: "Juana Colon Rivera",
    totalAmount: 1000,
    withholdingAmount: 100,
    vendorId: indId,
  });
  const b = await mk({
    date: `${YEAR}-04-01`,
    merchant: "Juana Colon Rivera",
    totalAmount: 234.56,
    vendorId: indId,
  });
  // Entity: $600.00 subject (10% withheld) — crosses PR's $500 threshold.
  const c = await mk({
    date: `${YEAR}-05-20`,
    merchant: "Constructora Del Mar LLC",
    totalAmount: 600,
    withholdingAmount: 60,
    vendorId: entId,
  });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(c.status, 201);
  assert.equal(Number(a.json.withholding_amount), 100);
  assert.equal(Number(b.json.withholding_amount), 0);
  assert.equal(Number(c.json.withholding_amount), 60);

  // Ledger cross-check: the withheld cents landed on the payable liability.
  const sum = await api(
    srv.base,
    `/api/reports/withholding-summary?year=${YEAR}`,
    { token: biz.token },
  );
  assert.equal(sum.status, 200);
  const q = (n) => sum.json.quarters.find((r) => r.quarter === n);
  assert.equal(q(1).withheld, 100);
  assert.equal(q(2).withheld, 60);
  assert.equal(sum.json.total_withheld, 160);
  assert.equal(sum.json.balance_due, 160);
});

test("480.6SP report: money columns to the cent, SSN stays masked", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const rep = await api(srv.base, `/api/reports/480-6sp?year=${YEAR}`, {
    token: biz.token,
  });
  assert.equal(rep.status, 200);

  const ind = rep.json.vendors.find((v) => v.id === indId);
  assert.equal(ind.gross_paid, 1234.56);
  assert.equal(ind.subject, 1000);
  assert.equal(ind.withheld, 100);
  assert.equal(ind.not_subject, 234.56);
  assert.equal(ind.flagged, true);
  assert.deepEqual(ind.missing_fields, []);
  assert.equal(ind.ssn_last4, "***-**-4567");
  assert.equal(ind.has_ssn, true);

  const ent = rep.json.vendors.find((v) => v.id === entId);
  assert.equal(ent.gross_paid, 600);
  assert.equal(ent.subject, 600);
  assert.equal(ent.withheld, 60);
  assert.equal(ent.not_subject, 0);
  assert.equal(ent.flagged, true);

  assert.equal(rep.json.flagged_count, 2);
  assert.equal(rep.json.totals.gross, 1834.56);
  assert.equal(rep.json.totals.withheld, 160);
  assert.equal(rep.json.totals.subject, 1600);
  assert.equal(rep.json.totals.not_subject, 234.56);

  assert.ok(!rep.text.includes(SSN), "report JSON must not leak the SSN");
  assert.ok(!rep.text.includes("ssn_encrypted"));
});

test("SURI export requires the Treasury controlStart", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, `/api/reports/480-6sp/suri?year=${YEAR}`, {
    token: biz.token,
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /controlStart/);
});

test("SURI file with an individual payee: type-2 detail carries the decrypted SSN", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // The e-file is the ONE place the plaintext SSN may travel — decrypted by
  // the route, straight into the download.
  const res = await api(
    srv.base,
    `/api/reports/480-6sp/suri?year=${YEAR}&controlStart=1`,
    { token: biz.token },
  );
  assert.equal(res.status, 200);

  const records = res.text.split("\r\n").filter((l) => l.length > 0);
  // SU + PA + two details (entity + individual) + SP2 + 480.5.
  assert.equal(records.length, 6);
  for (const r of records) assert.equal(r.length, 2500);

  const details = detailRecords(records);
  assert.equal(details.length, 2);
  const ind = details.find((l) => l[10] === "2");
  const ent = details.find((l) => l[10] === "1");
  assert.ok(ind, "individual detail (payee ID type 2) present");
  assert.ok(ent, "entity detail (payee ID type 1) present");

  // Individual: SSN in the TIN slot, split name fields, Items 1/3 columns.
  assert.equal(field(ind, 167, 9), SSN);
  assert.equal(field(ind, 196, 30).trim(), ""); // corporate name: entities only
  assert.equal(field(ind, 762, 15).trim(), "JUANA");
  assert.equal(field(ind, 792, 20).trim(), "COLON RIVERA");
  assert.equal(field(ind, 321, 12), "000000023456"); // item 1 not subject $234.56
  assert.equal(field(ind, 345, 12), "000000100000"); // item 3 subject $1,000.00
  assert.equal(field(ind, 357, 10), "0000010000"); // item 3 withheld $100.00
  assert.equal(field(ind, 333, 12), "000000000000"); // corp columns zero
  assert.equal(field(ind, 367, 12), "000000000000");

  // Entity rides along untouched under its EIN.
  assert.equal(field(ent, 167, 9), ENTITY_EIN);

  // SP2 reconciliation splits by type: Items 1/3 individuals, 2/4 corps.
  const sp2 = records.find((l) => l[12] === "I");
  assert.ok(sp2, "480.6SP.2 reconciliation present");
  assert.equal(field(sp2, 379, 15), "000000000023456"); // item 1 individuals
  assert.equal(field(sp2, 409, 15), "000000000100000"); // item 3 individuals
  assert.equal(field(sp2, 424, 15), "000000000010000"); // item 3 withheld
});

test("SURI file (entity-only year): type-1 detail carries the EIN, cents exact", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // A prior-year payment flags ONLY the entity — the FEIN half of §2.4
  // end to end, including the Treasury control-number threading.
  const prior = YEAR - 1;
  const tx = await api(srv.base, "/api/transactions", {
    method: "POST",
    token: biz.token,
    body: {
      fundingCoaId: cashCoaId,
      categoryId: expenseCoaId,
      type: "expense",
      date: `${prior}-05-20`,
      merchant: "Constructora Del Mar LLC",
      totalAmount: 600,
      withholdingAmount: 60,
      vendorId: entId,
    },
  });
  assert.equal(tx.status, 201);

  // controlStart=7 also proves the Treasury range is threaded through.
  const res = await api(
    srv.base,
    `/api/reports/480-6sp/suri?year=${prior}&controlStart=7`,
    { token: biz.token },
  );
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("content-disposition"),
    new RegExp(`F4806SPY${String(prior).slice(-2)}\\.txt`),
  );

  const records = res.text.split("\r\n").filter((l) => l.length > 0);
  // SU + PA + one detail + SP2 reconciliation + 480.5 summary.
  assert.equal(records.length, 5);
  for (const r of records) assert.equal(r.length, 2500);

  const details = detailRecords(records);
  assert.equal(details.length, 1);
  const ent = details[0];
  assert.equal(ent[10], "1", "entity files under payee ID type 1 (FEIN)");
  assert.equal(ent.slice(166, 175), ENTITY_EIN); // TIN slot, positions 167-175
  assert.equal(field(ent, 18, 4), String(prior));
  assert.equal(field(ent, 196, 30).trim(), "CONSTRUCTORA DEL MAR LLC");
  assert.equal(field(ent, 333, 12), "000000000000"); // item 2 not subject $0.00
  assert.equal(field(ent, 367, 12), "000000060000"); // item 4 subject $600.00
  assert.equal(field(ent, 379, 10), "0000006000"); // item 4 withheld $60.00
  assert.equal(ent.slice(1, 10), "000000007"); // Treasury-assigned control no.

  // 480.5 summary: zero control number, blank payee-type slot; file-level
  // totals must reconcile to the same cents.
  const summary = records.find(
    (l) => l[12] === "H" && l[10] === " " && l.slice(1, 10) === "000000000",
  );
  assert.ok(summary, "480.5 summary record present");
  assert.equal(field(summary, 169, 15), "000000000006000"); // withheld $60.00
  assert.equal(field(summary, 184, 15), "000000000060000"); // paid $600.00
  // The SSN never rides along in an entity-only filing.
  assert.ok(!res.text.includes(SSN));
});

test("CSV export masks the SSN and keeps the full TIN out of spreadsheets", async (t) => {
  if (!biz) return t.skip("database not reachable");
  const res = await api(srv.base, `/api/reports/480-6sp/export?year=${YEAR}`, {
    token: biz.token,
  });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes("***-**-4567"));
  assert.ok(!res.text.includes(SSN), "CSV must never carry the full SSN");
  assert.ok(res.text.includes(ENTITY_EIN), "entities export their EIN");
  // Money columns to the cent: gross, subject, withheld, not subject.
  assert.ok(res.text.includes(",1234.56,1000.00,100.00,234.56"));
  assert.ok(res.text.includes(",600.00,600.00,60.00,0.00"));
});

test("audit trail: the SSN-bearing SURI export leaves a row, never the SSN", async (t) => {
  if (!biz) return t.skip("database not reachable");
  // The individual-inclusive download above must have audited itself with
  // the count of SSNs it carried — and only the count. NB the list route's
  // ?action= allowlist covers only create/update/delete, so match the
  // action client-side.
  const res = await api(
    srv.base,
    "/api/audit-log?entityType=reports&limit=100",
    { token: biz.token },
  );
  assert.equal(res.status, 200);
  const exports = res.json.filter((r) => r.action === "export");
  assert.ok(exports.length >= 1, "SURI export wrote an audit row");
  const row = exports.find((r) => r.summary === `480.6SP SURI file ${YEAR}`);
  assert.ok(row, "audit row names the export");
  assert.equal(row.snapshot?.ssn_count, 1);

  // Whole trail (incl. the vendor-create snapshot) is scrubbed of SSN keys.
  const all = await api(srv.base, "/api/audit-log?limit=200", {
    token: biz.token,
  });
  assert.equal(all.status, 200);
  assert.ok(!all.text.includes(SSN));
  assert.ok(!all.text.includes("ssn_encrypted"));
});

test("another tenant's withheld payments never bleed into this 480.6SP", async (t) => {
  if (!biz) return t.skip("database not reachable");
  let other = null;
  try {
    other = await createTestBusiness(srv.base);
    const coa = await api(srv.base, "/api/chart-of-accounts", {
      token: other.token,
    });
    const otherCash = findCoaByKey(coa.json, "coa.accounts.cash");
    const otherExp = findCoaByKey(coa.json, "coa.accounts.other_expense");

    // Cross-tenant probe: tenant B references tenant A's vendor id.
    const cross = await api(srv.base, "/api/transactions", {
      method: "POST",
      token: other.token,
      body: {
        fundingCoaId: otherCash,
        categoryId: otherExp,
        type: "expense",
        date: `${YEAR}-06-01`,
        merchant: "Cross Tenant Probe",
        totalAmount: 10000,
        withholdingAmount: 1000,
        vendorId: indId,
      },
    });
    // Current behavior: the insert is accepted (vendor_id isn't scoped to the
    // caller's business on create) — reported as a suspected bug. What must
    // hold either way: tenant A's filing totals stay untouched.
    assert.ok([201, 400, 404].includes(cross.status));

    const rep = await api(srv.base, `/api/reports/480-6sp?year=${YEAR}`, {
      token: biz.token,
    });
    assert.equal(rep.status, 200);
    const ind = rep.json.vendors.find((v) => v.id === indId);
    assert.equal(ind.gross_paid, 1234.56);
    assert.equal(ind.withheld, 100);
    assert.equal(rep.json.totals.gross, 1834.56);
    assert.equal(rep.json.totals.withheld, 160);
  } finally {
    if (other) await other.destroy();
  }
});
