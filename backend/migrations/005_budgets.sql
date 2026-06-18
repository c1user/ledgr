-- Budgets: per-category monthly spending targets
-- Run with: psql $DATABASE_URL -f backend/migrations/005_budgets.sql

CREATE TABLE budgets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period      DATE NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  rollover    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, category_id, period)
);

CREATE INDEX idx_budgets_business_period ON budgets(business_id, period);
