-- 019_coa_palette.sql
-- Roadmap v2 · Phase 1.3: recolor SYSTEM chart-of-accounts rows to the
-- "Ink & plum" identity, matching the updated seed template in
-- backend/src/services/coaSeed.js. User-created accounts (is_system = FALSE)
-- keep whatever color the user chose.

BEGIN;

UPDATE chart_of_accounts SET color = c.new_color
FROM (VALUES
  ('coa.accounts.cash',                          '#2E8570'),
  ('coa.accounts.accounts_receivable',           '#4C8F8A'),
  ('coa.accounts.inventory_asset',               '#7FA982'),
  ('coa.accounts.other_current_asset',           '#98B99F'),
  ('coa.accounts.accounts_payable',              '#C24E24'),
  ('coa.accounts.credit_card_payable',           '#A6543F'),
  ('coa.accounts.sales_tax_payable',             '#C86A2E'),
  ('coa.accounts.payroll_liabilities',           '#B0603A'),
  ('coa.accounts.services_withholding_payable',  '#8A4A2A'),
  ('coa.accounts.owner_equity',                  '#5B3A9B'),
  ('coa.accounts.retained_earnings',             '#7D63C4'),
  ('coa.accounts.sales_revenue',                 '#1E7A5B'),
  ('coa.accounts.consulting_revenue',            '#4C8F8A'),
  ('coa.accounts.other_income',                  '#7FA982'),
  ('coa.accounts.payroll_expense',               '#2F6BC6'),
  ('coa.accounts.rent',                          '#C24E24'),
  ('coa.accounts.utilities',                     '#7D63C4'),
  ('coa.accounts.supplies',                      '#B88A1F'),
  ('coa.accounts.marketing',                     '#9C2F6F'),
  ('coa.accounts.cogs',                          '#A6543F'),
  ('coa.accounts.other_expense',                 '#6B6880')
) AS c(name_key, new_color)
WHERE chart_of_accounts.name_key = c.name_key
  AND chart_of_accounts.is_system = TRUE;

COMMIT;
