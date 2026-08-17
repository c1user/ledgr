/**
 * services/payrollEngine.js — the PR payroll calculation engine
 * (ROADMAP-V5 · Phase 3). PURE functions: cents and rule payloads in,
 * typed pay items out. No DB, no dates-now, no environment — the same
 * inputs always produce the same output to the cent, which is what makes
 * the rule-snapshot reproducibility contract (§1.3) testable.
 *
 * HARD RULES:
 *  - Every money value is integer cents (money.js utilities only).
 *  - Every rate, threshold, table, and cap comes from a resolved rule
 *    payload passed in by the caller — NOTHING numeric is hardcoded
 *    here. Unknown payload shapes throw; the engine never guesses.
 *  - NO federal income tax withholding — PR-resident wages are withheld
 *    for Hacienda (scope itself is rule data; this engine simply has no
 *    federal income tax path).
 *
 * Known v1 approximations (documented, parameters still data-driven):
 *  - "Workweek" for the weekly-OT threshold = consecutive 7-day blocks
 *    from the period start (real workweek anchoring is employer config,
 *    future work).
 *  - Chauffeurs' flat WEEKLY amounts × WEEKS_PER_FREQUENCY[frequency].
 */

import {
  assertCents,
  mulRate,
  mulQty,
  divCents,
  sumCents,
  clampCents,
} from "./money.js";

export const PERIODS_PER_YEAR = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

// Whole weeks a flat-weekly amount (seguro choferil) covers per period.
export const WEEKS_PER_FREQUENCY = {
  weekly: 1,
  biweekly: 2,
  semimonthly: 2,
  monthly: 4,
};

function requireRule(rules, type) {
  const rule = rules[type];
  if (!rule || !rule.payload) {
    throw new Error(`payrollEngine: missing required rule "${type}"`);
  }
  return rule;
}

function item(itemType, code, amountCents, ruleId = null, extra = {}) {
  assertCents(amountCents, code);
  return {
    item_type: itemType,
    code,
    rule_id: ruleId,
    quantity: extra.quantity ?? null,
    rate_cents: extra.rateCents ?? null,
    amount_cents: amountCents,
  };
}

// ── Gross pay ────────────────────────────────────────────────

/**
 * Hourly gross with per-DAY overtime, per-week overtime, and meal-period
 * penalty — every parameter from the overtime rule payload.
 */
function computeHourlyEarnings({ rateCents, dailyHours, overtimeRule }) {
  const p = overtimeRule.payload;
  for (const key of [
    "daily_threshold_hours",
    "daily_multiplier",
    "weekly_threshold_hours",
    "weekly_multiplier",
  ]) {
    if (typeof p[key] !== "number") {
      throw new Error(`payrollEngine: overtime payload missing ${key}`);
    }
  }
  const penaltyMult = p.meal_period?.penalty_multiplier;
  const penaltyHoursPerDay = p.meal_period?.penalty_hours ?? 1;

  // Sort by date so 7-day blocks are deterministic regardless of input order.
  const days = [...dailyHours].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = days.length ? days[0].date : null;

  let regularHours = 0;
  let dailyOtHours = 0;
  let mealPenaltyDays = 0;
  const regularByBlock = new Map();

  for (const day of days) {
    const h = day.hours;
    if (typeof h !== "number" || !Number.isFinite(h) || h < 0 || h > 24) {
      throw new Error(`payrollEngine: bad hours for ${day.date}`);
    }
    const ot = Math.max(0, h - p.daily_threshold_hours);
    const reg = h - ot;
    dailyOtHours += ot;
    regularHours += reg;

    const dayIndex = Math.round(
      (Date.parse(day.date) - Date.parse(startDate)) / 86400000,
    );
    const block = Math.floor(dayIndex / 7);
    regularByBlock.set(block, (regularByBlock.get(block) || 0) + reg);

    if (day.mealBreakMissed) mealPenaltyDays += 1;
  }

  // Weekly OT: regular (non-daily-OT) hours beyond the weekly threshold
  // per 7-day block are re-classified — never double-counted with daily OT.
  let weeklyOtHours = 0;
  for (const blockRegular of regularByBlock.values()) {
    weeklyOtHours += Math.max(0, blockRegular - p.weekly_threshold_hours);
  }
  regularHours -= weeklyOtHours;

  const items = [];
  if (regularHours > 0) {
    items.push(
      item(
        "earning",
        "regular",
        mulQty(rateCents, regularHours),
        overtimeRule.id,
        {
          quantity: regularHours,
          rateCents,
        },
      ),
    );
  }
  if (dailyOtHours > 0) {
    const otRate = mulRate(rateCents, p.daily_multiplier);
    items.push(
      item(
        "earning",
        "overtime_daily",
        mulQty(otRate, dailyOtHours),
        overtimeRule.id,
        {
          quantity: dailyOtHours,
          rateCents: otRate,
        },
      ),
    );
  }
  if (weeklyOtHours > 0) {
    const otRate = mulRate(rateCents, p.weekly_multiplier);
    items.push(
      item(
        "earning",
        "overtime_weekly",
        mulQty(otRate, weeklyOtHours),
        overtimeRule.id,
        {
          quantity: weeklyOtHours,
          rateCents: otRate,
        },
      ),
    );
  }
  if (mealPenaltyDays > 0) {
    if (typeof penaltyMult !== "number") {
      throw new Error(
        "payrollEngine: meal period flagged but overtime payload has no meal_period.penalty_multiplier",
      );
    }
    const penaltyHours = mealPenaltyDays * penaltyHoursPerDay;
    const penaltyRate = mulRate(rateCents, penaltyMult);
    items.push(
      item(
        "earning",
        "meal_period_penalty",
        mulQty(penaltyRate, penaltyHours),
        overtimeRule.id,
        { quantity: penaltyHours, rateCents: penaltyRate },
      ),
    );
  }

  const hoursWorked = regularHours + dailyOtHours + weeklyOtHours;
  return { items, hoursWorked };
}

