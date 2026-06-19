-- ============================================================
--  LEDGR — Migration 006: Multi-currency support
--  Run with: psql $DATABASE_URL -f backend/migrations/006_fx.sql
-- ============================================================

-- Add FX columns to transactions.
-- original_currency / original_amount = the foreign-currency side of the transaction.
-- exchange_rate = 1 {original_currency} = X {business base currency}.
-- total_amount (existing column) always stores the base-currency equivalent.
ALTER TABLE transactions
  ADD COLUMN original_currency CHAR(3),
  ADD COLUMN original_amount   NUMERIC(12,2),
  ADD COLUMN exchange_rate     NUMERIC(12,6) NOT NULL DEFAULT 1;

-- Rate cache: avoid repeated external API calls for the same currency pair + date.
-- Rates never change retroactively, so a simple (base, target, date) PK works.
CREATE TABLE fx_rate_cache (
  base      CHAR(3) NOT NULL,
  target    CHAR(3) NOT NULL,
  rate_date DATE    NOT NULL,
  rate      NUMERIC(12,6) NOT NULL,
  PRIMARY KEY (base, target, rate_date)
);
CREATE INDEX idx_fx_cache_date ON fx_rate_cache(rate_date);
