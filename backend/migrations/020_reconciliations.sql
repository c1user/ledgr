-- 020_reconciliations.sql
-- Roadmap v2 · item 12: manual bank reconciliation.
-- A reconciliation covers one funding source (operational bank account OR
-- ledger cash account) over a period, against the bank statement's start and
-- end balances. Transactions link to it while being matched; once the
-- reconciliation is completed those transactions are locked (enforced in
-- the transactions routes).

BEGIN;

CREATE TABLE reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  funding_coa_id UUID REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  statement_start_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  statement_end_balance NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(account_id, funding_coa_id) = 1),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_reconciliations_business ON reconciliations(business_id);

-- Cancelling a reconciliation (DELETE) automatically releases its
-- transactions via SET NULL.
ALTER TABLE transactions
  ADD COLUMN reconciliation_id UUID REFERENCES reconciliations(id)
    ON DELETE SET NULL;

CREATE INDEX idx_transactions_reconciliation
  ON transactions(reconciliation_id);

COMMIT;