// ── PR income tax withholding ────────────────────────────────

function computePrIncomeTax({ grossCents, periodsPerYear, elections, rule }) {
  const p = rule.payload;
  if (p.method !== "annualized_brackets") {
    throw new Error(
      `payrollEngine: unsupported pr_income_tax_withholding method "${p.method}"`,
    );
  }
  const status = elections.exemption_status || "none";
  const exemption =
    (p.personal_exemption_cents?.[status] ?? 0) +
    (elections.allowances || 0) * (p.allowance_cents ?? 0);

  const annualized = grossCents * periodsPerYear;
  const taxable = Math.max(0, annualized - exemption);

  let annualTax = 0;
  for (const b of p.brackets) {
    const upper = b.up_to_cents ?? Number.MAX_SAFE_INTEGER;
    const portion = clampCents(taxable, b.over_cents, upper) - b.over_cents;
    if (portion > 0) annualTax += mulRate(portion, b.rate);
  }

  return (
    divCents(annualTax, periodsPerYear) +
    (elections.additional_withholding_cents || 0)
  );
}

// ── The line computation ─────────────────────────────────────

/**
 * Compute one employee's pay line for one period.
 *
 * @param {object} input
 * @param {object} input.employee - { id, payType, payRateCents, isChauffeur,
 *   hireDate, elections: {exemption_status, allowances, additional_withholding_cents} }
 * @param {object} input.period - { frequency }
 * @param {Array}  [input.dailyHours] - [{date, hours, mealBreakMissed}] (hourly)
 * @param {number} [input.manualDeductionCents]
 * @param {object} input.rules - rule_type -> { id, payload } (resolved versions)
 * @param {object} input.ytd - { grossCents, ssWagesCents, medicareWagesCents,
 *   sinotWagesCents, sutaWagesCents } — accumulators BEFORE this run
 * @param {object} [input.employerProfile] - { sizeBand }
 * @returns {{ items, grossCents, employeeDeductionsCents,
 *   employerContributionsCents, netCents, deltas, warnings }}
 */
