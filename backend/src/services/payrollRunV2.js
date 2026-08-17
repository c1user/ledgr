/**
 * services/payrollRunV2.js — run orchestration for the PR payroll engine
 * (ROADMAP-V5 · Phase 3). Create draft → finalize → (maybe) reverse.
 *
 * Mode semantics (spec §1.2):
 *  - production: creation hard-fails on any UNVERIFIED rule the run
 *    would use; finalization re-checks the snapshot is still VERIFIED.
 *    Finalize updates accumulators and posts the ledger entry.
 *  - sandbox: runs compute and finalize freely, but touch NEITHER the
 *    accumulators NOR the ledger — test runs must never contaminate
 *    real books or YTD caps. Every read of a sandbox run carries
 *    watermark: true for the UI/PDF layer.
 *
 * Determinism (§1.3): the engine is pure and each line stores its
 * accumulator deltas at creation, so finalization applies exactly what
 * was computed — nothing is recomputed later.
 */

import { computeLine } from "./payrollEngine.js";
import { resolveRules, preflightRun } from "./payrollRules.js";
import { toCents, centsToDollars, sumCents } from "./money.js";
import { postJournalEntry } from "./ledger.js";
import { getSystemAccountId } from "./transactionPosting.js";
import { toIso as dateStr } from "./prDates.js";

const CORE_TYPES = [
  "pr_income_tax_withholding",
  "social_security",
  "medicare",
  "sinot",
  "suta",
  "overtime",
  "christmas_bonus",
  "pay_frequencies_allowed",
];

// item code → ledger bucket (name_key). Employer expense side is a
// single 5010 debit; each bucket is the credit account.
const CREDIT_BUCKETS = [
  ["coa.accounts.payroll_wh_hacienda", ["pr_income_tax"]],
  [
    "coa.accounts.payroll_fica_payable",
    [
      "social_security",
      "medicare",
      "medicare_additional",
      "social_security_employer",
      "medicare_employer",
    ],
  ],
  [
    "coa.accounts.payroll_dtrh_payable",
    [
      "sinot",
      "sinot_employer",
      "suta",
      "seguro_choferil",
      "seguro_choferil_employer",
    ],
  ],
  ["coa.accounts.payroll_cfse_accrued", ["cfse"]],
  ["coa.accounts.payroll_bonus_accrued", ["christmas_bonus"]],
  ["coa.accounts.payroll_other_wh", ["manual"]],
];

class RunError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export { RunError };

// ── Create a draft run ───────────────────────────────────────

