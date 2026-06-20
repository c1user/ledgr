-- ============================================================
--  009 — Normalize the accounts.type CHECK constraint
--  Run with: psql $DATABASE_URL -f migrations/009_fix_account_type_constraint.sql
--
--  The original 001 constraint allowed ('bank', 'credit', 'cash', 'loan'),
--  but the API and the UI use ('savings', 'current', 'credit', 'cash', 'loan').
--  'bank' was never a real operational type; 'savings' and 'current' replaced it.
--  This aligns a freshly-migrated schema with what the code actually sends,
--  removing the long-standing mismatch between 001 and the application layer.
--
--  Safe to run on existing databases: DROP ... IF EXISTS tolerates the
--  renamed/missing constraint, and no existing row uses the removed 'bank' value.
-- ============================================================

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('savings', 'current', 'credit', 'cash', 'loan'));