export function computeLine({
  employee,
  period,
  dailyHours = [],
  manualDeductionCents = 0,
  rules,
  ytd,
  employerProfile = {},
}) {
  const periodsPerYear = PERIODS_PER_YEAR[period.frequency];
  if (!periodsPerYear) {
    throw new Error(`payrollEngine: unknown frequency "${period.frequency}"`);
  }
  const warnings = [];
  const items = [];

  // ── Earnings ──
  let hoursWorked = 0;
  if (employee.payType === "hourly") {
    const earned = computeHourlyEarnings({
      rateCents: employee.payRateCents,
      dailyHours,
      overtimeRule: requireRule(rules, "overtime"),
    });
    items.push(...earned.items);
    hoursWorked = earned.hoursWorked;
  } else {
    items.push(
      item(
        "earning",
        "salary",
        divCents(employee.payRateCents, periodsPerYear),
        null,
      ),
    );
    // Salaried qualifying hours for the bonus accumulator: standard
    // full-time hours (2000/yr) prorated per period — an approximation
    // flagged for Phase 4's eligibility report; thresholds stay rule data.
    hoursWorked = Math.round((2000 / periodsPerYear) * 100) / 100;
  }

  const grossCents = sumCents(
    items.filter((i) => i.item_type === "earning").map((i) => i.amount_cents),
  );

  // ── Pre-tax deductions: architecture slot (none enabled in v1) ──
  const preTaxCents = 0;
  const taxableGross = grossCents - preTaxCents;

  // ── Employee withholdings ──
  const elections = employee.elections || {};

  const prTaxRule = requireRule(rules, "pr_income_tax_withholding");
  const prTax = computePrIncomeTax({
    grossCents: taxableGross,
    periodsPerYear,
    elections,
    rule: prTaxRule,
  });
  if (prTax > 0)
    items.push(
      item("employee_deduction", "pr_income_tax", prTax, prTaxRule.id),
    );

  const ssRule = requireRule(rules, "social_security");
  const ssTaxable = clampCents(
    ssRule.payload.wage_base_cents - ytd.ssWagesCents,
    0,
    taxableGross,
  );
  const ssEmployee = mulRate(ssTaxable, ssRule.payload.employee_rate);
  const ssEmployer = mulRate(ssTaxable, ssRule.payload.employer_rate);
  if (ssEmployee > 0)
    items.push(
      item("employee_deduction", "social_security", ssEmployee, ssRule.id),
    );

  const medRule = requireRule(rules, "medicare");
  const medTaxable = taxableGross; // no wage base
  const medEmployee = mulRate(medTaxable, medRule.payload.employee_rate);
  const medEmployer = mulRate(medTaxable, medRule.payload.employer_rate);
  if (medEmployee > 0)
    items.push(item("employee_deduction", "medicare", medEmployee, medRule.id));
  const addlThreshold = medRule.payload.additional_threshold_cents;
  const addlTaxable = clampCents(
    ytd.medicareWagesCents + medTaxable - addlThreshold,
    0,
    medTaxable,
  );
  const medAdditional = mulRate(
    addlTaxable,
    medRule.payload.additional_employee_rate,
  );
  if (medAdditional > 0)
    items.push(
      item(
        "employee_deduction",
        "medicare_additional",
        medAdditional,
        medRule.id,
      ),
    );

  const sinotRule = requireRule(rules, "sinot");
  const sinotTaxable = clampCents(
    sinotRule.payload.wage_base_cents - ytd.sinotWagesCents,
    0,
    taxableGross,
  );
  const sinotEmployee = mulRate(sinotTaxable, sinotRule.payload.employee_rate);
  const sinotEmployer = mulRate(sinotTaxable, sinotRule.payload.employer_rate);
  if (sinotEmployee > 0)
    items.push(
      item("employee_deduction", "sinot", sinotEmployee, sinotRule.id),
    );

  let choferilEmployee = 0;
  let choferilEmployer = 0;
  if (employee.isChauffeur) {
    const chofRule = requireRule(rules, "seguro_choferil");
    const weeks = WEEKS_PER_FREQUENCY[period.frequency];
    choferilEmployee = chofRule.payload.employee_weekly_cents * weeks;
    choferilEmployer = chofRule.payload.employer_weekly_cents * weeks;
    if (choferilEmployee > 0)
      items.push(
        item(
          "employee_deduction",
          "seguro_choferil",
          choferilEmployee,
          chofRule.id,
        ),
      );
    if (choferilEmployer > 0)
      items.push(
        item(
          "employer_contribution",
          "seguro_choferil_employer",
          choferilEmployer,
          chofRule.id,
        ),
      );
  }

  if (manualDeductionCents > 0) {
    items.push(
      item("employee_deduction", "manual", assertCents(manualDeductionCents)),
    );
  }

  // ── Employer contributions ──
  if (ssEmployer > 0)
    items.push(
      item(
        "employer_contribution",
        "social_security_employer",
        ssEmployer,
        ssRule.id,
      ),
    );
  if (medEmployer > 0)
    items.push(
      item(
        "employer_contribution",
        "medicare_employer",
        medEmployer,
        medRule.id,
      ),
    );
  if (sinotEmployer > 0)
    items.push(
      item(
        "employer_contribution",
        "sinot_employer",
        sinotEmployer,
        sinotRule.id,
      ),
    );

  const sutaRule = requireRule(rules, "suta");
  const sutaTaxable = clampCents(
    sutaRule.payload.wage_base_cents - ytd.sutaWagesCents,
    0,
    taxableGross,
  );
  const sutaRate =
    (typeof sutaRule.payload.experience_rate === "number"
      ? sutaRule.payload.experience_rate
      : sutaRule.payload.new_employer_rate) +
    (sutaRule.payload.special_assessment_rate ?? 0);
  const sutaEmployer = mulRate(sutaTaxable, sutaRate);
  if (sutaEmployer > 0)
    items.push(
      item("employer_contribution", "suta", sutaEmployer, sutaRule.id),
    );

  let cfseEmployer = 0;
  const cfseRule = rules.cfse_declaration;
  if (cfseRule) {
    if (typeof cfseRule.payload.premium_rate === "number") {
      cfseEmployer = mulRate(taxableGross, cfseRule.payload.premium_rate);
      if (cfseEmployer > 0)
        items.push(
          item("employer_contribution", "cfse", cfseEmployer, cfseRule.id),
        );
    } else {
      warnings.push("cfse_premium_rate_not_set");
    }
  }

  let bonusAccrual = 0;
  const bonusRule = requireRule(rules, "christmas_bonus");
  const regime = selectBonusRegime(bonusRule.payload, employee.hireDate);
  if (!regime) {
    warnings.push("christmas_bonus_no_regime_for_hire_date");
  } else if (!employerProfile.sizeBand) {
    warnings.push("christmas_bonus_size_band_not_set");
  } else {
    const band = regime.bands.find(
      (b) => b.size_band === employerProfile.sizeBand,
    );
    if (!band) {
      warnings.push("christmas_bonus_no_band_match");
    } else {
      // Accrue toward the cap: pct of cumulative gross, capped, minus what
      // cumulative gross before this run had already accrued.
      const before = Math.min(
        band.cap_cents,
        mulRate(ytd.grossCents, band.percentage),
      );
      const after = Math.min(
        band.cap_cents,
        mulRate(ytd.grossCents + taxableGross, band.percentage),
      );
      bonusAccrual = Math.max(0, after - before);
      if (bonusAccrual > 0)
        items.push(
          item(
            "employer_contribution",
            "christmas_bonus",
            bonusAccrual,
            bonusRule.id,
          ),
        );
    }
  }

  // ── Totals + invariants (§4.6 / Phase 3.5) ──
  const employeeDeductionsCents = sumCents(
    items
      .filter((i) => i.item_type === "employee_deduction")
      .map((i) => i.amount_cents),
  );
  const employerContributionsCents = sumCents(
    items
      .filter((i) => i.item_type === "employer_contribution")
      .map((i) => i.amount_cents),
  );

  if (employeeDeductionsCents > grossCents) {
    throw new Error(
      `payrollEngine: deductions (${employeeDeductionsCents}) exceed gross (${grossCents}) for employee ${employee.id}`,
    );
  }
  const netCents = grossCents - employeeDeductionsCents;

  const earningsSum = sumCents(
    items.filter((i) => i.item_type === "earning").map((i) => i.amount_cents),
  );
  if (
    earningsSum !== grossCents ||
    netCents + employeeDeductionsCents !== grossCents
  ) {
    throw new Error(
      "payrollEngine: invariant violation — parts do not sum to gross",
    );
  }

  return {
    items,
    grossCents,
    employeeDeductionsCents,
    employerContributionsCents,
    netCents,
    deltas: {
      hoursWorked,
      ssTaxableCents: ssTaxable,
      medicareTaxableCents: medTaxable,
      sinotTaxableCents: sinotTaxable,
      sutaTaxableCents: sutaTaxable,
    },
    warnings,
  };
}

export function selectBonusRegime(payload, hireDate) {
  if (!hireDate) return null;
  for (const regime of payload.regimes || []) {
    if (regime.hired_before && hireDate < regime.hired_before) return regime;
    if (regime.hired_on_or_after && hireDate >= regime.hired_on_or_after)
      return regime;
  }
  return null;
}
