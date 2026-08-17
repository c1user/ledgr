-- ============================================================
--  035 — Retire legacy payroll (ROADMAP-V5 · Phase 6.6, decision 0.2)
--  Run with: psql $DATABASE_URL -f migrations/035_drop_legacy_payroll.sql
--
--  The V1 payroll engine hardcoded mainland-style rates and withheld
--  federal income tax for PR residents — its runs were frozen read-only
--  in Phase 2 and every consumer (reports, AI context, employee list)
--  now reads the v2 tables. This drops the legacy run tables and the
--  W-4-style employee columns the PR engine never uses (499 R-4
--  elections live in employees.elections_499r4).
--
--  DESTRUCTIVE for legacy demo runs only; no production users exist
--  (pre-launch) and v2 sandbox runs are the demo data now.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS payslips;
DROP TABLE IF EXISTS payroll_runs;

ALTER TABLE employees
  DROP COLUMN IF EXISTS federal_filing_status,
  DROP COLUMN IF EXISTS federal_allowances,
  DROP COLUMN IF EXISTS pr_state_tax_rate,
  DROP COLUMN IF EXISTS federal_exempt;

COMMIT;
