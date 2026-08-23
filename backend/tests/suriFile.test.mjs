import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSuriFile } from "../src/services/suriFile.js";

// Byte-position assertions against Pub 25-03 v2.0 (Exhibits J, U, V, X, O).
const payer = {
  name: "Boricua Books LLC",
  tax_id: "66-1234567",
  address: "123 Calle Sol",
  city: "San Juan",
  state: "PR",
  zip: "00901",
};
const vendors = [
  {
    name: "Boricua Consulting LLC",
    ein: "66-7654321",
    address: "45 Ave Ponce de Leon",
    city: "Ponce",
    state: "PR",
    zip: "00716",
    gross_paid: 1000,
    subject: 1000,
    withheld: 100,
    not_subject: 0,
    waiver_certificate_no: null,
  },
  {
    name: "Taller Grafico Inc",
    ein: "66-1111222",
    address: "8 Calle Luna",
    city: "Mayaguez",
    state: "PR",
    zip: "00680",
    gross_paid: 750.5,
    subject: 0,
    withheld: 0,
    not_subject: 750.5,
    waiver_certificate_no: "WAIV-2025-001",
  },
];

const { content, filename } = buildSuriFile({
  payer,
  vendors,
  year: 2025,
  controlStart: 500001,
  contactEmail: "demo@ledgr.test",
});

const lines = content.split("\r\n").filter(Boolean);
const at = (line, from, to) => lines[line].slice(from - 1, to); // 1-based incl.

test("file shape: record count, fixed width, filename", () => {
  assert.equal(lines.length, 6); // SU, PA, 2 details, SP.2, 480.5
  for (const l of lines) assert.equal(l.length, 2500);
  assert.equal(filename, "F4806SPY25.txt");
});

test("480.SU submitter record (Exhibit X)", () => {
  assert.equal(at(0, 1, 2), "SU");
  assert.equal(at(0, 3, 11), "661234567");
  assert.equal(at(0, 12, 12), "0"); // original submission
  assert.equal(at(0, 13, 14), "98"); // in-house software
  assert.ok(at(0, 15, 71).startsWith("BORICUA BOOKS LLC"));
  assert.ok(at(0, 435, 474).startsWith("DEMO@LEDGR.TEST"));
});

test("480.PA employer record (Exhibit V)", () => {
  assert.equal(at(1, 1, 2), "PA");
  assert.equal(at(1, 3, 6), "2025");
  assert.equal(at(1, 8, 16), "661234567");
  assert.equal(at(1, 17, 17), "H"); // form 480.6SP
  assert.equal(at(1, 22, 22), "O"); // original file
});

test("480.6SP detail — payee subject to withholding (Exhibit J)", () => {
  assert.equal(at(2, 2, 10), "000500001"); // first assigned control number
  assert.equal(at(2, 11, 11), "1"); // FEIN
  assert.equal(at(2, 13, 13), "H");
  assert.equal(at(2, 14, 14), "1"); // detail record
  assert.equal(at(2, 15, 15), "O"); // original document
  assert.equal(at(2, 18, 21), "2025");
  assert.equal(at(2, 32, 40), "661234567"); // payer EIN
  assert.ok(at(2, 141, 153).startsWith("SAN JUAN"));
  assert.equal(at(2, 167, 175), "667654321"); // payee EIN
  assert.ok(at(2, 196, 225).startsWith("BORICUA CONSULTING LLC"));
  assert.equal(at(2, 321, 332), "000000000000"); // item 1 (individuals)
  assert.equal(at(2, 333, 344), "000000000000"); // item 2
  assert.equal(at(2, 367, 378), "000000100000"); // item 4 subject $1,000.00
  assert.equal(at(2, 379, 388), "0000010000"); // item 4 withheld $100.00
  assert.equal(at(2, 434, 453).trim(), ""); // no waiver
});

test("480.6SP detail — payee not subject, with waiver", () => {
  assert.equal(at(3, 2, 10), "000500002"); // sequential control number
  assert.equal(at(3, 333, 344), "000000075050"); // item 2 $750.50
  assert.equal(at(3, 379, 388), "0000000000");
  assert.ok(at(3, 434, 453).startsWith("WAIV-2025-001"));
});

