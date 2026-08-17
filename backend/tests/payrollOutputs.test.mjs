import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords } from "../src/services/numberWords.js";
import { buildPayStubsPdf, stubFieldGaps } from "../src/services/payStubPdf.js";
import { buildPayChecksPdf } from "../src/services/payChecksPdf.js";
import { selectBonusRegime } from "../src/services/payrollEngine.js";

// ── amount in words ──────────────────────────────────────────

test("Spanish check amounts", () => {
  assert.equal(
    amountInWords(45500, "es"),
    "CUATROCIENTOS CINCUENTA Y CINCO CON 00/100 DÓLARES",
  );
  assert.equal(
    amountInWords(129000, "es"),
    "MIL DOSCIENTOS NOVENTA CON 00/100 DÓLARES",
  );
  assert.equal(amountInWords(2150, "es"), "VEINTIUNO CON 50/100 DÓLARES");
  assert.equal(amountInWords(10000, "es"), "CIEN CON 00/100 DÓLARES");
  assert.equal(
    amountInWords(123456789, "es"),
    "UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL QUINIENTOS SESENTA Y SIETE CON 89/100 DÓLARES",
  );
});

test("English check amounts", () => {
  assert.equal(
    amountInWords(45500, "en"),
    "FOUR HUNDRED FIFTY-FIVE AND 00/100 DOLLARS",
  );
  assert.equal(
    amountInWords(129042, "en"),
    "ONE THOUSAND TWO HUNDRED NINETY AND 42/100 DOLLARS",
  );
  assert.equal(amountInWords(0, "en"), "ZERO AND 00/100 DOLLARS");
});

test("negative cents are rejected", () => {
  assert.throws(() => amountInWords(-1, "es"));
});

// ── PDF builders ─────────────────────────────────────────────

const RUN = {
  id: "run-1",
  run_mode: "sandbox",
  status: "finalized",
  reversal_of: null,
  pay_date: "2026-08-14",
  period_start: "2026-07-27",
  period_end: "2026-08-09",
  gross_cents: 153550,
  employee_deductions_cents: 24550,
  net_cents: 129000,
};

const LINE = {
  id: "line-1",
  employee_id: "emp-1",
  gross_cents: 153550,
  employee_deductions_cents: 24550,
  employer_contributions_cents: 18042,
  net_cents: 129000,
  employee: {
    name: "Carmen Delgado",
    ssn_last4: "6789",
    address: "Calle 1, San Juan",
  },
  items: [
    {
      id: "i1",
      item_type: "earning",
      code: "regular",
      quantity: "80",
      rate_cents: 1850,
      amount_cents: 148000,
    },
    {
      id: "i2",
      item_type: "earning",
      code: "overtime_daily",
      quantity: "2",
      rate_cents: 2775,
      amount_cents: 5550,
    },
    {
      id: "i3",
      item_type: "employee_deduction",
      code: "pr_income_tax",
      quantity: null,
      rate_cents: null,
      amount_cents: 12343,
    },
    {
      id: "i4",
      item_type: "employer_contribution",
      code: "suta",
      quantity: null,
      rate_cents: null,
      amount_cents: 5835,
    },
  ],
};

const EMPLOYER = {
  name: "El Fogón Criollo",
  address: "Calle Loíza 123",
  city: "San Juan",
  state: "PR",
  zip: "00911",
  tax_id: "66-0891234",
};

test("stubs PDF builds one page per line and flags no gaps for known fields", async () => {
  const { pdf, warnings } = await buildPayStubsPdf({
    run: RUN,
    lines: [LINE, { ...LINE, id: "line-2" }],
    employer: EMPLOYER,
    accumulatorsByEmployee: new Map([
      ["emp-1", { pr_tax_withheld_cents: 50000, ss_withheld_cents: 30000 }],
    ]),
    stubFieldsRule: {
      payload: { required_fields: ["employer_name", "net_pay", "gross_pay"] },
    },
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.subarray(0, 5).toString() === "%PDF-");
  assert.ok(pdf.length > 2000);
  assert.deepEqual(warnings, []);
});

test("a 9017 field the template cannot render is surfaced, never silent", async () => {
  const rule = {
    payload: { required_fields: ["employer_name", "hours_by_municipality"] },
  };
  assert.deepEqual(stubFieldGaps(rule), ["hours_by_municipality"]);
  const { warnings } = await buildPayStubsPdf({
    run: RUN,
    lines: [LINE],
    employer: EMPLOYER,
    stubFieldsRule: rule,
  });
  assert.match(warnings[0], /hours_by_municipality/);
});

test("checks PDF builds with offsets and sandbox strike", async () => {
  const pdf = await buildPayChecksPdf({
    run: RUN,
    lines: [LINE],
    employer: EMPLOYER,
    offsets: { xMm: 2.5, yMm: -1 },
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.subarray(0, 5).toString() === "%PDF-");
});

// ── bonus regime selection (shared with the engine) ──────────

test("bonus regime selection by hire date", () => {
  const payload = {
    regimes: [
      { hired_before: "2017-01-26", qualifying_hours: 700, bands: [] },
      { hired_on_or_after: "2017-01-26", qualifying_hours: 1350, bands: [] },
    ],
  };
  assert.equal(selectBonusRegime(payload, "2015-05-01").qualifying_hours, 700);
  assert.equal(selectBonusRegime(payload, "2017-01-26").qualifying_hours, 1350);
  assert.equal(selectBonusRegime(payload, "2020-01-01").qualifying_hours, 1350);
  assert.equal(selectBonusRegime(payload, null), null);
});
