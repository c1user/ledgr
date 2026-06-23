-- ============================================================
--  012 — Repoint "category" references from the legacy `categories`
--        table to `chart_of_accounts` (revenue/expense accounts).
--  Run with: psql $DATABASE_URL -f migrations/012_categories_to_coa.sql
--
--  Path B made the double-entry ledger the source of truth: a transaction's
--  category is a chart_of_accounts revenue/expense account, posted as a journal
--  line. But Budget, Rules, and Inventory still pointed at the legacy
--  `categories` table, so they were disconnected from the ledger:
--    • budgets — actuals read transactions.category_id / transaction_splits,
--      which Path B no longer populates → budget-vs-actual was always 0
--    • categorization_rules — assigned a categories.id that can't post as a
--      COA account (and the engine wasn't even wired into POST /transactions)
--    • products — category tag pointed at the frozen legacy table
--
--  This repoints those FKs at chart_of_accounts(id). The dev DB had 0 budgets,
--  0 rules, and 0 categorized products, so there is no data to migrate; the
--  guard statements below keep it safe on any DB by clearing/ nulling rows that
--  don't map to a chart_of_accounts id before the new FK is added.
--
--  NOT dropped here (still referenced by inert legacy columns —
--  transactions.category_id, transaction_splits): the `categories` table and
--  the /api/categories route. After this migration no app feature reads them;
--  retire them in a later pass once those columns are removed.
-- ============================================================

-- ── budgets.category_id → chart_of_accounts ──────────────────
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_category_id_fkey;
DELETE FROM budgets
  WHERE category_id NOT IN (SELECT id FROM chart_of_accounts);
ALTER TABLE budgets ADD CONSTRAINT budgets_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES chart_of_accounts(id) ON DELETE CASCADE;

-- ── categorization_rules.category_id → chart_of_accounts ─────
ALTER TABLE categorization_rules
  DROP CONSTRAINT IF EXISTS categorization_rules_category_id_fkey;
DELETE FROM categorization_rules
  WHERE category_id NOT IN (SELECT id FROM chart_of_accounts);
ALTER TABLE categorization_rules ADD CONSTRAINT categorization_rules_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;

-- ── products.category_id → chart_of_accounts (keep products) ─
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_id_fkey;
UPDATE products SET category_id = NULL
  WHERE category_id IS NOT NULL
    AND category_id NOT IN (SELECT id FROM chart_of_accounts);
ALTER TABLE products ADD CONSTRAINT products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
