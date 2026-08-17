-- ============================================================
--  030 — Payroll domain model (ROADMAP-V5 · Phase 2)
--  Run with: psql $DATABASE_URL -f migrations/030_payroll_domain.sql
--
--  The v2 pay structure the PR engine (Phase 3) will calculate into:
--  TimeEntry → PayPeriod → PayrollRun → PayLine → PayItem, plus the
--  employer's compliance identity, per-employee/year accumulators, and
--  the compliance-obligation calendar. All money columns are INTEGER
--  CENTS (BIGINT) — no numeric dollars anywhere in the v2 pipeline.
--
--  Employees are EXTENDED in place (the roster is shared with the
--  frozen legacy tables): full SSN arrives encrypted (AES-256-GCM via
--  services/fieldCrypto.js — the DB only ever sees ciphertext),
--  classification and 499 R-4 elections are added, and semimonthly
--  joins the allowed pay frequencies ('monthly' stays legal at the DB
--  level for legacy rows; whether it may be USED is the
--  pay_frequencies_allowed DATA rule).
--
--  Legacy payroll_runs/payslips are frozen read-only at the ROUTE level
--  (decision 0.2) and get dropped in Phase 6.
-- ============================================================

BEGIN;

-- ── Employees v2 ─────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN ssn_encrypted   TEXT,
  ADD COLUMN address         TEXT,
  ADD COLUMN classification  VARCHAR(20)
    CHECK (classification IN ('nonexempt_hourly', 'exempt_salaried')),
  ADD COLUMN elections_499r4 JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN is_chauffeur    BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill classification from the existing pay basis.
UPDATE employees SET classification =
  CASE WHEN pay_type = 'hourly' THEN 'nonexempt_hourly'
       ELSE 'exempt_salaried' END
WHERE classification IS NULL;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pay_frequency_check;
ALTER TABLE employees ADD CONSTRAINT employees_pay_frequency_check
  CHECK (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly'));

-- ── Employer payroll profile ─────────────────────────────────
-- The employer's compliance identity. Federal EIN deliberately NOT
-- duplicated here — it lives on businesses.tax_id (used by 480.6SP too).
-- size_band is a key into the employer_size_bands rule payload.
CREATE TABLE payroll_employer_profiles (
  business_id           UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  merchant_reg_no       VARCHAR(50),
  suri_account_ref      VARCHAR(50),
  dtrh_employer_no      VARCHAR(50),   -- "número patronal"
  cfse_policy_no        VARCHAR(50),
  default_pay_frequency VARCHAR(20) NOT NULL DEFAULT 'biweekly'
    CHECK (default_pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  size_band             VARCHAR(20),
  default_municipality  VARCHAR(100),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Daily payroll time entries ───────────────────────────────
-- Raw hours per employee per day. Daily granularity is not optional:
-- PR overtime has a per-DAY threshold, so the engine needs days, not
-- weekly totals. Distinct from time_entries (user/project billing).
CREATE TABLE payroll_time_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date         DATE NOT NULL,
  hours             NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  meal_break_missed BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, employee_id, work_date)
);

CREATE INDEX idx_payroll_time_biz_date
  ON payroll_time_entries (business_id, work_date);
CREATE INDEX idx_payroll_time_employee
  ON payroll_time_entries (employee_id, work_date);

-- ── Pay periods ──────────────────────────────────────────────
CREATE TABLE pay_periods (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  frequency    VARCHAR(20) NOT NULL
    CHECK (frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  pay_date     DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE (business_id, frequency, period_start, period_end)
);

-- ── Payroll runs v2 ──────────────────────────────────────────
-- run_mode is stamped from businesses.payroll_mode at creation; the
-- watermark obligation travels with the run forever, so a sandbox run
-- stays watermarked even if the business later flips to production.
-- rule_snapshot maps rule_type -> payroll_rules.id for every rule the
-- run consumed — the reproducibility contract (same inputs + same
-- snapshot must recompute to the cent).
-- journal_entry_id is a bare UUID on purpose: the journal_entries DDL
-- is not yet in repo migrations (V4 item 1.2), so an FK here would
-- break fresh-database bootstrap.
CREATE TABLE payroll_runs_v2 (
  id                           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id                  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pay_period_id                UUID NOT NULL REFERENCES pay_periods(id),
  run_mode                     VARCHAR(20) NOT NULL
    CHECK (run_mode IN ('sandbox', 'production')),
  status                       VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'reversed')),
  reversal_of                  UUID REFERENCES payroll_runs_v2(id),
  rule_snapshot                JSONB NOT NULL DEFAULT '{}',
  gross_cents                  BIGINT NOT NULL DEFAULT 0,
  employee_deductions_cents    BIGINT NOT NULL DEFAULT 0,
  employer_contributions_cents BIGINT NOT NULL DEFAULT 0,
  net_cents                    BIGINT NOT NULL DEFAULT 0,
  journal_entry_id             UUID,
  created_by                   UUID NOT NULL REFERENCES users(id),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_by                 UUID REFERENCES users(id),
  finalized_at                 TIMESTAMPTZ
);

CREATE INDEX idx_payroll_runs_v2_biz
  ON payroll_runs_v2 (business_id, created_at DESC);

