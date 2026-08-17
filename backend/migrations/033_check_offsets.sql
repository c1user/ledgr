-- ============================================================
--  033 — Check-stock alignment offsets (ROADMAP-V5 · Phase 4.2)
--  Run with: psql $DATABASE_URL -f migrations/033_check_offsets.sql
--
--  Per-employer X/Y nudge (millimeters, may be negative) so the check
--  layer lines up with a specific printer + pre-printed stock combo.
-- ============================================================

BEGIN;

ALTER TABLE payroll_employer_profiles
  ADD COLUMN check_offset_x_mm NUMERIC(5,1) NOT NULL DEFAULT 0,
  ADD COLUMN check_offset_y_mm NUMERIC(5,1) NOT NULL DEFAULT 0;

COMMIT;
