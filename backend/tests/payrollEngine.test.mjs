import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLine } from "../src/services/payrollEngine.js";
import { toCents, centsToDollars, mulRate } from "../src/services/money.js";

// Round-number rule fixture — hand-checkable math, NOT real rates.
const RULES = {
  overtime: {
    id: "r-ot",
    payload: {
      daily_threshold_hours: 8,
      daily_multiplier: 1.5,
      weekly_threshold_hours: 40,
      weekly_multiplier: 1.5,
      meal_period: { penalty_multiplier: 1.5, penalty_hours: 1 },
    },
  },
  pr_income_tax_withholding: {
    id: "r-pr",
    payload: {
      method: "annualized_brackets",
      brackets: [
        { over_cents: 0, up_to_cents: 1000000, rate: 0 },
        { over_cents: 1000000, up_to_cents: null, rate: 0.1 },
      ],
      personal_exemption_cents: {
        complete: 500000,
        half_joint: 250000,
        none: 0,
      },
      allowance_cents: 100000,
    },
  },
  social_security: {
    id: "r-ss",
    payload: {
      employee_rate: 0.062,
      employer_rate: 0.062,
      wage_base_cents: 1000000,
    },
  },
  medicare: {
    id: "r-med",
    payload: {
      employee_rate: 0.0145,
      employer_rate: 0.0145,
      additional_employee_rate: 0.009,
      additional_threshold_cents: 20000000,
    },
  },
  sinot: {
    id: "r-sinot",
    payload: {
      employee_rate: 0.003,
      employer_rate: 0.003,
      wage_base_cents: 900000,
    },
  },
  suta: {
    id: "r-suta",
    payload: {
      wage_base_cents: 700000,
      new_employer_rate: 0.028,
      experience_rate: null,
      special_assessment_rate: 0.01,
    },
  },
  seguro_choferil: {
    id: "r-chof",
    payload: { employee_weekly_cents: 50, employer_weekly_cents: 30 },
  },
  christmas_bonus: {
    id: "r-bonus",
    payload: {
      regimes: [
        {
          hired_before: "2017-01-26",
          qualifying_hours: 700,
          bands: [{ size_band: "gt_15", percentage: 0.06, cap_cents: 60000 }],
        },
        {
          hired_on_or_after: "2017-01-26",
          qualifying_hours: 1350,
          bands: [{ size_band: "le_20", percentage: 0.02, cap_cents: 30000 }],
        },
      ],
    },
  },
  pay_frequencies_allowed: {
    id: "r-freq",
    payload: { frequencies: ["weekly", "biweekly", "semimonthly"] },
  },
};

const ZERO_YTD = {
  grossCents: 0,
  ssWagesCents: 0,
  medicareWagesCents: 0,
  sinotWagesCents: 0,
  sutaWagesCents: 0,
};

const baseInput = (overrides = {}) => ({
  employee: {
    id: "emp-1",
    payType: "hourly",
    payRateCents: 1000, // $10/hr
    isChauffeur: false,
    hireDate: "2020-06-01",
    elections: { exemption_status: "none", allowances: 0 },
    ...(overrides.employee || {}),
  },
  period: { frequency: "biweekly" },
  dailyHours: overrides.dailyHours || [],
  manualDeductionCents: overrides.manualDeductionCents || 0,
  rules: RULES,
  ytd: { ...ZERO_YTD, ...(overrides.ytd || {}) },
  employerProfile: { sizeBand: "le_20", ...(overrides.employerProfile || {}) },
});

const itemBy = (result, code) =>
  result.items.find((i) => i.code === code) || null;

// ── gross / overtime ─────────────────────────────────────────

test("daily overtime: 10h day = 8 regular + 2 at daily multiplier", () => {
  const r = computeLine(
    baseInput({ dailyHours: [{ date: "2026-08-03", hours: 10 }] }),
  );
  assert.equal(itemBy(r, "regular").amount_cents, 8000);
  assert.equal(itemBy(r, "overtime_daily").amount_cents, 3000); // 2h × $15
  assert.equal(r.grossCents, 11000);
});

test("weekly overtime: 6×8h in one block → 8h weekly OT, no double count", () => {
  const days = [1, 2, 3, 4, 5, 6].map((d) => ({
    date: `2026-08-0${d}`,
    hours: 8,
  }));
  const r = computeLine(baseInput({ dailyHours: days }));
  assert.equal(itemBy(r, "regular").amount_cents, 40000); // 40h
  assert.equal(itemBy(r, "overtime_weekly").amount_cents, 12000); // 8h × $15
  assert.equal(itemBy(r, "overtime_daily"), null);
});

test("meal-period penalty adds a distinct line at the penalty rate", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8, mealBreakMissed: true }],
    }),
  );
  assert.equal(itemBy(r, "meal_period_penalty").amount_cents, 1500); // 1h × $15
});

test("salary prorates the annual rate by period", () => {
  const r = computeLine(
    baseInput({
      employee: { payType: "salary", payRateCents: toCents("52000") },
    }),
  );
  assert.equal(itemBy(r, "salary").amount_cents, 200000); // $2,000 biweekly
});

// ── withholdings ─────────────────────────────────────────────

test("PR income tax: annualized brackets minus exemption, no federal tax anywhere", () => {
  const r = computeLine(
    baseInput({
      employee: {
        payType: "salary",
        payRateCents: toCents("52000"),
        elections: { exemption_status: "complete", allowances: 0 },
      },
    }),
  );
  // annual 5,200,000 − exemption 500,000 = 4,700,000 taxable
  // 10% over 1,000,000 → 370,000/yr → 14,231/period
  assert.equal(itemBy(r, "pr_income_tax").amount_cents, 14231);
  assert.ok(!r.items.some((i) => /federal/i.test(i.code)));
});

