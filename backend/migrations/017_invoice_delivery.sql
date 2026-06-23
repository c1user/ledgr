-- ============================================================
--  017 — Invoice delivery (#10): record when an invoice was emailed
--  Run with: psql $DATABASE_URL -f migrations/017_invoice_delivery.sql
--
--  Server-side PDF + email delivery. `sent_at` records when the invoice
--  PDF was last emailed to the client (set on send/resend), powering
--  "sent X ago" and resend tracking. The status enum already includes
--  'overdue', so no other column is needed.
-- ============================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
