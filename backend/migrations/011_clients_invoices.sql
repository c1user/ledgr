-- ============================================================
--  011 — Clients (#5) + Invoicing (#10) + IVU/Spanish (#11)
--  Run with: psql $DATABASE_URL -f migrations/011_clients_invoices.sql
--
--  Clients are the receivable-side mirror of vendors: who you bill.
--  Invoices reference a client, carry line items, and post balanced
--  journal entries through services/ledger.js:
--    on SEND: DR Accounts Receivable, CR Revenue (+ CR Sales Tax Payable)
--    on PAY:  DR Cash/Bank,           CR Accounts Receivable
--  Voiding removes the invoice's journal entries.
--
--  IVU (#11): tax_type='ivu' itemizes Puerto Rico's sales tax separately
--  (default 11.5%); `language` drives the EN/ES PDF/print template.
-- ============================================================

-- ── Clients ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  billing_email      VARCHAR(255),
  billing_address    TEXT,
  city               VARCHAR(100),
  state              VARCHAR(100),
  zip                VARCHAR(20),
  phone              VARCHAR(50),
  payment_terms_days INT NOT NULL DEFAULT 30,
  tax_exempt         BOOLEAN NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_business ON clients(business_id);

-- ── Invoices (header) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id),
  invoice_number    VARCHAR(50) NOT NULL,
  issue_date        DATE NOT NULL,
  due_date          DATE NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  -- Revenue account credited when the invoice is sent (defaults to Sales Revenue).
  income_account_id UUID REFERENCES chart_of_accounts(id),
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_type          VARCHAR(20) NOT NULL DEFAULT 'generic'
                      CHECK (tax_type IN ('generic', 'ivu')),
  tax_rate          NUMERIC(6,3) NOT NULL DEFAULT 0,   -- percent, e.g. 11.500
  tax_total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  language          CHAR(2) NOT NULL DEFAULT 'en',
  notes             TEXT,
  paid_at           DATE,
  paid_account_id   UUID REFERENCES accounts(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- ── Invoice line items ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_order  INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_line_items(invoice_id);
