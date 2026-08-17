-- ============================================================
--  032 — Payroll purge hatch (ROADMAP-V5 · Phase 3 fix)
--  Run with: psql $DATABASE_URL -f migrations/032_payroll_purge_hatch.sql
--
--  The immutability guards (029: verified rules, 030: finalized runs
--  and their lines/items) refuse DELETE — which also blocks the
--  close-business flow (services/businessData.js deleteBusinessData),
--  a GDPR requirement and a store-review requirement (V4 5.6).
--
--  Fix: a transaction-local escape hatch. deleteBusinessData runs
--  SET LOCAL app.allow_payroll_purge = 'on' inside its transaction;
--  the guards let DELETEs through only under that flag. The flag dies
--  with the transaction and cannot leak; UPDATE immutability is never
--  relaxed.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION payroll_rules_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.allow_payroll_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    IF OLD.verification_status = 'VERIFIED' THEN
      RAISE EXCEPTION 'Verified payroll rules cannot be deleted — supersede with a new version instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.verification_status = 'VERIFIED' THEN
    IF NEW.payload            IS DISTINCT FROM OLD.payload
       OR NEW.business_id     IS DISTINCT FROM OLD.business_id
       OR NEW.rule_type       IS DISTINCT FROM OLD.rule_type
       OR NEW.jurisdiction    IS DISTINCT FROM OLD.jurisdiction
       OR NEW.effective_from  IS DISTINCT FROM OLD.effective_from
       OR NEW.source_citation IS DISTINCT FROM OLD.source_citation THEN
      RAISE EXCEPTION 'Verified payroll rules are immutable — supersede with a new version instead';
    END IF;
  END IF;

  IF NEW.verification_status = 'UNVERIFIED' THEN
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payroll_runs_v2_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.allow_payroll_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION pay_children_guard()
RETURNS TRIGGER AS $$
DECLARE
  run_status TEXT;
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.allow_payroll_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

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

COMMIT;