export async function createRun(
  pool,
  {
    businessId,
    userId,
    periodStart,
    periodEnd,
    payDate,
    frequency,
    manualDeductions = {}, // employeeId -> dollars (string/number)
  },
) {
  // Resolve first to know which optional rules the run will actually use.
  const resolved = await resolveRules(pool, businessId, payDate);

  const employeesResult = await pool.query(
    "SELECT * FROM employees WHERE business_id = $1 AND is_active = TRUE",
    [businessId],
  );
  const employees = employeesResult.rows;
  if (employees.length === 0) {
    throw new RunError("No active employees", "NO_EMPLOYEES");
  }

  const neededTypes = [...CORE_TYPES];
  if (employees.some((e) => e.is_chauffeur)) {
    neededTypes.push("seguro_choferil");
  }
  if (typeof resolved.cfse_declaration?.payload?.premium_rate === "number") {
    neededTypes.push("cfse_declaration");
  }

  const preflight = await preflightRun(pool, businessId, payDate, neededTypes);
  if (!preflight.ok) {
    throw new RunError(
      "Payroll run blocked: unverified or missing rules",
      "PREFLIGHT_BLOCKED",
      preflight.blockers,
    );
  }

  // Pay frequency legality is itself a rule (0.3): enforced in
  // production, tolerated (with the watermark) in sandbox.
  const allowed =
    preflight.resolved.pay_frequencies_allowed?.payload?.frequencies || [];
  if (preflight.mode === "production" && !allowed.includes(frequency)) {
    throw new RunError(
      `Pay frequency "${frequency}" is not in the allowed-frequencies rule`,
      "FREQUENCY_NOT_ALLOWED",
    );
  }

  const profileResult = await pool.query(
    "SELECT size_band FROM payroll_employer_profiles WHERE business_id = $1",
    [businessId],
  );
  const employerProfile = {
    sizeBand: profileResult.rows[0]?.size_band || null,
  };

  const timeResult = await pool.query(
    `SELECT employee_id, work_date, hours, meal_break_missed
     FROM payroll_time_entries
     WHERE business_id = $1 AND work_date BETWEEN $2 AND $3`,
    [businessId, periodStart, periodEnd],
  );
  const hoursByEmployee = new Map();
  for (const row of timeResult.rows) {
    const list = hoursByEmployee.get(row.employee_id) || [];
    list.push({
      date: dateStr(row.work_date),
      hours: Number(row.hours),
      mealBreakMissed: row.meal_break_missed,
    });
    hoursByEmployee.set(row.employee_id, list);
  }

  const year = Number(payDate.slice(0, 4));
  const accResult = await pool.query(
    `SELECT * FROM employee_year_accumulators
     WHERE business_id = $1 AND year = $2`,
    [businessId, year],
  );
  const accByEmployee = new Map(accResult.rows.map((r) => [r.employee_id, r]));

  // Engine rules: id + payload per type actually resolved.
  const engineRules = {};
  for (const [type, rule] of Object.entries(preflight.resolved)) {
    engineRules[type] = { id: rule.id, payload: rule.payload };
  }
  // CFSE only participates when preflighted (verified premium on file).
  if (!neededTypes.includes("cfse_declaration")) {
    delete engineRules.cfse_declaration;
  }

  const lines = [];
  const allWarnings = new Set();
  for (const emp of employees) {
    const acc = accByEmployee.get(emp.id);
    const ytd = {
      grossCents: Number(acc?.gross_cents || 0),
      ssWagesCents: Number(acc?.ss_wages_cents || 0),
      medicareWagesCents: Number(acc?.medicare_wages_cents || 0),
      sinotWagesCents: Number(acc?.sinot_wages_cents || 0),
      sutaWagesCents: Number(acc?.suta_wages_cents || 0),
    };
    const manual = manualDeductions[emp.id];
    const result = computeLine({
      employee: {
        id: emp.id,
        payType: emp.pay_type,
        payRateCents: toCents(emp.pay_rate, `pay rate for ${emp.name}`),
        isChauffeur: emp.is_chauffeur,
        hireDate: dateStr(emp.start_date),
        elections: emp.elections_499r4 || {},
      },
      period: { frequency },
      dailyHours: hoursByEmployee.get(emp.id) || [],
      manualDeductionCents: manual ? toCents(manual, "manual deduction") : 0,
      rules: engineRules,
      ytd,
      employerProfile,
    });
    result.warnings.forEach((w) => allWarnings.add(w));
    if (result.grossCents > 0) {
      lines.push({ employeeId: emp.id, ...result });
    }
  }

  if (lines.length === 0) {
    throw new RunError(
      "Nothing to pay — no salaried employees and no time entries in the period",
      "EMPTY_RUN",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const periodResult = await client.query(
      `INSERT INTO pay_periods (business_id, frequency, period_start, period_end, pay_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (business_id, frequency, period_start, period_end)
       DO UPDATE SET pay_date = EXCLUDED.pay_date
       RETURNING id`,
      [businessId, frequency, periodStart, periodEnd, payDate],
    );
    const payPeriodId = periodResult.rows[0].id;

    const runResult = await client.query(
      `INSERT INTO payroll_runs_v2
        (business_id, pay_period_id, run_mode, status, rule_snapshot,
         gross_cents, employee_deductions_cents, employer_contributions_cents,
         net_cents, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        businessId,
        payPeriodId,
        preflight.mode,
        JSON.stringify(preflight.snapshot),
        sumCents(lines.map((l) => l.grossCents)),
        sumCents(lines.map((l) => l.employeeDeductionsCents)),
        sumCents(lines.map((l) => l.employerContributionsCents)),
        sumCents(lines.map((l) => l.netCents)),
        userId,
      ],
    );
    const run = runResult.rows[0];

    for (const line of lines) {
      const lineResult = await client.query(
        `INSERT INTO pay_lines
          (business_id, payroll_run_id, employee_id, gross_cents,
           employee_deductions_cents, employer_contributions_cents, net_cents,
           hours_worked, ss_taxable_cents, medicare_taxable_cents,
           sinot_taxable_cents, suta_taxable_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          businessId,
          run.id,
          line.employeeId,
          line.grossCents,
          line.employeeDeductionsCents,
          line.employerContributionsCents,
          line.netCents,
          line.deltas.hoursWorked,
          line.deltas.ssTaxableCents,
          line.deltas.medicareTaxableCents,
          line.deltas.sinotTaxableCents,
          line.deltas.sutaTaxableCents,
        ],
      );
      const lineId = lineResult.rows[0].id;
      for (const it of line.items) {
        await client.query(
          `INSERT INTO pay_items
            (business_id, pay_line_id, item_type, code, rule_id, quantity,
             rate_cents, amount_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            businessId,
            lineId,
            it.item_type,
            it.code,
            it.rule_id,
            it.quantity,
            it.rate_cents,
            it.amount_cents,
          ],
        );
      }
    }

    await client.query("COMMIT");
    return { run, warnings: [...allWarnings], watermark: preflight.watermark };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Finalize ─────────────────────────────────────────────────

export async function finalizeRun(pool, { businessId, userId, runId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const runResult = await client.query(
      `SELECT r.*, p.pay_date, p.period_start, p.period_end
       FROM payroll_runs_v2 r JOIN pay_periods p ON p.id = r.pay_period_id
       WHERE r.id = $1 AND r.business_id = $2 FOR UPDATE OF r`,
      [runId, businessId],
    );
    if (runResult.rows.length === 0) {
      throw new RunError("Payroll run not found", "NOT_FOUND");
    }
    const run = runResult.rows[0];
    if (run.status !== "draft") {
      throw new RunError("Only draft runs can be finalized", "NOT_DRAFT");
    }

    // Production integrity re-check: every snapshotted rule version must
    // STILL be verified at finalize time (a rule un-verified since the
    // draft was computed re-blocks the run).
    if (run.run_mode === "production") {
      const ids = Object.values(run.rule_snapshot || {});
      const check = await client.query(
        `SELECT COUNT(*)::int AS verified FROM payroll_rules
         WHERE id = ANY($1::uuid[]) AND verification_status = 'VERIFIED'`,
        [ids],
      );
      if (check.rows[0].verified !== ids.length) {
        throw new RunError(
          "A rule used by this run is no longer verified — recreate the run",
          "SNAPSHOT_UNVERIFIED",
        );
      }
    }

    const journalEntryId = await applyRunEffects(client, {
      run,
      businessId,
      userId,
      sign: run.reversal_of ? -1 : 1,
    });

    const updated = await client.query(
      `UPDATE payroll_runs_v2 SET
        status = 'finalized', finalized_by = $1, finalized_at = NOW(),
        journal_entry_id = $2
       WHERE id = $3 RETURNING *`,
      [userId, journalEntryId, runId],
    );

    // A reversal run's finalization retires its original.
    if (run.reversal_of) {
      await client.query(
        "UPDATE payroll_runs_v2 SET status = 'reversed' WHERE id = $1 AND status = 'finalized'",
        [run.reversal_of],
      );
    }

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Accumulator updates + ledger posting for a finalizing run.
 * Sandbox runs: NO effects (test runs never touch real books/YTD).
 * sign = -1 for reversal runs (decrement accumulators, mirrored JE).
 * @returns {string|null} journal entry id (production only)
 */
async function applyRunEffects(client, { run, businessId, userId, sign }) {
  if (run.run_mode !== "production") return null;

  const linesResult = await client.query(
    "SELECT * FROM pay_lines WHERE payroll_run_id = $1",
    [run.id],
  );
  const itemsResult = await client.query(
    `SELECT i.* FROM pay_items i
     JOIN pay_lines l ON l.id = i.pay_line_id
     WHERE l.payroll_run_id = $1`,
    [run.id],
  );
  const itemsByLine = new Map();
  for (const it of itemsResult.rows) {
    const list = itemsByLine.get(it.pay_line_id) || [];
    list.push(it);
    itemsByLine.set(it.pay_line_id, list);
  }

  const year = Number(dateStr(run.pay_date).slice(0, 4));
  const sumBy = (items, codes) =>
    items
      .filter((i) => codes.includes(i.code))
      .reduce((acc, i) => acc + Number(i.amount_cents), 0);

  for (const line of linesResult.rows) {
    const items = itemsByLine.get(line.id) || [];
    await client.query(
      `INSERT INTO employee_year_accumulators
        (business_id, employee_id, year, gross_cents, pr_tax_withheld_cents,
         ss_wages_cents, ss_withheld_cents, medicare_wages_cents,
         medicare_withheld_cents, sinot_wages_cents, suta_wages_cents,
         bonus_qualifying_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (business_id, employee_id, year) DO UPDATE SET
        gross_cents             = employee_year_accumulators.gross_cents + EXCLUDED.gross_cents,
        pr_tax_withheld_cents   = employee_year_accumulators.pr_tax_withheld_cents + EXCLUDED.pr_tax_withheld_cents,
        ss_wages_cents          = employee_year_accumulators.ss_wages_cents + EXCLUDED.ss_wages_cents,
        ss_withheld_cents       = employee_year_accumulators.ss_withheld_cents + EXCLUDED.ss_withheld_cents,
        medicare_wages_cents    = employee_year_accumulators.medicare_wages_cents + EXCLUDED.medicare_wages_cents,
        medicare_withheld_cents = employee_year_accumulators.medicare_withheld_cents + EXCLUDED.medicare_withheld_cents,
        sinot_wages_cents       = employee_year_accumulators.sinot_wages_cents + EXCLUDED.sinot_wages_cents,
        suta_wages_cents        = employee_year_accumulators.suta_wages_cents + EXCLUDED.suta_wages_cents,
        bonus_qualifying_hours  = employee_year_accumulators.bonus_qualifying_hours + EXCLUDED.bonus_qualifying_hours,
        updated_at              = NOW()`,
      [
        businessId,
        line.employee_id,
        year,
        sign * Number(line.gross_cents),
        sign * sumBy(items, ["pr_income_tax"]),
        sign * Number(line.ss_taxable_cents),
        sign * sumBy(items, ["social_security"]),
        sign * Number(line.medicare_taxable_cents),
        sign * sumBy(items, ["medicare", "medicare_additional"]),
        sign * Number(line.sinot_taxable_cents),
        sign * Number(line.suta_taxable_cents),
        sign * Number(line.hours_worked),
      ],
    );
  }

  // ── Balanced journal entry ──
  const allItems = itemsResult.rows;
  const grossCents = Number(run.gross_cents);
  const employerCents = Number(run.employer_contributions_cents);
  const netCents = Number(run.net_cents);

  const accountId = async (nameKey) => {
    const id = await getSystemAccountId(client, businessId, nameKey);
    if (!id) {
      throw new RunError(
        `Missing ledger account ${nameKey} — run migration 031`,
        "MISSING_ACCOUNT",
      );
    }
    return id;
  };

  // Normal run: debit expenses, credit liabilities. Reversal: mirrored.
  const lines = [];
  const push = async (nameKey, cents, side) => {
    if (cents <= 0) return;
    const flip = sign === -1;
    const debitSide = side === "debit" ? !flip : flip;
    lines.push({
      accountId: await accountId(nameKey),
      [debitSide ? "debit" : "credit"]: centsToDollars(cents),
    });
  };

  await push("coa.accounts.payroll_expense", grossCents, "debit");
  await push("coa.accounts.payroll_taxes_expense", employerCents, "debit");
  for (const [nameKey, codes] of CREDIT_BUCKETS) {
    await push(nameKey, sumBy(allItems, codes), "credit");
  }
  await push("coa.accounts.wages_payable", netCents, "credit");

  const entry = await postJournalEntry(client, {
    businessId,
    date: dateStr(run.pay_date),
    description: `${sign === -1 ? "Reversal — " : ""}Payroll ${dateStr(run.period_start)} → ${dateStr(run.period_end)}`,
    sourceType: "payroll_v2",
    sourceId: run.id,
    createdBy: userId,
    lines,
  });
  return entry.id;
}

// ── Reverse ──────────────────────────────────────────────────

export async function reverseRun(pool, { businessId, userId, runId }) {
  const client = await pool.connect();
  let reversalId;
  try {
    await client.query("BEGIN");

    const origResult = await client.query(
      `SELECT r.*, p.pay_date, p.period_start, p.period_end
       FROM payroll_runs_v2 r JOIN pay_periods p ON p.id = r.pay_period_id
       WHERE r.id = $1 AND r.business_id = $2 FOR UPDATE OF r`,
      [runId, businessId],
    );
    if (origResult.rows.length === 0) {
      throw new RunError("Payroll run not found", "NOT_FOUND");
    }
    const orig = origResult.rows[0];
    if (orig.status !== "finalized") {
      throw new RunError(
        "Only finalized runs can be reversed",
        "NOT_FINALIZED",
      );
    }
    if (orig.reversal_of) {
      throw new RunError("Cannot reverse a reversal run", "IS_REVERSAL");
    }

    // Mirror the run: same period, snapshot, totals, lines, and items.
    const revResult = await client.query(
      `INSERT INTO payroll_runs_v2
        (business_id, pay_period_id, run_mode, status, reversal_of,
         rule_snapshot, gross_cents, employee_deductions_cents,
         employer_contributions_cents, net_cents, created_by)
       SELECT business_id, pay_period_id, run_mode, 'draft', id,
              rule_snapshot, gross_cents, employee_deductions_cents,
              employer_contributions_cents, net_cents, $2
       FROM payroll_runs_v2 WHERE id = $1
       RETURNING id`,
      [runId, userId],
    );
    reversalId = revResult.rows[0].id;

    const lineMap = await client.query(
      `INSERT INTO pay_lines
        (business_id, payroll_run_id, employee_id, gross_cents,
         employee_deductions_cents, employer_contributions_cents, net_cents,
         hours_worked, ss_taxable_cents, medicare_taxable_cents,
         sinot_taxable_cents, suta_taxable_cents)
       SELECT business_id, $2, employee_id, gross_cents,
              employee_deductions_cents, employer_contributions_cents,
              net_cents, hours_worked, ss_taxable_cents,
              medicare_taxable_cents, sinot_taxable_cents, suta_taxable_cents
       FROM pay_lines WHERE payroll_run_id = $1
       RETURNING id, employee_id`,
      [runId, reversalId],
    );
    for (const newLine of lineMap.rows) {
      await client.query(
        `INSERT INTO pay_items
          (business_id, pay_line_id, item_type, code, rule_id, quantity,
           rate_cents, amount_cents)
         SELECT i.business_id, $3, i.item_type, i.code, i.rule_id,
                i.quantity, i.rate_cents, i.amount_cents
         FROM pay_items i
         JOIN pay_lines l ON l.id = i.pay_line_id
         WHERE l.payroll_run_id = $1 AND l.employee_id = $2`,
        [runId, newLine.employee_id, newLine.id],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Finalize the reversal (applies -1 effects and flips the original to
  // 'reversed') through the standard path so behavior stays identical.
  return finalizeRun(pool, { businessId, userId, runId: reversalId });
}
