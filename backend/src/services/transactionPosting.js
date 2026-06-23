/**
 * services/transactionPosting.js
 *
 * The shared "turn a transaction into ledger truth" logic, extracted from
 * routes/transactions.js so other features can materialize a real transaction
 * the exact same way the manual create path does.
 *
 * Currently used by:
 *   - routes/transactions.js   (manual create)
 *   - routes/recurring.js      (#7 — generating a due recurring template)
 *
 * Everything here runs INSIDE the caller's open transaction (it takes a pg
 * client), and all posting goes through services/ledger.js — never raw amounts.
 */

import {
  postJournalEntry,
  round2,
} from "./ledger.js";

// COA liability account (seeded by name_key) that the §1062.03 service
// withholding is credited to — the 10% held back is owed to Hacienda.
export const WITHHOLDING_PAYABLE_KEY = "coa.accounts.services_withholding_payable";

// Resolve a seeded system COA account id by its i18n name_key.
export async function getSystemAccountId(client, businessId, nameKey) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts
     WHERE business_id = $1 AND name_key = $2 AND is_active = TRUE
     LIMIT 1`,
    [businessId, nameKey],
  );
  return r.rows[0]?.id || null;
}

// Resolve a transaction's funding source to the COA account it posts against.
// The source is EITHER an operational account (accounts.id) OR an
// asset/liability ledger account (chart_of_accounts.id) — never both.
//
// Returns { error } or:
//   { accountId, fundingCoaId } where
//     - accountId is the operational account id (null when funded from a
//       pure ledger account) — this is what the transactions.account_id
//       header column stores.
//     - fundingCoaId is the chart_of_accounts id the journal entry posts
//       the funding line against (always set).
export async function resolveFundingSource(
  client,
  businessId,
  { accountId, fundingCoaId },
) {
  if (accountId && fundingCoaId) {
    return { error: "Provide either accountId or fundingCoaId, not both" };
  }

  if (accountId) {
    const result = await client.query(
      `SELECT id, name, coa_account_id FROM accounts
       WHERE id = $1 AND business_id = $2`,
      [accountId, businessId],
    );
    if (result.rows.length === 0) return { error: "Account not found" };
    const acct = result.rows[0];
    if (!acct.coa_account_id) {
      return {
        error:
          "This account has no ledger account linked (coa_account_id is null). " +
          "Recreate the account via the accounts route to backfill it.",
      };
    }
    return { accountId: acct.id, fundingCoaId: acct.coa_account_id };
  }

  if (fundingCoaId) {
    const result = await client.query(
      `SELECT id, account_type, is_active FROM chart_of_accounts
       WHERE id = $1 AND business_id = $2`,
      [fundingCoaId, businessId],
    );
    if (result.rows.length === 0) return { error: "Ledger account not found" };
    const coa = result.rows[0];
    if (!coa.is_active) return { error: "Ledger account is inactive" };
    if (!["asset", "liability"].includes(coa.account_type)) {
      return {
        error:
          "The funding account must be an asset or liability ledger account",
      };
    }
    return { accountId: null, fundingCoaId: coa.id };
  }

  return { error: "A funding accountId or fundingCoaId is required" };
}

// Validate the category/split accounts: they must be chart_of_accounts rows
// of this business, of the expected type (revenue for income, expense for
// expense). Returns { error } or { ok: true }.
export async function validateCategoryAccounts(client, businessId, ids, txType) {
  const expectedType = txType === "income" ? "revenue" : "expense";
  const uniqueIds = [...new Set(ids)];
  const result = await client.query(
    `SELECT id, account_type FROM chart_of_accounts
     WHERE id = ANY($1::uuid[]) AND business_id = $2 AND is_active = TRUE`,
    [uniqueIds, businessId],
  );
  if (result.rows.length !== uniqueIds.length) {
    return { error: "One or more category accounts were not found" };
  }
  const wrong = result.rows.find((r) => r.account_type !== expectedType);
  if (wrong) {
    return {
      error: `A ${txType} transaction must use ${expectedType} accounts (account ${wrong.id} is ${wrong.account_type})`,
    };
  }
  return { ok: true };
}

// Build balanced journal lines for a transaction.
//   allocations: [{ accountId, amount, memo? }] summing to total
//
// §1062.03 service withholding (expense only): when withholdingAmount > 0 the
// gross expense is still debited in full, the funding account is credited NET
// (total − withholding), and the withheld amount is credited to the Services
// Withholding Payable liability. Debits = total; credits = (total − wh) + wh.
export function buildLines({
  txType,
  total,
  fundingCoaId,
  allocations,
  withholdingAmount = 0,
  withholdingAccountId = null,
}) {
  const lines = [];
  if (txType === "expense") {
    allocations.forEach((a) =>
      lines.push({ accountId: a.accountId, debit: a.amount, memo: a.memo }),
    );
    const wh = round2(withholdingAmount || 0);
    if (wh > 0 && withholdingAccountId) {
      lines.push({ accountId: fundingCoaId, credit: round2(total - wh) });
      lines.push({
        accountId: withholdingAccountId,
        credit: wh,
        memo: "§1062.03 withholding",
      });
    } else {
      lines.push({ accountId: fundingCoaId, credit: total });
    }
  } else {
    lines.push({ accountId: fundingCoaId, debit: total });
    allocations.forEach((a) =>
      lines.push({ accountId: a.accountId, credit: a.amount, memo: a.memo }),
    );
  }
  return lines;
}

/**
 * Insert a transaction header AND post its balanced journal entry, inside the
 * caller's open DB transaction. This is the single create path so a manually
 * entered transaction and a generated recurring one are byte-for-byte the same.
 *
 * Caller is responsible for validating that the allocation amounts sum to
 * totalAmount before calling.
 *
 * @param {import('pg').PoolClient} client
 * @param {Object} input
 * @returns {Promise<{transaction: Object} | {error: string}>}
 */
export async function createLedgerTransaction(client, input) {
  const {
    businessId,
    userId,
    date,
    merchant = null,
    totalAmount,
    type,
    notes = null,
    accountId = null,
    fundingCoaId = null,
    allocations,
    recurringId = null,
    receiptId = null,
    vendorId = null,
    originalCurrency = null,
    originalAmount = null,
    exchangeRate = null,
    withholdingAmount = 0,
    projectId = null,
  } = input;

  const funding = await resolveFundingSource(client, businessId, {
    accountId,
    fundingCoaId,
  });
  if (funding.error) return { error: funding.error };

  const catCheck = await validateCategoryAccounts(
    client,
    businessId,
    allocations.map((a) => a.accountId),
    type,
  );
  if (catCheck.error) return { error: catCheck.error };

  // §1062.03 service withholding only applies to expense payments. Resolve the
  // payable account up front so a missing seed fails clearly, not mid-posting.
  const wh = type === "expense" ? round2(withholdingAmount || 0) : 0;
  let withholdingAccountId = null;
  if (wh > 0) {
    if (wh >= parseFloat(totalAmount)) {
      return { error: "withholdingAmount must be less than the total amount" };
    }
    withholdingAccountId = await getSystemAccountId(
      client,
      businessId,
      WITHHOLDING_PAYABLE_KEY,
    );
    if (!withholdingAccountId) {
      return {
        error:
          "Missing the Services Withholding Payable ledger account. Run migration 015 to seed it.",
      };
    }
  }

  const isSplit = allocations.length > 1;
  // Exactly one of these is set (enforced by transactions_funding_source_chk).
  const headerAccountId = funding.accountId;
  const headerFundingCoaId = funding.accountId ? null : funding.fundingCoaId;

  const txResult = await client.query(
    `INSERT INTO transactions
       (business_id, account_id, funding_coa_id, created_by, date, merchant, total_amount, type, is_split, receipt_id, notes,
        vendor_id, original_currency, original_amount, exchange_rate, recurring_id, withholding_amount, project_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      businessId,
      headerAccountId,
      headerFundingCoaId,
      userId,
      date,
      merchant || null,
      totalAmount,
      type,
      isSplit,
      receiptId || null,
      notes || null,
      vendorId || null,
      originalCurrency || null,
      originalAmount != null ? originalAmount : null,
      exchangeRate || 1,
      recurringId || null,
      wh,
      projectId || null,
    ],
  );
  const transaction = txResult.rows[0];

  const lines = buildLines({
    txType: type,
    total: parseFloat(totalAmount),
    fundingCoaId: funding.fundingCoaId,
    allocations,
    withholdingAmount: wh,
    withholdingAccountId,
  });
  await postJournalEntry(client, {
    businessId,
    date,
    description: merchant || (type === "income" ? "Income" : "Expense"),
    sourceType: "transaction",
    sourceId: transaction.id,
    createdBy: userId,
    lines,
  });

  return { transaction };
}
