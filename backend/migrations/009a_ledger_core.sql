-- 009a — LEDGER CORE: the double-entry schema, captured from the live DB
-- Run with: node scripts/migrate.mjs   (or psql $DATABASE_URL -f this file)
--
-- HISTORY NOTE: chart_of_accounts, journal_entries, journal_entry_lines and
-- the account_ledger_balances view were created by hand in the dev database
-- during the original ledger build and never committed as a migration —
-- meaning no fresh database could ever be constructed (PENDIENTES §4.1,
-- "crítico"). This file is the verbatim capture (pg_dump 2026-08-23) of
-- those objects, numbered 009a so it sorts after 009 and before 010 — the
-- first migration that references these tables.
--
-- Existing databases NEVER run this file: the migration runner's baseline
-- marks it applied. It executes only on fresh builds.

BEGIN;

-- The balanced-entry proof: a deferred constraint trigger re-checks every
-- journal entry's debits = credits at COMMIT, no matter who wrote the rows.
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_entry  UUID;
  v_debit  NUMERIC(14,2);
  v_credit NUMERIC(14,2);
  v_exists BOOLEAN;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  -- If the parent entry was deleted (lines cascade), there's nothing to check.
  SELECT EXISTS(SELECT 1 FROM journal_entries WHERE id = v_entry) INTO v_exists;
  IF NOT v_exists THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = v_entry;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits=%, credits=%',
      v_entry, v_debit, v_credit;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    business_id uuid NOT NULL,
    code character varying(10),
    name_key text,
    name text,
    account_type character varying(10) NOT NULL,
    normal_balance character varying(6) NOT NULL,
    color character(7) DEFAULT '#888888' NOT NULL,
    parent_id uuid,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chart_of_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT chart_of_accounts_account_type_check
      CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    CONSTRAINT chart_of_accounts_check CHECK (name_key IS NOT NULL OR name IS NOT NULL),
    CONSTRAINT chart_of_accounts_check1 CHECK (
      (account_type IN ('asset', 'expense') AND normal_balance = 'debit')
      OR (account_type IN ('liability', 'equity', 'revenue') AND normal_balance = 'credit')
    ),
    CONSTRAINT chart_of_accounts_normal_balance_check
      CHECK (normal_balance IN ('debit', 'credit')),
    CONSTRAINT chart_of_accounts_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    CONSTRAINT chart_of_accounts_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_business_code
  ON chart_of_accounts (business_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coa_business_type
  ON chart_of_accounts (business_id, account_type, is_active);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts (parent_id);

CREATE TABLE IF NOT EXISTS journal_entries (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    business_id uuid NOT NULL,
    entry_date date NOT NULL,
    description text,
    source_type character varying(30) DEFAULT 'manual' NOT NULL,
    source_id uuid,
    reverses_entry_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journal_entries_pkey PRIMARY KEY (id),
    CONSTRAINT journal_entries_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    CONSTRAINT journal_entries_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT journal_entries_reverses_entry_id_fkey
      FOREIGN KEY (reverses_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_je_business_date
  ON journal_entries (business_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_je_source ON journal_entries (source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    journal_entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    memo text,
    line_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id),
    CONSTRAINT journal_entry_lines_check CHECK (debit = 0 OR credit = 0),
    CONSTRAINT journal_entry_lines_check1 CHECK (debit > 0 OR credit > 0),
    CONSTRAINT journal_entry_lines_credit_check CHECK (credit >= 0),
    CONSTRAINT journal_entry_lines_debit_check CHECK (debit >= 0),
    CONSTRAINT journal_entry_lines_journal_entry_id_fkey
      FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    CONSTRAINT journal_entry_lines_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines (journal_entry_id);

DROP TRIGGER IF EXISTS trg_je_balanced ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_je_balanced
  AFTER INSERT OR DELETE OR UPDATE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- Hand-made in the same ledger era: every operational account carries a
-- link to its chart-of-accounts twin (surfaced by the fresh-build proof —
-- the schema diff against dev found exactly this one missing column).
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS coa_account_id uuid;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_coa_account_id_fkey;
ALTER TABLE accounts ADD CONSTRAINT accounts_coa_account_id_fkey
  FOREIGN KEY (coa_account_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE VIEW account_ledger_balances AS
 SELECT coa.id AS account_id,
    coa.business_id,
    coa.account_type,
    coa.normal_balance,
    COALESCE(sum(jel.debit), 0) AS debit_total,
    COALESCE(sum(jel.credit), 0) AS credit_total,
    COALESCE(sum(jel.debit), 0) - COALESCE(sum(jel.credit), 0) AS net_debit,
    CASE
      WHEN coa.normal_balance = 'debit'
        THEN COALESCE(sum(jel.debit), 0) - COALESCE(sum(jel.credit), 0)
      ELSE COALESCE(sum(jel.credit), 0) - COALESCE(sum(jel.debit), 0)
    END AS natural_balance
   FROM chart_of_accounts coa
     LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
  GROUP BY coa.id, coa.business_id, coa.account_type, coa.normal_balance;

COMMIT;
