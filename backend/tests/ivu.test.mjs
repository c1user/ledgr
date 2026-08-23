/**
 * tests/ivu.test.mjs — IVU (SC 2915) groundwork: invoice totals with the
 * state/municipal split, and the monthly obligation schedule.
 *
 * Pure-function tests only (no DB): computeTotals is the single choke point
 * for invoice money, generateIvuSchedule for SC 2915 due dates.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeTotals,
  defaultMuniRate,
} from "../src/services/invoiceTotals.js";
import { generateIvuSchedule } from "../src/services/complianceSchedule.js";

const lines = (...totals) => totals.map((t) => ({ total: t }));

// ── computeTotals: split math ────────────────────────────────

test("standard 11.5% IVU splits into 10.5 state + 1 municipal", () => {
  const t = computeTotals(lines(100), {
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    taxExempt: false,
  });
  assert.equal(t.subtotal, 100);
  assert.equal(t.tax_total, 11.5);
  assert.equal(t.tax_muni_total, 1);
  assert.equal(t.tax_state_total, 10.5);
  assert.equal(t.total, 111.5);
  assert.equal(t.tax_type, "ivu");
});

test("4% designated services is state-only", () => {
  const t = computeTotals(lines(250), {
    taxType: "ivu",
    taxRate: 4,
    taxMuniRate: 0,
    taxExempt: false,
  });
  assert.equal(t.tax_total, 10);
  assert.equal(t.tax_state_total, 10);
  assert.equal(t.tax_muni_total, 0);
});

test("split identity holds at awkward cents (single-rounding rule)", () => {
  // 33.33 * 11.5% = 3.83295 → 3.83; muni 33.33 * 1% = 0.3333 → 0.33;
  // state must be the 3.50 remainder, never independently rounded.
  const t = computeTotals(lines(33.33), {
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    taxExempt: false,
  });
  assert.equal(t.tax_total, 3.83);
  assert.equal(t.tax_muni_total, 0.33);
  assert.equal(t.tax_state_total, 3.5);
  assert.equal(
    Math.round((t.tax_state_total + t.tax_muni_total) * 100),
    Math.round(t.tax_total * 100),
  );
});

test("identity holds across many random subtotals", () => {
  // Deterministic LCG so failures reproduce.
  let seed = 42;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const subtotal = Math.round(rand() * 1000000) / 100;
    const t = computeTotals(lines(subtotal), {
      taxType: "ivu",
      taxRate: 11.5,
      taxMuniRate: 1,
      taxExempt: false,
    });
    assert.equal(
      Math.round((t.tax_state_total + t.tax_muni_total) * 100),
      Math.round(t.tax_total * 100),
      `identity broke at subtotal ${subtotal}`,
    );
  }
});

test("tax-exempt client forces everything to zero", () => {
  const t = computeTotals(lines(500), {
    taxType: "ivu",
    taxRate: 11.5,
    taxMuniRate: 1,
    taxExempt: true,
  });
  assert.equal(t.tax_rate, 0);
  assert.equal(t.tax_total, 0);
  assert.equal(t.tax_state_total, 0);
  assert.equal(t.tax_muni_total, 0);
  assert.equal(t.total, 500);
});

test("muni rate is clamped to the combined rate", () => {
  const t = computeTotals(lines(100), {
    taxType: "ivu",
    taxRate: 0.5,
    taxMuniRate: 1,
    taxExempt: false,
  });
  assert.equal(t.tax_muni_rate, 0.5);
  assert.equal(t.tax_muni_total, 0.5);
  assert.equal(t.tax_state_total, 0);
});

test("generic tax never carries a municipal portion", () => {
  const t = computeTotals(lines(100), {
    taxType: "generic",
    taxRate: 8,
    taxMuniRate: 1,
    taxExempt: false,
  });
  assert.equal(t.tax_type, "generic");
  assert.equal(t.tax_muni_rate, 0);
  assert.equal(t.tax_muni_total, 0);
  assert.equal(t.tax_state_total, 8);
});

test("omitted muni rate defaults: 1 for standard IVU, 0 for 4% and generic", () => {
  assert.equal(defaultMuniRate("ivu", 11.5), 1);
  assert.equal(defaultMuniRate("ivu", 4), 0);
  assert.equal(defaultMuniRate("generic", 11.5), 0);

  const std = computeTotals(lines(100), {
    taxType: "ivu",
    taxRate: 11.5,
    taxExempt: false,
  });
  assert.equal(std.tax_muni_rate, 1);
  const reduced = computeTotals(lines(100), {
    taxType: "ivu",
    taxRate: 4,
    taxExempt: false,
  });
  assert.equal(reduced.tax_muni_rate, 0);
});

// ── generateIvuSchedule: SC 2915 due dates ───────────────────

test("12 monthly obligations, due the 20th of the following month", () => {
  const out = generateIvuSchedule(2026);
  assert.equal(out.length, 12);
  for (const o of out) {
    assert.equal(o.obligation_type, "ivu_monthly");
    assert.equal(o.rule_id, null);
  }
  assert.equal(out[0].period_start, "2026-01-01");
  assert.equal(out[0].period_end, "2026-01-31");
  assert.equal(out[0].due_date, "2026-02-20");
  assert.equal(out[1].period_end, "2026-02-28");
  assert.equal(out[1].due_date, "2026-03-20");
});

test("December wraps into January of the next year", () => {
  const out = generateIvuSchedule(2026);
  const dec = out[11];
  assert.equal(dec.period_start, "2026-12-01");
  assert.equal(dec.period_end, "2026-12-31");
  assert.equal(dec.due_date, "2027-01-20");
});

test("leap-year February keeps its real month end", () => {
  const out = generateIvuSchedule(2028);
  assert.equal(out[1].period_end, "2028-02-29");
});