test("480.6SP.2 reconciliation record (Exhibit U)", () => {
  assert.equal(at(4, 2, 10), "000000000"); // control zeros per spec
  assert.equal(at(4, 13, 13), "I");
  assert.equal(at(4, 18, 21), "2025");
  assert.equal(at(4, 48, 56), "661234567");
  assert.equal(at(4, 324, 333), "0000000002"); // total forms
  assert.equal(at(4, 394, 408), "000000000075050"); // item 2 total
  assert.equal(at(4, 439, 453), "000000000100000"); // item 4 subject
  assert.equal(at(4, 454, 468), "000000000010000"); // item 4 withheld
  assert.equal(at(4, 469, 483), "000000000175050"); // total payments
  assert.equal(at(4, 484, 498), "000000000010000"); // total withheld
  assert.equal(at(4, 499, 500), "00"); // self-prepared
});

test("480.5 summary record (Exhibit O)", () => {
  assert.equal(at(5, 2, 10), "000000000");
  assert.equal(at(5, 13, 13), "H");
  assert.equal(at(5, 18, 21), "2025");
  assert.equal(at(5, 24, 32), "661234567");
  assert.equal(at(5, 159, 168), "0000000002"); // document count
  assert.equal(at(5, 169, 183), "000000000010000"); // total withheld
  assert.equal(at(5, 184, 198), "000000000175050"); // total paid
});

// ── Individual payees (§2.4 — Pub 25-03 v2.0 Exhibit J) ──────

const individual = {
  name: "Ana Rivera Colón",
  payee_type: "individual",
  ein: null,
  ssn: "581239876", // decrypted by the route before reaching the builder
  address: "12 Calle Norte",
  city: "Caguas",
  state: "PR",
  zip: "00725",
  gross_paid: 900,
  subject: 600,
  withheld: 60,
  not_subject: 300,
  waiver_certificate_no: null,
};

const mixed = buildSuriFile({
  payer,
  vendors: [vendors[0], individual],
  year: 2025,
  controlStart: 500001,
  contactEmail: "demo@ledgr.test",
});
const mLines = mixed.content.split("\r\n").filter(Boolean);
const mAt = (line, from, to) => mLines[line].slice(from - 1, to);

test("individual detail: ID type 2, SSN, split name fields, Items 1/3 columns", () => {
  assert.equal(mAt(3, 11, 11), "2"); // payee ID type: SSN
  assert.equal(mAt(3, 167, 175), "581239876"); // SSN in the payee ID field
  assert.equal(mAt(3, 196, 225).trim(), ""); // corporate name: corporations-only
  assert.equal(mAt(3, 762, 776).trim(), "ANA"); // first name
  assert.equal(mAt(3, 792, 811).trim(), "RIVERA COLON"); // both surnames
  assert.equal(mAt(3, 321, 332), "000000030000"); // item 1 not subject $300
  assert.equal(mAt(3, 345, 356), "000000060000"); // item 3 subject $600
  assert.equal(mAt(3, 357, 366), "0000006000"); // item 3 withheld $60
  assert.equal(mAt(3, 333, 344), "000000000000"); // corp columns zero
  assert.equal(mAt(3, 367, 378), "000000000000");
});

test("reconciliation splits totals by payee type (Items 1/3 vs 2/4)", () => {
  const sp2 = mLines.length - 2; // SP.2 is second-to-last
  assert.equal(mAt(sp2, 379, 393), "000000000030000"); // item 1 individuals
  assert.equal(mAt(sp2, 409, 423), "000000000060000"); // item 3 individuals
  assert.equal(mAt(sp2, 424, 438), "000000000006000"); // item 3 withheld
  assert.equal(mAt(sp2, 439, 453), "000000000100000"); // item 4 corps
  assert.equal(mAt(sp2, 454, 468), "000000000010000"); // item 4 withheld
  assert.equal(mAt(sp2, 469, 483), "000000000190000"); // total payments
  assert.equal(mAt(sp2, 484, 498), "000000000016000"); // total withheld
});

test("an individual without a usable SSN fails loudly, never zero-fills", () => {
  assert.throws(
    () =>
      buildSuriFile({
        payer,
        vendors: [{ ...individual, ssn: null }],
        year: 2025,
        controlStart: 1,
        contactEmail: "",
      }),
    /has no usable SSN/,
  );
});
