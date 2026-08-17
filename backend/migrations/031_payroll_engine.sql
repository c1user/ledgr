-- ============================================================
--  031 — Payroll engine support (ROADMAP-V5 · Phase 3)
--  Run with: psql $DATABASE_URL -f migrations/031_payroll_engine.sql
--
--  1) Accumulator-delta columns on pay_lines. Finalization must update
--     the per-employee/year accumulators with the TAXABLE wages of each
--     capped tax (which differ from gross once a wage base is hit), and
--     recomputing at finalize time would break determinism if inputs
--     changed after the draft. So the engine's deltas are stored on the
--     line at creation and finalization only applies them.
--
--  2) The payroll ledger accounts (per-agency liabilities + employer
--     tax expense) — the "sensible defaults" of the account mapping.
--     The COA rows themselves are the per-tenant mapping surface.
--     Existing businesses are backfilled here (015 pattern); new ones
--     get them via services/coaSeed.js.
-- ============================================================

BEGIN;

-- ── Pay line accumulator deltas ──────────────────────────────
ALTER TABLE pay_lines
  ADD COLUMN hours_worked          NUMERIC(7,2) NOT NULL DEFAULT 0,
  ADD COLUMN ss_taxable_cents      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN medicare_taxable_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN sinot_taxable_cents   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN suta_taxable_cents    BIGINT NOT NULL DEFAULT 0;

-- ── Payroll ledger accounts ──────────────────────────────────
-- 2300 (payroll_liabilities, generic) and 5000 (payroll_expense, gross
-- wages) already exist from the original template. These add the
-- per-agency split the PR engine posts to.
INSERT INTO chart_of_accounts
  (business_id, code, name_key, account_type, normal_balance, color, is_system)
SELECT b.id, v.code, v.name_key, v.account_type, v.normal_balance, v.color, TRUE
FROM businesses b
CROSS JOIN (VALUES
  ('2310', 'coa.accounts.payroll_wh_hacienda',  'liability', 'credit', '#D85A30'),
  ('2320', 'coa.accounts.payroll_fica_payable', 'liability', 'credit', '#C9542E'),
  ('2330', 'coa.accounts.payroll_dtrh_payable', 'liability', 'credit', '#BA4E2C'),
  ('2340', 'coa.accounts.payroll_cfse_accrued', 'liability', 'credit', '#AB482A'),
  ('2350', 'coa.accounts.payroll_bonus_accrued','liability', 'credit', '#9C4228'),
  ('2360', 'coa.accounts.wages_payable',        'liability', 'credit', '#8D3C26'),
  ('2370', 'coa.accounts.payroll_other_wh',     'liability', 'credit', '#7E3624'),
  ('5010', 'coa.accounts.payroll_taxes_expense','expense',   'debit',  '#C24E24')
) AS v(code, name_key, account_type, normal_balance, color)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.business_id = b.id AND c.name_key = v.name_key
);

COMMIT;
