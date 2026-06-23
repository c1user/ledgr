-- ============================================================
--  015 — Hacienda 480.6SP (Services Rendered) + §1062.03 withholding (#16)
--  Run with: psql $DATABASE_URL -f migrations/015_hacienda_withholding.sql
--
--  Puerto Rico's Form 480.6SP reports payments to vendors for services
--  rendered, split between amounts subject and not subject to the 10%
--  withholding at source under Code §1062.03. This migration adds:
--
--   - the payer (informante) address block on `businesses` — 480.6SP needs
--     the payer's mailing address, which we never stored before;
--   - the per-vendor waiver (relevo) fields on `vendors`;
--   - per-transaction `withholding_amount` (the §1062.03 tax withheld on a
--     service payment; > 0 means that payment was subject to withholding);
--   - a seeded "Services Withholding Payable" liability account so the 10%
--     held back posts as a liability owed to Hacienda (not money to the
--     vendor) — backfilled here for existing businesses, and added to the
--     COA template (services/coaSeed.js) for new ones.
-- ============================================================

-- ── Payer (informante) address on businesses ─────────────────
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS city    VARCHAR(100);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS state   VARCHAR(100);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS zip     VARCHAR(20);

-- ── Vendor waiver (relevo) fields ────────────────────────────
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS withholding_exempt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS waiver_certificate_no VARCHAR(50);

-- ── Per-transaction §1062.03 withholding ─────────────────────
-- The tax withheld on a service payment. total_amount stays the GROSS expense;
-- the funding line is credited net (gross - withholding) and this amount is
-- credited to the Services Withholding Payable liability. > 0 ⇒ the payment is
-- "subject to withholding" for 480.6SP purposes.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS withholding_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_withholding_nonneg_chk;
ALTER TABLE transactions ADD CONSTRAINT transactions_withholding_nonneg_chk
  CHECK (withholding_amount >= 0);

-- ── Backfill the Services Withholding Payable account ────────
-- New businesses get this via services/coaSeed.js; this seeds it for every
-- existing business that doesn't already have it. Matched on name_key so the
-- posting service (resolves by name_key) always finds exactly one.
INSERT INTO chart_of_accounts
  (business_id, code, name_key, account_type, normal_balance, color, is_system)
SELECT b.id, '2400', 'coa.accounts.services_withholding_payable',
       'liability', 'credit', '#D85A30', TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.business_id = b.id
    AND c.name_key = 'coa.accounts.services_withholding_payable'
);
