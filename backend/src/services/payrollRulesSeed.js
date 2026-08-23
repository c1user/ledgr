/**
 * services/payrollRulesSeed.js
 *
 * ROADMAP-V5 · Phase 1.3 — the UNVERIFIED placeholder rule template.
 *
 * Same pattern as coaSeed.js: one template, seeded per business at
 * registration (routes/auth.js) and backfilled for existing businesses
 * by scripts/seed-payroll-rules.mjs.
 *
 * EVERY VALUE HERE IS A PLAUSIBLE PLACEHOLDER, NOT A CORRECT ONE.
 * Payloads exist so the engine and UI have real shapes to build against
 * in sandbox mode. Rows seed as UNVERIFIED; the human replaces values
 * from official sources and verifies them via the rules admin UI.
 * TAX_DATA_TODO.md at the repo root is the checklist. Nothing in this
 * codebase may ever set verification_status = 'VERIFIED'.
 *
 * All money values in payloads are integer cents.
 */

// The pay date from which seeded placeholder versions apply. Arbitrary but
// stable: far enough back that sandbox runs over past periods resolve.
const SEED_EFFECTIVE_FROM = "2026-01-01";

export const PAYROLL_RULES_TEMPLATE = [
  {
    rule_type: "pr_income_tax_withholding",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: Hacienda income-tax withholding tables for employers, current year (hacienda.pr.gov / SURI publications)",
    notes:
      "Bracket shape is illustrative only; the real employer tables differ structurally. PR-resident wages are withheld for Hacienda, not federal income tax.",
    payload: {
      method: "annualized_brackets",
      brackets: [
        { over_cents: 0, up_to_cents: 900000, rate: 0 },
        { over_cents: 900000, up_to_cents: 2500000, rate: 0.07 },
        { over_cents: 2500000, up_to_cents: 4150000, rate: 0.14 },
        { over_cents: 4150000, up_to_cents: 6150000, rate: 0.25 },
        { over_cents: 6150000, up_to_cents: null, rate: 0.33 },
      ],
      personal_exemption_cents: {
        complete: 350000,
        half_joint: 175000,
        none: 0,
      },
      allowance_cents: 50000,
    },
  },
  {
    rule_type: "pr_499r4_fields",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: Form 499 R-4 (Withholding Exemption Certificate), current revision — Hacienda",
    notes:
      "Exact election field list must mirror the current 499 R-4; this set is a guess at the shape.",
    payload: {
      fields: [
        {
          key: "exemption_status",
          kind: "enum",
          options: ["complete", "half_joint", "none"],
        },
        { key: "allowances", kind: "integer", min: 0 },
        { key: "additional_withholding_cents", kind: "money", min: 0 },
        { key: "veteran_exemption", kind: "boolean" },
        { key: "youth_exemption", kind: "boolean" },
      ],
    },
  },
  {
    rule_type: "social_security",
    jurisdiction: "US",
    source_citation:
      "PLACEHOLDER — obtain: SSA/IRS current-year Social Security rate and wage base (ssa.gov COLA fact sheet / IRS Pub 15)",
    notes: null,
    payload: {
      employee_rate: 0.062,
      employer_rate: 0.062,
      wage_base_cents: 17610000,
    },
  },
  {
    rule_type: "medicare",
    jurisdiction: "US",
    source_citation:
      "PLACEHOLDER — obtain: IRS current-year Medicare rates and Additional Medicare Tax threshold (IRS Pub 15)",
    notes: null,
    payload: {
      employee_rate: 0.0145,
      employer_rate: 0.0145,
      additional_employee_rate: 0.009,
      additional_threshold_cents: 20000000,
    },
  },
  {
    rule_type: "federal_employment_return",
    jurisdiction: "US",
    source_citation:
      "PLACEHOLDER — obtain: IRS guidance on which employment return PR employers currently file (941 vs discontinued 941-PR) and deposit schedule rules (irs.gov)",
    notes:
      "The 941-PR was discontinued recently — confirm the current form and Spanish-language option.",
    payload: {
      form: "941",
      filing_frequency: "quarterly",
      due_days_after_quarter_end: 31,
      deposit_schedule: { default: "monthly", monthly_due_day: 15 },
    },
  },
  {
    rule_type: "sinot",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: SINOT (non-occupational disability) employee/employer rates and wage base — PR Department of Labor (DTRH)",
    notes: null,
    payload: {
      employee_rate: 0.003,
      employer_rate: 0.003,
      wage_base_cents: 900000,
    },
  },
  {
    rule_type: "suta",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: PR unemployment (SUTA) wage base, new-employer rate, special assessments — DTRH",
    notes:
      "This business's experience rate replaces new_employer_rate via a new version of this rule once known.",
    payload: {
      wage_base_cents: 1050000,
      new_employer_rate: 0.028,
      experience_rate: null,
      special_assessment_rate: 0.01,
    },
  },
  {
    rule_type: "seguro_choferil",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: Chauffeurs' Social Security (seguro choferil) applicability rules and weekly amounts — DTRH",
    notes:
      "Applies to employees who drive motor vehicles as a substantial duty — exact occupational scope is a VERIFY item.",
    payload: {
      employee_weekly_cents: 50,
      employer_weekly_cents: 30,
    },
  },
  {
    rule_type: "christmas_bonus",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: Law 148 (Christmas bonus) as amended — hours thresholds by hire-date regime, percentages, caps by employer size, payment window, exemption process — DTRH",
    notes:
      "Recent litigation voided one amendment — confirm the currently operative text before verifying.",
    payload: {
      regimes: [
        {
          hired_before: "2017-01-26",
          qualifying_hours: 700,
          bands: [
            { size_band: "gt_15", percentage: 0.06, cap_cents: 60000 },
            { size_band: "le_15", percentage: 0.03, cap_cents: 30000 },
          ],
        },
        {
          hired_on_or_after: "2017-01-26",
          qualifying_hours: 1350,
          bands: [
            { size_band: "gt_20", percentage: 0.02, cap_cents: 60000 },
            { size_band: "le_20", percentage: 0.02, cap_cents: 30000 },
          ],
        },
      ],
      accrual_window: { start: "10-01", end: "09-30" },
      payment_window: { start: "11-15", end: "12-15" },
    },
  },
  {
    rule_type: "overtime",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: Act 379 (working hours) as amended by the 2017 labor reform — daily/weekly thresholds, multipliers, meal-period penalty — DTRH",
    notes:
      "PR has DAILY overtime and meal-period penalty concepts that differ from mainland FLSA.",
    payload: {
      daily_threshold_hours: 8,
      daily_multiplier: 1.5,
      weekly_threshold_hours: 40,
      weekly_multiplier: 1.5,
      meal_period: {
        penalty_multiplier: 1.5,
        window_rules:
          "Meal period timing/duration rules — VERIFY exact current text.",
      },
    },
  },
  {
    rule_type: "vacation_sick_accrual",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: vacation/sick accrual rates by employer size and hire date — PR law, current text (DTRH)",
    notes:
      "Rates vary by employer size and hire date under current law — regime list is a placeholder.",
    payload: {
      regimes: [
        {
          applies_to: "default",
          min_hours_per_month: 115,
          vacation_days_per_month: 1.25,
          sick_days_per_month: 1.0,
        },
      ],
    },
  },
  {
    rule_type: "employer_size_bands",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: employer size definitions used by Law 148 and accrual statutes — DTRH",
    notes:
      "The counting method (headcount vs FTE, measurement period) is a VERIFY item.",
    payload: {
      bands: [
        { key: "le_15", max_employees: 15 },
        { key: "gt_15", min_employees: 16 },
        { key: "le_20", max_employees: 20 },
        { key: "gt_20", min_employees: 21 },
      ],
    },
  },
  {
    rule_type: "pay_frequencies_allowed",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: statutory pay-frequency requirements for PR employees — DTRH",
    notes:
      "Whether monthly pay is lawful for non-exempt employees in PR is a VERIFY item; monthly is excluded until confirmed.",
    payload: {
      frequencies: ["weekly", "biweekly", "semimonthly"],
    },
  },
  {
    rule_type: "paystub_fields_9017",
    jurisdiction: "PR",
    source_citation:
      "PENDING VERIFY — transcribed from Reglamento 9017 (DTRH, 4 abr 2018), Artículo XV 'Talonarios de pago' (8 items; electronic stubs allowed, available within 5 calendar days, e-mail = safe harbor). Official text: app.estado.gobierno.pr/ReglamentosOnLine/Reglamentos/9017.pdf",
    notes:
      "Art. XV list: (1) nombre y dirección del patrono; (2) nombre del empleado; (3) puesto; (4) fecha y período; (5) total de horas regulares y extraordinarias; (6) salario devengado por horas regulares y extraordinarias; (7) adiciones y deducciones con concepto; (8) cantidad neta. Rates/hourly detail belong to the Art. XVI payroll RECORD, not the stub.",
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
  },
  {
    rule_type: "hacienda_deposit_schedule",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: Hacienda income-tax withholding deposit schedule rules — hacienda.pr.gov / SURI",
    notes:
      "Deposit frequency likely depends on withholding volume — threshold table is a VERIFY item.",
    payload: {
      default_frequency: "monthly",
      monthly_due_day: 15,
      thresholds: [],
    },
  },
  {
    rule_type: "quarterly_filing_schedule",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: quarterly filing due dates — Hacienda withholding reconciliation (SURI) and DTRH unemployment/SINOT wage report",
    notes: null,
    payload: {
      filings: [
        {
          key: "hacienda_withholding_reconciliation",
          due_days_after_quarter_end: 31,
        },
        { key: "dtrh_unemployment_sinot", due_days_after_quarter_end: 31 },
      ],
    },
  },
  {
    rule_type: "w2pr_file_spec",
    jurisdiction: "PR",
    source_citation:
      "PENDING VERIFY — implemented from Hacienda Publication 25-01 (Rev. 2025-09-23), 'Developer Guide — Form 499R-2/W-2PR (Copy A) Electronic Filing Requirements, Tax Year 2025' (hacienda.pr.gov/publicaciones). Diff against the TY2026 publication (expected fall 2026) before the January 2027 filing.",
    notes:
      "The export builder must target the version named here; bumping the year is a new rule version. EFW2PR: 9 mandatory 512-byte records (RA/RE/RW/RO/RS/RT/RU/RV/RF). TY2025 due date was Feb 2, 2026; SURI accepts one employer (RE) per upload and issues the confirmation number the printed forms need.",
    payload: {
      spec_version: "EFW2PR-TY2025",
      publication:
        "Hacienda Publication 25-01 (Rev. 2025-09-23) — EFW2PR, Tax Year 2025",
      generation_window: { start: "01-01", end: "01-31" },
    },
  },
  {
    rule_type: "cfse_declaration",
    jurisdiction: "PR",
    source_citation:
      "PLACEHOLDER — obtain: CFSE annual payroll declaration format and due date — CFSE (fondopr.com)",
    notes:
      "CFSE policy-year payroll declaration; this business's premium rate arrives as a new version of this rule once the policy is on hand.",
    payload: {
      annual_due: "07-20",
      period: { start: "07-01", end: "06-30" },
      premium_rate: null,
    },
  },
];

/**
 * Seed the UNVERIFIED placeholder rule set for a business. Idempotent:
 * a rule_type the business already has (any version) is left untouched,
 * so re-running never duplicates and never clobbers human edits.
 *
 * @param {import('pg').PoolClient} client - active client (caller's tx)
 * @param {string} businessId
 * @returns {Promise<number>} rows inserted
 */
export async function seedPayrollRules(client, businessId) {
  let inserted = 0;
  for (const rule of PAYROLL_RULES_TEMPLATE) {
    const result = await client.query(
      `INSERT INTO payroll_rules
         (business_id, rule_type, jurisdiction, payload,
          effective_from, source_citation, notes)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE NOT EXISTS (
         SELECT 1 FROM payroll_rules
         WHERE business_id = $1 AND rule_type = $2
       )`,
      [
        businessId,
        rule.rule_type,
        rule.jurisdiction,
        JSON.stringify(rule.payload),
        SEED_EFFECTIVE_FROM,
        rule.source_citation,
        rule.notes,
      ],
    );
    inserted += result.rowCount;
  }
  return inserted;
}