test("additional withholding from 499 R-4 elections is added", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }],
      employee: {
        elections: {
          exemption_status: "none",
          allowances: 0,
          additional_withholding_cents: 500,
        },
      },
    }),
  );
  // gross 8000 → annualized 208,000 < bracket floor → bracket tax 0 + 500
  assert.equal(itemBy(r, "pr_income_tax").amount_cents, 500);
});

test("Social Security stops exactly at the wage base in the crossing period", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }], // gross 8000
      ytd: { ssWagesCents: 995000 }, // base 1,000,000 → only 5,000 taxable
    }),
  );
  assert.equal(r.deltas.ssTaxableCents, 5000);
  assert.equal(itemBy(r, "social_security").amount_cents, mulRate(5000, 0.062));
});

test("Social Security is zero once the wage base is reached", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }],
      ytd: { ssWagesCents: 1000000 },
    }),
  );
  assert.equal(itemBy(r, "social_security"), null);
  assert.equal(itemBy(r, "social_security_employer"), null);
  assert.equal(r.deltas.ssTaxableCents, 0);
});

test("additional Medicare kicks in over the YTD threshold", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }], // gross 8000
      ytd: { medicareWagesCents: 19995000 }, // threshold 20,000,000
    }),
  );
  // 3,000 of this period's 8,000 falls above the threshold
  assert.equal(
    itemBy(r, "medicare_additional").amount_cents,
    mulRate(3000, 0.009),
  );
});

test("chauffeurs' insurance: flat weekly × weeks in period, both shares", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }],
      employee: { isChauffeur: true },
    }),
  );
  assert.equal(itemBy(r, "seguro_choferil").amount_cents, 100); // 50×2
  assert.equal(itemBy(r, "seguro_choferil_employer").amount_cents, 60);
});

// ── employer accruals ────────────────────────────────────────

test("SUTA uses new-employer rate + assessment against its own wage base", () => {
  const r = computeLine(
    baseInput({ dailyHours: [{ date: "2026-08-03", hours: 8 }] }),
  );
  assert.equal(itemBy(r, "suta").amount_cents, mulRate(8000, 0.038));
});

test("Christmas bonus accrues by regime (hire date) and band, capped", () => {
  // post-2017 hire, le_20 band, 2% — near the 30,000 cap:
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }], // gross 8,000 → 2% = 160
      ytd: { grossCents: 1495000 }, // 2% = 29,900 accrued; cap 30,000
    }),
  );
  assert.equal(itemBy(r, "christmas_bonus").amount_cents, 100); // capped
});

test("pre-2017 hire selects the other regime", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }],
      employee: { hireDate: "2015-01-01" },
      employerProfile: { sizeBand: "gt_15" },
    }),
  );
  assert.equal(itemBy(r, "christmas_bonus").amount_cents, mulRate(8000, 0.06));
});

test("missing size band skips bonus accrual with a warning, not silently", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [{ date: "2026-08-03", hours: 8 }],
      employerProfile: { sizeBand: null },
    }),
  );
  assert.equal(itemBy(r, "christmas_bonus"), null);
  assert.ok(r.warnings.includes("christmas_bonus_size_band_not_set"));
});

// ── invariants / determinism ─────────────────────────────────

test("invariant: earnings sum to gross and net + deductions = gross", () => {
  const r = computeLine(
    baseInput({
      dailyHours: [
        { date: "2026-08-03", hours: 10, mealBreakMissed: true },
        { date: "2026-08-04", hours: 8 },
      ],
      manualDeductionCents: 2500,
      employee: { isChauffeur: true },
    }),
  );
  const earnings = r.items
    .filter((i) => i.item_type === "earning")
    .reduce((a, i) => a + i.amount_cents, 0);
  const deductions = r.items
    .filter((i) => i.item_type === "employee_deduction")
    .reduce((a, i) => a + i.amount_cents, 0);
  assert.equal(earnings, r.grossCents);
  assert.equal(r.netCents + deductions, r.grossCents);
  assert.ok(Number.isSafeInteger(r.netCents));
});

test("determinism: identical inputs produce identical output", () => {
  const input = baseInput({
    dailyHours: [
      { date: "2026-08-03", hours: 9.5 },
      { date: "2026-08-04", hours: 8.25, mealBreakMissed: true },
    ],
    ytd: { grossCents: 123456, ssWagesCents: 654321 },
  });
  assert.deepEqual(computeLine(input), computeLine(input));
});

test("deductions exceeding gross throw instead of going negative", () => {
  assert.throws(
    () =>
      computeLine(
        baseInput({
          dailyHours: [{ date: "2026-08-03", hours: 1 }], // gross 1,000
          employee: {
            elections: {
              exemption_status: "none",
              allowances: 0,
              additional_withholding_cents: 100000,
            },
          },
        }),
      ),
    /exceed gross/,
  );
});

test("a missing required rule throws by name", () => {
  const rules = { ...RULES };
  delete rules.sinot;
  assert.throws(
    () =>
      computeLine({
        ...baseInput({ dailyHours: [{ date: "2026-08-03", hours: 8 }] }),
        rules,
      }),
    /missing required rule "sinot"/,
  );
});

// ── money boundary ───────────────────────────────────────────

test("toCents parses DB numeric strings exactly", () => {
  assert.equal(toCents("18.50"), 1850);
  assert.equal(toCents("42000"), 4200000);
  assert.equal(toCents("0.07"), 7);
  assert.throws(() => toCents("1.234"));
});

test("centsToDollars renders exact 2-decimal values", () => {
  assert.equal(centsToDollars(1850), 18.5);
  assert.equal(centsToDollars(1), 0.01);
  assert.equal(centsToDollars(-12345), -123.45);
});
