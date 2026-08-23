-- 039 — individual vs entity 480.6SP payees (PENDIENTES §2.4)
-- Run with: psql $DATABASE_URL -f migrations/039_vendor_payee_type.sql
--
-- The 480.6SP export's v1 caveat: every payee shipped as a corporation
-- (FEIN, corporate amount columns) because vendors had one EIN field.
-- Individual contractors carry an SSN instead — stored encrypted with the
-- same AES-256-GCM write-only pattern as employee SSNs (fieldCrypto),
-- last-4 in clear for display. Existing vendors default to 'entity',
-- which is exactly what v1 assumed for them.

BEGIN;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS payee_type VARCHAR(20) NOT NULL DEFAULT 'entity',
  ADD COLUMN IF NOT EXISTS ssn_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS ssn_last4 CHAR(4);

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_payee_type_check;
ALTER TABLE vendors ADD CONSTRAINT vendors_payee_type_check
  CHECK (payee_type IN ('entity', 'individual'));

COMMIT;
