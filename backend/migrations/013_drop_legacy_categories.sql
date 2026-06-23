-- ============================================================
--  013 — Retire the legacy category model
--  Run with: psql $DATABASE_URL -f migrations/013_drop_legacy_categories.sql
--
--  By now everything reads the double-entry ledger: a transaction's category
--  is a chart_of_accounts revenue/expense account recorded as a journal line.
--  Migrations 012 repointed budgets/rules/products to chart_of_accounts, and
--  reports.js / ai.js / accounts.js were rewritten to aggregate journal lines.
--  Nothing in the app reads the legacy `categories` table, `transaction_splits`,
--  or `transactions.category_id` anymore (registration seeds chart_of_accounts,
--  not categories). This drops them.
--
--  Order matters: remove inbound references before the tables they point at.
--  All guarded with IF EXISTS so this is safe to re-run / run on a fresh DB.
-- ============================================================

-- transaction_splits referenced both categories and transactions — drop it
-- first (takes its FKs with it). It was the old split-transaction model;
-- splits now live as multiple journal_entry_lines on one journal entry.
DROP TABLE IF EXISTS transaction_splits;

-- The header's old single-category pointer — abandoned under double-entry.
ALTER TABLE transactions DROP COLUMN IF EXISTS category_id;

-- Finally the table itself (its self-referential parent_id FK drops with it).
DROP TABLE IF EXISTS categories;
