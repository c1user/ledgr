/**
 * tests/efw2pr.test.mjs — the real W-2PR layout (EFW2PR-TY2025 per
 * Hacienda Publication 25-01) and the compliance notifier's pure logic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildW2prFile } from "../src/services/w2prFile.js";
import {
  classifyObligation,
  obligationMessage,
} from "../src/services/complianceNotifier.js";
import { stubFieldGaps } from "../src/services/payStubPdf.js";

const EMPLOYER = {
  name: "El Fogón Criollo",
  address: "Calle Loíza 123",
  city: "San Juan",
  state: "PR",
  zip: "00911",
  tax_id: "66-0891234",
  email: "fogon@ledgr.test",
};

const EMP = {
  name: "Carmen Delgado Rivera",
  // Valid per Pub 25-01 p. 19 (no 666/9 prefix, not repeated/sequential).
  ssn: "581234567",
  addressStreet: "Urb. Las Américas 45",
  addressCity: "San Juan",
  addressState: "PR",
  addressZip: "00921",
  grossCents: 4000000, // $40,000.00
  prTaxCents: 320000,
  ssWagesCents: 4000000,
  ssWithheldCents: 248000,
  medicareWagesCents: 4000000,
  medicareWithheldCents: 58000,
};

const build = (over = {}) =>
  buildW2prFile({
    specVersion: "EFW2PR-TY2025",
    year: 2026,
    employer: EMPLOYER,
    employees: [EMP],
    ...over,
  });

// Field extraction: 1-based inclusive positions, like the publication.
const field = (rec, start, end) => rec.slice(start - 1, end);

test("EFW2PR: nine mandatory records in Pub 25-01 order, all 512 bytes", () => {
  const { content, filename, warnings } = build();
  const records = content.split("\r\n");
  assert.equal(records.pop(), ""); // file ends with CRLF
  assert.deepEqual(
    records.map((r) => r.slice(0, 2)),
    ["RA", "RE", "RW", "RO", "RS", "RT", "RU", "RV", "RF"],
  );
  for (const r of records) assert.equal(r.length, 512);
  assert.equal(filename, "W2PR2026.txt");
  // No phone column exists in the data model yet — the builder must say so
  // (RE 249-263 is a required field) rather than stay silent.
  assert.deepEqual(warnings, ["missing_employer_phone"]);
});

test("EFW2PR: RA carries EIN, software code, company name, contact email", () => {
  const records = build().content.split("\r\n");
  const ra = records[0];
  assert.equal(field(ra, 3, 11), "660891234"); // EIN, no hyphen
  assert.equal(field(ra, 29, 29), "0"); // original file
  assert.equal(field(ra, 36, 37), "98"); // in-house software
  assert.ok(field(ra, 38, 94).startsWith("EL FOGON CRIOLLO")); // accents stripped
  // Street goes on Line 2 (Delivery Address); Line 1 is attention/suite.
  assert.equal(field(ra, 95, 116).trim(), "");
  assert.equal(field(ra, 117, 138).trim(), "CALLE LOIZA 123");
  assert.ok(field(ra, 446, 485).trim() === "fogon@ledgr.test"); // mixed case kept
  assert.equal(field(ra, 499, 499), "2"); // only defined value (p. 26)
  assert.equal(field(ra, 500, 500), "L"); // self-prepared
});

test("EFW2PR: RE carries tax year, jurisdiction P, employment code R", () => {
  const re = build().content.split("\r\n")[1];
  assert.equal(field(re, 3, 6), "2026");
  assert.equal(field(re, 8, 16), "660891234");
  assert.equal(field(re, 119, 140).trim(), "CALLE LOIZA 123"); // Line 2
  assert.equal(field(re, 219, 219), "R");
  assert.equal(field(re, 220, 220), "P");
  assert.equal(field(re, 221, 221), "0");
  // RE fax is the one empty field the spec zero-fills (p. 30).
  assert.equal(field(re, 269, 278), "0".repeat(10));
});

test("EFW2PR: RW money fields sit at Pub 25-01 positions, cents zero-filled", () => {
  const rw = build().content.split("\r\n")[2];
  assert.equal(field(rw, 3, 11), "581234567"); // SSN
  assert.equal(field(rw, 12, 26).trim(), "CARMEN"); // first name
  assert.equal(field(rw, 42, 61).trim(), "DELGADO RIVERA"); // both surnames
  assert.equal(field(rw, 210, 220), "00004000000"); // SS wages $40,000.00
  assert.equal(field(rw, 221, 231), "00000248000"); // SS tax
  assert.equal(field(rw, 232, 242), "00004000000"); // Medicare wages
  assert.equal(field(rw, 243, 253), "00000058000"); // Medicare tax
  assert.equal(field(rw, 188, 209), "0".repeat(22)); // zero run, not blanks
  assert.equal(field(rw, 486, 486), "0"); // statutory employee
});

test("EFW2PR: RO Box 11 equals Boxes 7+8+9+10 and carries PR tax", () => {
  const ro = build().content.split("\r\n")[3];
  assert.equal(field(ro, 275, 285), "00004000000"); // Box 7 wages
  assert.equal(field(ro, 286, 296), "00000000000"); // Box 8 commissions
  assert.equal(field(ro, 297, 307), "00000000000"); // Box 9 allowances
  assert.equal(field(ro, 308, 318), "00000000000"); // Box 10 tips
  assert.equal(field(ro, 319, 329), "00004000000"); // Box 11 total
  assert.equal(field(ro, 330, 340), "00000320000"); // Box 13 PR tax withheld
});

test("EFW2PR: RS carries the employer-assigned control number and address", () => {
  const rs = build().content.split("\r\n")[4];
  assert.equal(field(rs, 10, 18), "581234567"); // SSN
  assert.equal(field(rs, 356, 364), "000000001"); // control number (sequential)
  assert.equal(field(rs, 117, 138).trim(), "SAN JUAN");
  assert.equal(field(rs, 139, 140), "PR");
  assert.equal(field(rs, 141, 145), "00921");
});

test("EFW2PR: RT/RU/RV totals match the employee sums; RF counts RW records", () => {
  const records = build({ employees: [EMP, { ...EMP, ssn: "582651234" }] })
    .content.split("\r\n");
  const rt = records.find((r) => r.startsWith("RT"));
  const ru = records.find((r) => r.startsWith("RU"));
  const rv = records.find((r) => r.startsWith("RV"));
  const rf = records.find((r) => r.startsWith("RF"));
  assert.equal(field(rt, 3, 9), "0000002"); // RW count
  assert.equal(field(rt, 40, 54), "000000008000000"); // SS wages ×2
  assert.equal(field(ru, 355, 369), "000000008000000"); // PR wages ×2
  assert.equal(field(ru, 415, 429), "000000008000000"); // Box 11 total ×2
  assert.equal(field(ru, 430, 444), "000000000640000"); // PR tax ×2
  assert.equal(field(rv, 3, 12), "0".repeat(10)); // no employer phone
  assert.equal(field(rf, 8, 16), "000000002"); // RW records in file
});

test("EFW2PR: accents transliterated, disallowed name characters stripped", () => {
  const records = build({
    employees: [{ ...EMP, name: "José Meléndez-Núñez (Jr.)" }],
  }).content.split("\r\n");
  const rw = records[2];
  assert.equal(field(rw, 12, 26).trim(), "JOSE");
  // Parentheses and periods are not allowed in person-name fields.
  assert.equal(field(rw, 42, 61).trim(), "MELENDEZ-NUNEZ JR");
});

test("EFW2PR: missing SSN, address, and phone produce warnings, not crashes", () => {
  const { warnings } = build({
    employer: { ...EMPLOYER, email: null },
    contactEmail: null,
    employees: [{ ...EMP, ssn: null, addressStreet: null, addressCity: null }],
  });
  assert.ok(warnings.some((w) => w.startsWith("missing_ssn")));
  assert.ok(warnings.some((w) => w.startsWith("missing_address")));
  assert.ok(warnings.includes("missing_employer_phone"));
  assert.ok(warnings.includes("missing_contact_email"));
});

test("EFW2PR: filing-invalid SSNs are flagged per Pub 25-01 p. 19", () => {
  for (const bad of ["912345678", "666123456", "111111111", "123456789"]) {
    const { warnings } = build({ employees: [{ ...EMP, ssn: bad }] });
    assert.ok(
      warnings.some((w) => w.startsWith("invalid_ssn")),
      `expected invalid_ssn for ${bad}`,
    );
  }
});

test("EFW2PR: malformed employer EIN and free-text state are flagged", () => {
  const { warnings } = build({
    employer: { ...EMPLOYER, tax_id: "660891234-01" },
    employees: [{ ...EMP, addressState: "Puerto Rico" }],
  });
  assert.ok(warnings.includes("invalid_employer_ein"));
  assert.ok(warnings.some((w) => w.startsWith("invalid_address_state")));
  const none = build({ employer: { ...EMPLOYER, tax_id: null } }).warnings;
  assert.ok(none.includes("missing_employer_ein"));
});

test("EFW2PR: totals always equal the sum of rendered (clamped) fields", () => {
  // A negative figure (double-reversal edge) renders as zeros per-employee;
  // the RU total must match the rendered zeros, not the raw signed sum.
  const records = build({
    employees: [EMP, { ...EMP, ssn: "582651234", grossCents: -100000, prTaxCents: -5000 }],
  }).content.split("\r\n");
  const ru = records.find((r) => r.startsWith("RU"));
  assert.equal(field(ru, 355, 369), "000000004000000"); // only EMP's wages
  assert.equal(field(ru, 430, 444), "000000000320000"); // only EMP's PR tax
});

test("placeholder layout still builds for businesses on the old rule", () => {
  const { content } = buildW2prFile({
    specVersion: "TY2025-PLACEHOLDER",
    year: 2026,
    employer: EMPLOYER,
    employees: [EMP],
  });
  const records = content.split("\r\n");
  records.pop();
  assert.deepEqual(
    records.map((r) => r.slice(0, 2)),
    ["RA", "RE", "RS", "RT", "RF"],
  );
});

// ── Compliance notifier: pure classification ─────────────────

const OB = (over = {}) => ({
  status: "upcoming",
  due_date: "2026-08-25",
  created_at: "2026-01-05", // row existed before its due date
  notified_upcoming_at: null,
  notified_late_at: null,
  obligation_type: "ivu_monthly",
  ...over,
});

test("notifier: due within 7 days → upcoming, once", () => {
  assert.equal(classifyObligation(OB(), "2026-08-18"), "upcoming");
  assert.equal(
    classifyObligation(OB({ notified_upcoming_at: new Date() }), "2026-08-18"),
    null,
  );
});

test("notifier: past due → late, once; done → never", () => {
  assert.equal(classifyObligation(OB({ due_date: "2026-08-10" }), "2026-08-18"), "late");
  assert.equal(
    classifyObligation(
      OB({ due_date: "2026-08-10", notified_late_at: new Date() }),
      "2026-08-18",
    ),
    null,
  );
  assert.equal(
    classifyObligation(OB({ status: "done", due_date: "2026-08-10" }), "2026-08-18"),
    null,
  );
});

test("notifier: old backfilled obligations are stale — marked, never alerted", () => {
  // Due > 45 days ago (e.g. a first sweep generating last year's calendar).
  assert.equal(
    classifyObligation(OB({ due_date: "2025-11-20" }), "2026-08-18"),
    "stale",
  );
  // Just inside the 45-day window still alerts.
  assert.equal(
    classifyObligation(OB({ due_date: "2026-07-20" }), "2026-08-18"),
    "late",
  );
});

test("notifier: rows created AFTER their due date never alert (deploy grace)", () => {
  // A fresh deploy backfills July's obligation in August: the business was
  // never being watched when it went late — silent mark, no bell/email.
  assert.equal(
    classifyObligation(
      OB({ due_date: "2026-07-20", created_at: "2026-08-18" }),
      "2026-08-18",
    ),
    "stale",
  );
});

test("notifier: far-future obligations stay quiet", () => {
  assert.equal(classifyObligation(OB({ due_date: "2026-09-20" }), "2026-08-18"), null);
});

test("notifier: message copy names the obligation in Spanish", () => {
  const late = obligationMessage(OB({ due_date: "2026-07-20" }), "late");
  assert.equal(late.type, "obligation_late");
  assert.ok(late.title.includes("SC 2915"));
  const soon = obligationMessage(OB(), "upcoming");
  assert.equal(soon.type, "obligation_due_soon");
});

// ── Stub 9017 coverage with the verified Art. XV list ────────

test("stub template covers the verified Reg. 9017 Art. XV field list", () => {
  const rule = {
    payload: {
      required_fields: [
        "employer_name",
        "employer_address",
        "employee_name",
        "position",
        "period_start",
        "period_end",
        "payment_date",
        "hours_regular",
        "hours_overtime",
        "wages_regular",
        "wages_overtime",
        "itemized_deductions",
        "net_pay",
      ],
    },
  };
  assert.deepEqual(stubFieldGaps(rule), []);
});
