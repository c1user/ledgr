-- 038 — point existing UNVERIFIED w2pr_file_spec rules at the real layout
-- Run with: psql $DATABASE_URL -f migrations/038_w2pr_spec_upgrade.sql
--
-- The EFW2PR-TY2025 builder (Pub 25-01) landed after businesses were
-- seeded, and seedPayrollRules never touches existing rules — without this
-- backfill every pre-existing business would keep generating the old
-- illustrative placeholder layout, and an owner could even VERIFY that
-- stale rule and file a structurally wrong document believing it real.
-- Only UNVERIFIED placeholder rows are updated (VERIFIED rows are
-- immutable by trigger, and a human's explicit choice is never clobbered).

BEGIN;

UPDATE payroll_rules
SET payload = payload || jsonb_build_object(
      'spec_version', 'EFW2PR-TY2025',
      'publication',
      'Hacienda Publication 25-01 (Rev. 2025-09-23) — EFW2PR, Tax Year 2025'
    ),
    source_citation =
      'PENDING VERIFY — implemented from Hacienda Publication 25-01 (Rev. 2025-09-23), ''Developer Guide — Form 499R-2/W-2PR (Copy A) Electronic Filing Requirements, Tax Year 2025'' (hacienda.pr.gov/publicaciones). Diff against the TY2026 publication (expected fall 2026) before the January 2027 filing.',
    notes =
      'The export builder must target the version named here; bumping the year is a new rule version. EFW2PR: 9 mandatory 512-byte records (RA/RE/RW/RO/RS/RT/RU/RV/RF). Upgraded from TY2025-PLACEHOLDER by migration 038.'
WHERE rule_type = 'w2pr_file_spec'
  AND verification_status = 'UNVERIFIED'
  AND payload->>'spec_version' = 'TY2025-PLACEHOLDER';

COMMIT;