-- ── Pay lines (one per employee per run) ─────────────────────
-- business_id is denormalized onto lines and items so every payroll
-- table is directly business-scoped (same guarantee as the rest of the
-- schema, and it keeps export/delete walking flat).
CREATE TABLE pay_lines (
  id                           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id                  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payroll_run_id               UUID NOT NULL REFERENCES payroll_runs_v2(id) ON DELETE CASCADE,
  employee_id                  UUID NOT NULL REFERENCES employees(id),
  gross_cents                  BIGINT NOT NULL DEFAULT 0,
  employee_deductions_cents    BIGINT NOT NULL DEFAULT 0,
  employer_contributions_cents BIGINT NOT NULL DEFAULT 0,
  net_cents                    BIGINT NOT NULL DEFAULT 0,
  UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX idx_pay_lines_run ON pay_lines (payroll_run_id);

-- ── Pay items (typed components of a line) ───────────────────
-- rule_id links each computed item to the exact rule VERSION that
-- produced it. NULL only for items no rule governs (base salary
-- earning, manual fixed deduction).
CREATE TABLE pay_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pay_line_id  UUID NOT NULL REFERENCES pay_lines(id) ON DELETE CASCADE,
  item_type    VARCHAR(30) NOT NULL
    CHECK (item_type IN ('earning', 'employee_deduction', 'employer_contribution')),
  code         VARCHAR(50) NOT NULL,
  rule_id      UUID REFERENCES payroll_rules(id),
  quantity     NUMERIC(8,2),
  rate_cents   BIGINT,
  amount_cents BIGINT NOT NULL,
  CHECK (amount_cents >= 0)
);

CREATE INDEX idx_pay_items_line ON pay_items (pay_line_id);

-- ── Immutability of finalized runs ───────────────────────────
-- A finalized run is history. The ONLY permitted transition afterward
-- is marking it 'reversed' (with every other column untouched) when an
-- explicit reversal run is posted. Deletes are refused. Lines and
-- items of a non-draft run cannot be inserted, updated, or deleted.
CREATE OR REPLACE FUNCTION payroll_runs_v2_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Finalized payroll runs cannot be deleted — post a reversal run instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'finalized' THEN
    IF NOT (NEW.status = 'reversed'
            AND NEW.pay_period_id IS NOT DISTINCT FROM OLD.pay_period_id
            AND NEW.rule_snapshot IS NOT DISTINCT FROM OLD.rule_snapshot
            AND NEW.gross_cents IS NOT DISTINCT FROM OLD.gross_cents
            AND NEW.employee_deductions_cents IS NOT DISTINCT FROM OLD.employee_deductions_cents
            AND NEW.employer_contributions_cents IS NOT DISTINCT FROM OLD.employer_contributions_cents
            AND NEW.net_cents IS NOT DISTINCT FROM OLD.net_cents
            AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
            AND NEW.run_mode IS NOT DISTINCT FROM OLD.run_mode) THEN
      RAISE EXCEPTION 'Finalized payroll runs are immutable — post a reversal run instead';
    END IF;
  ELSIF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed payroll runs are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_runs_v2_guard
  BEFORE UPDATE OR DELETE ON payroll_runs_v2
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_v2_guard();

CREATE OR REPLACE FUNCTION pay_children_guard()
RETURNS TRIGGER AS $$
DECLARE
  run_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'pay_lines' THEN
    SELECT r.status INTO run_status FROM payroll_runs_v2 r
     WHERE r.id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  ELSE
    SELECT r.status INTO run_status
      FROM pay_lines l JOIN payroll_runs_v2 r ON r.id = l.payroll_run_id
     WHERE l.id = COALESCE(NEW.pay_line_id, OLD.pay_line_id);
  END IF;

  IF run_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Pay lines/items of a % payroll run are immutable', run_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pay_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON pay_lines
  FOR EACH ROW EXECUTE FUNCTION pay_children_guard();

CREATE TRIGGER trg_pay_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON pay_items
  FOR EACH ROW EXECUTE FUNCTION pay_children_guard();

-- ── Per-employee, per-year accumulators ──────────────────────
-- Snapshot-updated ONLY by run finalization (reversals decrement) —
-- the engine service is the sole writer. Wage-base caps read these,
-- never annualized estimates. bonus_qualifying_hours tracks the
-- Law-148 window ENDING in `year` (the window is Oct 1 – Sep 30, a
-- DATA rule), not the calendar year like the tax columns.
CREATE TABLE employee_year_accumulators (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year                    SMALLINT NOT NULL,
  gross_cents             BIGINT NOT NULL DEFAULT 0,
  pr_tax_withheld_cents   BIGINT NOT NULL DEFAULT 0,
  ss_wages_cents          BIGINT NOT NULL DEFAULT 0,
  ss_withheld_cents       BIGINT NOT NULL DEFAULT 0,
  medicare_wages_cents    BIGINT NOT NULL DEFAULT 0,
  medicare_withheld_cents BIGINT NOT NULL DEFAULT 0,
  sinot_wages_cents       BIGINT NOT NULL DEFAULT 0,
  suta_wages_cents        BIGINT NOT NULL DEFAULT 0,
  bonus_qualifying_hours  NUMERIC(7,2) NOT NULL DEFAULT 0,
  vacation_hours          NUMERIC(7,2) NOT NULL DEFAULT 0,
  sick_hours              NUMERIC(7,2) NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, employee_id, year)
);

-- ── Compliance obligations ───────────────────────────────────
-- Generated per employer from data-driven schedule rules (Phase 5).
-- rule_id records which schedule-rule version produced the due date.
CREATE TABLE compliance_obligations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  obligation_type VARCHAR(50) NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'ready', 'done', 'late')),
  export_ref      TEXT,
  rule_id         UUID REFERENCES payroll_rules(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, obligation_type, period_start)
);

CREATE INDEX idx_compliance_obligations_due
  ON compliance_obligations (business_id, due_date);

COMMIT;
