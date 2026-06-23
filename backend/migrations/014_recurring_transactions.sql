-- ============================================================
--  014 — Recurring transactions (#7)
--  Run with: psql $DATABASE_URL -f migrations/014_recurring_transactions.sql
--
--  A recurring transaction is a TEMPLATE, not a ledger entry. On its due
--  date the system materializes a real `transactions` row from it and posts
--  the balanced journal entry through services/ledger.js — exactly as if the
--  owner had entered it by hand. Generated rows carry recurring_id so they're
--  marked as auto-generated and listable per template.
--
--  The template mirrors a transaction's shape: a funding source (exactly one
--  of account_id / funding_coa_id, like `transactions`), a type, and the
--  revenue/expense account it books to (category_account_id). next_due is the
--  date of the next occurrence to generate; last_generated is the most recent
--  one materialized.
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- Funding source: exactly one of account_id / funding_coa_id (mirrors transactions).
  account_id           UUID REFERENCES accounts(id),
  funding_coa_id       UUID REFERENCES chart_of_accounts(id),
  -- The revenue (income) or expense account each generated transaction books to.
  category_account_id  UUID NOT NULL REFERENCES chart_of_accounts(id),
  type                 VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  merchant             VARCHAR(255),
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  frequency            VARCHAR(20) NOT NULL
                         CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  start_date           DATE NOT NULL,
  end_date             DATE,
  last_generated       DATE,
  next_due             DATE NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  notes                TEXT,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one funding source, same XOR rule as transactions.
  CONSTRAINT recurring_funding_source_chk
    CHECK ((account_id IS NOT NULL) <> (funding_coa_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_recurring_business ON recurring_transactions(business_id);
-- Partial index for the "what's due now" sweep across active templates.
CREATE INDEX IF NOT EXISTS idx_recurring_due
  ON recurring_transactions(business_id, next_due) WHERE is_active;

-- Mark transactions that were materialized from a template. ON DELETE SET NULL
-- so deleting a template never destroys posted ledger history — the generated
-- transactions simply lose their backreference.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS recurring_id UUID
    REFERENCES recurring_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_recurring ON transactions(recurring_id);
