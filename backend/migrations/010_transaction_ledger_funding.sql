-- ============================================================
--  010 — Allow a transaction to be funded from a ledger account
--  Run with: psql $DATABASE_URL -f migrations/010_transaction_ledger_funding.sql
--
--  Until now a transaction's funding/source side had to be an operational
--  bank account (transactions.account_id NOT NULL -> accounts). The double-entry
--  posting, however, already credits/debits a chart_of_accounts id. This lets
--  the funding side be EITHER an operational account (account_id) OR an
--  asset/liability ledger account directly (funding_coa_id) — exactly one.
--
--  Safe on existing data: every current row has account_id set and
--  funding_coa_id NULL, which satisfies the XOR constraint.
-- ============================================================

ALTER TABLE transactions ALTER COLUMN account_id DROP NOT NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS funding_coa_id UUID REFERENCES chart_of_accounts(id);

-- Exactly one funding source must be set.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_funding_source_chk;
ALTER TABLE transactions ADD CONSTRAINT transactions_funding_source_chk
  CHECK ((account_id IS NOT NULL) <> (funding_coa_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_transactions_funding_coa
  ON transactions(funding_coa_id);
