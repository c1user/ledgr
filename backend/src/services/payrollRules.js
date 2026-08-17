/**
 * services/payrollRules.js
 *
 * ROADMAP-V5 · Phase 1.2/1.6 — rule resolution and run preflight.
 *
 * This is the single chokepoint through which payroll code obtains tax
 * rules, the same philosophy as ledger.js for postings. The engine
 * (Phase 3) consumes resolved rule versions BY ID and snapshots those
 * IDs onto every run — nothing in a payroll calculation may ever read a
 * rate from anywhere else.
 *
 * Preflight is the UNVERIFIED gate:
 *   production → any UNVERIFIED (or missing) rule hard-fails the run,
 *                listing exactly which rules block it;
 *   sandbox    → runs proceed, but the caller receives watermark: true
 *                and must stamp SANDBOX_WATERMARK on every output
 *                (screen, PDF, export). No output path may skip it.
 */

// The exact banner text, verbatim per spec. Outputs render it as-is.
export const SANDBOX_WATERMARK = "CÁLCULO NO VERIFICADO — SOLO PRUEBAS";

// Rule types the v1 calculation engine consumes on every run. Phase 3
// passes the precise per-run list (e.g. seguro_choferil only when an
// employee is flagged); this default is the conservative core set.
export const CORE_RUN_RULE_TYPES = [
  "pr_income_tax_withholding",
  "social_security",
  "medicare",
  "sinot",
  "suta",
  "overtime",
  "christmas_bonus",
  "pay_frequencies_allowed",
];

/**
 * Resolve every applicable rule version for a business on a pay date.
 * A rule applies when effective_from <= date <= COALESCE(effective_to, ∞).
 * The exclusion constraint guarantees at most one version per rule_type
 * matches, so the result is a plain map.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} businessId
 * @param {string} payDate - 'YYYY-MM-DD' (America/Puerto_Rico calendar date)
 * @returns {Promise<Object<string, object>>} rule_type -> full rule row
 */
export async function resolveRules(db, businessId, payDate) {
  const result = await db.query(
    `SELECT * FROM payroll_rules
     WHERE business_id = $1
       AND effective_from <= $2
       AND (effective_to IS NULL OR effective_to >= $2)`,
    [businessId, payDate],
  );

  const byType = {};
  for (const row of result.rows) {
    byType[row.rule_type] = row;
  }
  return byType;
}

/**
 * The rule-version snapshot stored on a payroll run: rule_type -> rule id.
 * Re-running with the same inputs and snapshot must reproduce identical
 * output to the cent (Phase 3 enforces; Phase 6 tests).
 */
export function snapshotRuleIds(resolved) {
  const snapshot = {};
  for (const [type, rule] of Object.entries(resolved)) {
    snapshot[type] = rule.id;
  }
  return snapshot;
}

/**
 * Preflight a payroll run for a business on a pay date.
 *
 * Never throws for rule problems — it reports, and the caller decides
 * (routes turn ok:false into a 422 listing the blockers). Shape:
 *   mode        'sandbox' | 'production'
 *   watermark   true in sandbox — caller MUST stamp SANDBOX_WATERMARK
 *   ok          false when production mode is blocked
 *   blockers    [{ rule_type, reason: 'UNVERIFIED'|'MISSING', ... }]
 *   resolved    rule_type -> rule row (what the run would use)
 *   snapshot    rule_type -> rule id (to store on the run)
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} businessId
 * @param {string} payDate - 'YYYY-MM-DD'
 * @param {string[]} [ruleTypes] - rule types this run will consume
 */
export async function preflightRun(
  db,
  businessId,
  payDate,
  ruleTypes = CORE_RUN_RULE_TYPES,
) {
  const modeResult = await db.query(
    "SELECT payroll_mode FROM businesses WHERE id = $1",
    [businessId],
  );
  if (modeResult.rows.length === 0) {
    throw new Error("Business not found for payroll preflight");
  }
  const mode = modeResult.rows[0].payroll_mode;

  const resolved = await resolveRules(db, businessId, payDate);

  const blockers = [];
  for (const type of ruleTypes) {
    const rule = resolved[type];
    if (!rule) {
      blockers.push({ rule_type: type, reason: "MISSING", pay_date: payDate });
    } else if (rule.verification_status !== "VERIFIED") {
      blockers.push({
        rule_type: type,
        reason: "UNVERIFIED",
        rule_id: rule.id,
        source_citation: rule.source_citation,
      });
    }
  }

  return {
    mode,
    watermark: mode === "sandbox",
    ok: mode === "sandbox" || blockers.length === 0,
    blockers,
    resolved,
    snapshot: snapshotRuleIds(resolved),
  };
}
