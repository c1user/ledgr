-- ============================================================
--  LEDGR — Migration 003: Auto-Categorization Rules
--  Run with: psql $DATABASE_URL -f migrations/003_categorization_rules.sql
-- ============================================================

CREATE TABLE categorization_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  priority    INTEGER NOT NULL DEFAULT 0,
  name        VARCHAR(255) NOT NULL,
  match_type  VARCHAR(20) NOT NULL CHECK (match_type IN ('contains', 'equals', 'regex')),
  pattern     TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_rules_business ON categorization_rules(business_id, is_active, priority);

ALTER TABLE transactions
  ADD COLUMN applied_rule_id UUID REFERENCES categorization_rules(id) ON DELETE SET NULL;
