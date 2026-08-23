-- 036 — IVU mensual (SC 2915) groundwork (PENDIENTES-PRODUCCION §2.1)
-- Run with: psql $DATABASE_URL -f migrations/036_ivu_report.sql
--
-- 1. businesses.merchant_registration_number — the Hacienda "Registro de
--    Comerciante" number (11 digits, shown 7+4 e.g. 1234567-8901). Stored
--    free-form like tax_id; appears on the SC 2915 header and invoices.
-- 2. invoices split-tax columns — the combined tax_rate stays the source of
--    truth for the total; the new columns record how it decomposes into the
--    10.5% state portion and the 1% municipal portion (4% designated
--    services = state-only, muni 0). Amount identity is preserved:
--    tax_state_total + tax_muni_total = tax_total, always.
-- 3. Backfill: existing IVU invoices are split deterministically — any rate
--    >= 5% is assumed to include the 1% municipal SUT; 4%-and-below rates
--    (designated/B2B services) are state-only. Municipal is rounded once
--    and state derived by subtraction so the identity holds.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS merchant_registration_number VARCHAR(50);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tax_muni_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_state_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_muni_total NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill IVU invoices that predate the split columns.
UPDATE invoices
SET tax_muni_rate = sub.muni_rate,
    tax_muni_total = sub.muni_total,
    tax_state_total = sub.state_total
FROM (
  SELECT id,
         muni_rate,
         muni_total,
         (tax_total - muni_total) AS state_total
  FROM (
    SELECT id, tax_total,
           CASE WHEN tax_rate >= 5 THEN 1.000 ELSE 0 END AS muni_rate,
           LEAST(
             tax_total,
             ROUND(subtotal * (CASE WHEN tax_rate >= 5 THEN 1.000 ELSE 0 END) / 100, 2)
           ) AS muni_total
    FROM invoices
    WHERE tax_type = 'ivu' AND tax_total > 0
  ) inner_calc
) sub
WHERE invoices.id = sub.id
  AND invoices.tax_state_total = 0
  AND invoices.tax_muni_total = 0;

COMMIT;
