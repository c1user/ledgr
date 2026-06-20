/**
 * services/coaSeed.js
 *
 * Item 1 (Chart of accounts) — seeding.
 *
 * Seeds a standard small-business chart of accounts for a new business,
 * and creates the ledger identity (a COA asset/liability account) for a
 * bank/cash/credit/loan account.
 *
 * i18n: system accounts store a `name_key` (e.g. 'coa.accounts.cash'),
 * NOT an English string. The frontend resolves the key with i18next.
 * This is the fix for the "seeded categories stay English" debt — the
 * old seed wrote hardcoded English names; this one never does.
 *
 * Add the corresponding keys to en.json and es.json — see INTEGRATION.md.
 */

// ── Standard chart of accounts template ──────────────────────
// Colors are carried over from the old default categories so existing
// UI styling stays consistent. account_type drives normal_balance
// (enforced by a CHECK constraint in the migration), so we don't store
// normal_balance here — it's derived in the INSERT.
const NORMAL_BALANCE = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
};

// code, name_key, type, color
const COA_TEMPLATE = [
  // ── Assets (1000s) ──
  { code: "1000", key: "coa.accounts.cash", type: "asset", color: "#00C896" },
  {
    code: "1100",
    key: "coa.accounts.accounts_receivable",
    type: "asset",
    color: "#5DCAA5",
  },
  {
    code: "1200",
    key: "coa.accounts.inventory_asset",
    type: "asset",
    color: "#9FE1CB",
  },
  {
    code: "1900",
    key: "coa.accounts.other_current_asset",
    type: "asset",
    color: "#7FD4B8",
  },

  // ── Liabilities (2000s) ──
  {
    code: "2000",
    key: "coa.accounts.accounts_payable",
    type: "liability",
    color: "#E24B4A",
  },
  {
    code: "2100",
    key: "coa.accounts.credit_card_payable",
    type: "liability",
    color: "#E86A69",
  },
  {
    code: "2200",
    key: "coa.accounts.sales_tax_payable",
    type: "liability",
    color: "#F0997B",
  }, // IVU (PR)
  {
    code: "2300",
    key: "coa.accounts.payroll_liabilities",
    type: "liability",
    color: "#D85A30",
  },

  // ── Equity (3000s) ──
  {
    code: "3000",
    key: "coa.accounts.owner_equity",
    type: "equity",
    color: "#534AB7",
  },
  {
    code: "3900",
    key: "coa.accounts.retained_earnings",
    type: "equity",
    color: "#7F77DD",
  },

  // ── Revenue (4000s) ──
  {
    code: "4000",
    key: "coa.accounts.sales_revenue",
    type: "revenue",
    color: "#1D9E75",
  },
  {
    code: "4100",
    key: "coa.accounts.consulting_revenue",
    type: "revenue",
    color: "#5DCAA5",
  },
  {
    code: "4900",
    key: "coa.accounts.other_income",
    type: "revenue",
    color: "#9FE1CB",
  },

  // ── Expenses (5000s) ──
  {
    code: "5000",
    key: "coa.accounts.payroll_expense",
    type: "expense",
    color: "#4F8EF7",
  },
  { code: "5100", key: "coa.accounts.rent", type: "expense", color: "#F7934C" },
  {
    code: "5200",
    key: "coa.accounts.utilities",
    type: "expense",
    color: "#A259FF",
  },
  {
    code: "5300",
    key: "coa.accounts.supplies",
    type: "expense",
    color: "#F7C948",
  },
  {
    code: "5400",
    key: "coa.accounts.marketing",
    type: "expense",
    color: "#E24B4A",
  },
  { code: "5500", key: "coa.accounts.cogs", type: "expense", color: "#D85A30" },
  {
    code: "5900",
    key: "coa.accounts.other_expense",
    type: "expense",
    color: "#888780",
  },
];

/**
 * Seed the full standard chart of accounts for a business.
 * Call inside the registration transaction, passing the same client.
 *
 * @param {import('pg').PoolClient} client - an active client inside a transaction
 * @param {string} businessId
 * @returns {Promise<Object>} map of code -> account id (handy for callers)
 */
export async function seedChartOfAccounts(client, businessId) {
  const codeToId = {};

  for (const acct of COA_TEMPLATE) {
    const result = await client.query(
      `INSERT INTO chart_of_accounts
         (business_id, code, name_key, account_type, normal_balance, color, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id`,
      [
        businessId,
        acct.code,
        acct.key,
        acct.type,
        NORMAL_BALANCE[acct.type],
        acct.color,
      ],
    );
    codeToId[acct.code] = result.rows[0].id;
  }

  return codeToId;
}

/**
 * Map an operational bank account (accounts table) to a ledger account.
 * Bank/cash become assets; credit cards/loans become liabilities.
 * Creates the COA account and links it via accounts.coa_account_id.
 *
 * Call this whenever an `accounts` row is created (see accounts.js patch
 * in INTEGRATION.md), passing the active client.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} businessId
 * @param {{id: string, name: string, type: string}} account
 *        type is one of: savings | current | cash (assets),
 *        credit | loan (liabilities)
 * @returns {Promise<string>} the new COA account id
 */
// Canonical operational account types. MUST stay in sync with the
// accounts.type CHECK constraint (see migrations/009_fix_account_type_constraint.sql).
export const ACCOUNT_TYPES = ["savings", "current", "credit", "cash", "loan"];
// The asset-side subset (debit-normal); the remainder (credit, loan) are liabilities.
export const ASSET_ACCOUNT_TYPES = ["savings", "current", "cash"];

export async function createAccountCoa(client, businessId, account) {
  const isAsset = ASSET_ACCOUNT_TYPES.includes(account.type);
  const accountType = isAsset ? "asset" : "liability";

  const coaResult = await client.query(
    `INSERT INTO chart_of_accounts
       (business_id, name, account_type, normal_balance, is_system)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING id`,
    [businessId, account.name, accountType, NORMAL_BALANCE[accountType]],
  );
  const coaId = coaResult.rows[0].id;

  await client.query(`UPDATE accounts SET coa_account_id = $1 WHERE id = $2`, [
    coaId,
    account.id,
  ]);

  return coaId;
}

export { COA_TEMPLATE, NORMAL_BALANCE };
