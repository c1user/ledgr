-- ============================================================
--  LEDGR — Initial Database Migration
--  Run with: psql $DATABASE_URL -f migrations/001_initial.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
--  CORE
-- ============================================================

CREATE TABLE businesses (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               VARCHAR(255) NOT NULL,
  email              VARCHAR(255) NOT NULL UNIQUE,
  plan               VARCHAR(20) NOT NULL DEFAULT 'free'
                       CHECK (plan IN ('free', 'starter', 'pro')),
  tax_id             VARCHAR(50),
  fiscal_year_start  INTEGER NOT NULL DEFAULT 1
                       CHECK (fiscal_year_start BETWEEN 1 AND 12),
  currency           CHAR(3) NOT NULL DEFAULT 'USD',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  role           VARCHAR(20) NOT NULL DEFAULT 'owner'
                   CHECK (role IN ('owner', 'admin', 'viewer')),
  password_hash  TEXT NOT NULL,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  type              VARCHAR(20) NOT NULL
                      CHECK (type IN ('bank', 'credit', 'cash', 'loan')),
  plaid_account_id  TEXT,
  current_balance   NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          CHAR(3) NOT NULL DEFAULT 'USD',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  type         VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  color        CHAR(7) NOT NULL DEFAULT '#888888',
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id    UUID REFERENCES categories(id) ON DELETE SET NULL
);

-- ============================================================
--  TRANSACTIONS
-- ============================================================

CREATE TABLE receipts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  uploaded_by       UUID NOT NULL REFERENCES users(id),
  s3_key            TEXT NOT NULL,
  original_filename TEXT,
  ai_merchant       VARCHAR(255),
  ai_date           DATE,
  ai_total          NUMERIC(12,2),
  ai_line_items     JSONB,
  ai_confidence     NUMERIC(3,2) CHECK (ai_confidence BETWEEN 0 AND 1),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'reviewed', 'linked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id),
  created_by    UUID NOT NULL REFERENCES users(id),
  date          DATE NOT NULL,
  merchant      VARCHAR(255),
  total_amount  NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  type          VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  is_split      BOOLEAN NOT NULL DEFAULT FALSE,
  receipt_id    UUID REFERENCES receipts(id) ON DELETE SET NULL,
  plaid_tx_id   TEXT UNIQUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transaction_splits (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES categories(id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  notes           TEXT
);

-- Enforce that split amounts always add up to the parent total
CREATE OR REPLACE FUNCTION check_split_total()
RETURNS TRIGGER AS $$
DECLARE
  parent_total NUMERIC(12,2);
  split_sum    NUMERIC(12,2);
BEGIN
  SELECT total_amount INTO parent_total
    FROM transactions WHERE id = NEW.transaction_id;
  SELECT COALESCE(SUM(amount), 0) INTO split_sum
    FROM transaction_splits WHERE transaction_id = NEW.transaction_id;
  IF split_sum > parent_total THEN
    RAISE EXCEPTION 'Split amounts (%) exceed transaction total (%)',
      split_sum, parent_total;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_split_total
  AFTER INSERT OR UPDATE ON transaction_splits
  FOR EACH ROW EXECUTE FUNCTION check_split_total();

-- ============================================================
--  PAYROLL
-- ============================================================

CREATE TABLE employees (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                  VARCHAR(255) NOT NULL,
  email                 VARCHAR(255),
  ssn_last4             CHAR(4),
  pay_type              VARCHAR(10) NOT NULL CHECK (pay_type IN ('salary', 'hourly')),
  pay_rate              NUMERIC(10,2) NOT NULL CHECK (pay_rate > 0),
  pay_frequency         VARCHAR(20) NOT NULL
                          CHECK (pay_frequency IN ('weekly', 'biweekly', 'monthly')),
  federal_filing_status VARCHAR(10) NOT NULL DEFAULT 'single'
                          CHECK (federal_filing_status IN ('single', 'married')),
  federal_allowances    INTEGER NOT NULL DEFAULT 0,
  pr_state_tax_rate     NUMERIC(5,4) NOT NULL DEFAULT 0.0700,
  start_date            DATE NOT NULL,
  end_date              DATE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE payroll_runs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  run_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  total_gross   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_taxes   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net     NUMERIC(12,2) NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'finalized')),
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);

CREATE TABLE payslips (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_run_id   UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id),
  gross_pay        NUMERIC(10,2) NOT NULL CHECK (gross_pay >= 0),
  federal_tax      NUMERIC(10,2) NOT NULL DEFAULT 0,
  social_security  NUMERIC(10,2) NOT NULL DEFAULT 0,
  medicare         NUMERIC(10,2) NOT NULL DEFAULT 0,
  pr_state_tax     NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay          NUMERIC(10,2) NOT NULL CHECK (net_pay >= 0),
  hours_worked     NUMERIC(6,2),
  UNIQUE (payroll_run_id, employee_id)
);

-- ============================================================
--  AI
-- ============================================================

CREATE TABLE ai_conversations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id),
  messages     JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on ai_conversations
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
--  INDEXES
-- ============================================================

CREATE INDEX idx_users_business           ON users(business_id);
CREATE INDEX idx_accounts_business        ON accounts(business_id, is_active);
CREATE INDEX idx_categories_business      ON categories(business_id);
CREATE INDEX idx_transactions_business    ON transactions(business_id, date DESC);
CREATE INDEX idx_transactions_account     ON transactions(account_id);
CREATE INDEX idx_splits_transaction       ON transaction_splits(transaction_id);
CREATE INDEX idx_receipts_business_status ON receipts(business_id, status);
CREATE INDEX idx_employees_business       ON employees(business_id, is_active);
CREATE INDEX idx_payroll_runs_business    ON payroll_runs(business_id, period_start DESC);
CREATE INDEX idx_payslips_run             ON payslips(payroll_run_id);
CREATE INDEX idx_ai_conversations_biz     ON ai_conversations(business_id);
CREATE INDEX idx_ai_messages_gin          ON ai_conversations USING GIN(messages);
CREATE INDEX idx_receipts_line_items_gin  ON receipts USING GIN(ai_line_items);

-- ============================================================
--  DEFAULT CATEGORIES (seeded for every new business via app)
-- ============================================================

-- These are inserted by the backend when a new business registers,
-- not here, since they need a real business_id UUID.
-- See backend/src/services/seed.js for the seeding logic.