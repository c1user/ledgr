-- 037 — W-2PR real layout + Reg. 9017 stub + compliance notifier groundwork
-- Run with: psql $DATABASE_URL -f migrations/037_w2pr_9017_notifier.sql
--
-- 1. employees.position — Reg. 9017 Art. XV requires the "puesto" on every
--    pay stub; the app had no job-title column.
-- 2. employees structured address — the EFW2PR (Pub 25-01) RW/RS records
--    carry street/city/state/zip separately; employees.address was one
--    unstructured TEXT blob. The blob stays as the street line; city/state/
--    zip are new columns (state defaults to PR at the UI level, not here).
-- 3. compliance_obligations notified_* markers — the daily compliance
--    notifier alerts once when an obligation enters "due soon" and once
--    when it becomes late; these timestamps are the dedup.
-- 4. Partial index for the notifier's cross-business scan (the existing
--    index leads with business_id and can't serve a global due-date scan).

BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS position VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address_state VARCHAR(50),
  ADD COLUMN IF NOT EXISTS address_zip VARCHAR(20);

ALTER TABLE compliance_obligations
  ADD COLUMN IF NOT EXISTS notified_upcoming_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_late_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_compliance_obligations_pending
  ON compliance_obligations (due_date)
  WHERE status <> 'done';

COMMIT;
