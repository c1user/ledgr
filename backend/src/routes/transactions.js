/**
 * routes/transactions.js  (LEDGER-BACKED — Path B)
 *
 * The transaction row is the source document; its balanced journal entry
 * is the accounting truth. Every create/update/delete posts or removes
 * journal lines through services/ledger.js. account balances, P&L, and the
 * balance sheet all derive from those lines — this route never mutates
 * accounts.current_balance anymore.
 *
 * IMPORTANT API CHANGE: a transaction's "category" now references a
 * chart_of_accounts account (a revenue account for income, an expense
 * account for expense), NOT the old categories table. The request field
 * is still called `categoryId` / `splits[].categoryId` to minimize frontend
 * churn, but it must be a chart_of_accounts.id. Point the category dropdown
 * in Transactions.jsx at GET /api/chart-of-accounts (revenue/expense rows).
 *
 * Double-entry postings:
 *   EXPENSE (paid from funding account F, into expense account E):
 *     debit  E   (each split, or the single category)   = amount
 *     credit F's COA account                            = total
 *   INCOME (received into funding account F, from revenue account R):
 *     debit  F's COA account                            = total
 *     credit R   (each split, or the single category)   = amount
 *   The funding side is always one consolidated line; the income/expense
 *   side may be several (splits). Either way debits == credits.
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  postJournalEntry,
  deleteEntriesForSource,
} from "../services/ledger.js";

const router = express.Router();
router.use(requireAuth);

// ── Helpers ──────────────────────────────────────────────────

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
async function resolveFundingSource(
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
// expense). Returns { error } or { accounts: Map(id -> row) }.
async function validateCategoryAccounts(client, businessId, ids, txType) {
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
function buildLines({ txType, total, fundingCoaId, allocations }) {
  // allocations: [{ accountId, amount }] summing to total
  const lines = [];
  if (txType === "expense") {
    allocations.forEach((a) =>
      lines.push({ accountId: a.accountId, debit: a.amount, memo: a.memo }),
    );
    lines.push({ accountId: fundingCoaId, credit: total });
  } else {
    lines.push({ accountId: fundingCoaId, debit: total });
    allocations.forEach((a) =>
      lines.push({ accountId: a.accountId, credit: a.amount, memo: a.memo }),
    );
  }
  return lines;
}

// Normalize the request body into allocations (single category -> one allocation).
function readAllocations(body) {
  const { categoryId, splits } = body;
  if (Array.isArray(splits) && splits.length > 0) {
    return splits.map((s) => ({
      accountId: s.categoryId,
      amount: parseFloat(s.amount),
      memo: s.notes || null,
    }));
  }
  if (categoryId) {
    return [
      {
        accountId: categoryId,
        amount: parseFloat(body.totalAmount),
        memo: null,
      },
    ];
  }
  return [];
}

// ── GET /api/transactions ────────────────────────────────────
// List with filters. `splits` is derived from the ledger (the revenue/
// expense lines of each transaction's journal entry).
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const {
    startDate,
    endDate,
    type,
    accountId,
    categoryId,
    limit = 50,
    offset = 0,
  } = req.query;

  try {
    const params = [businessId];
    let p = 1;
    let where = "WHERE t.business_id = $1";

    if (startDate) {
      where += ` AND t.date >= $${++p}`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND t.date <= $${++p}`;
      params.push(endDate);
    }
    if (type) {
      where += ` AND t.type = $${++p}`;
      params.push(type);
    }
    if (accountId) {
      where += ` AND t.account_id = $${++p}`;
      params.push(accountId);
    }
    if (categoryId) {
      where += ` AND EXISTS (
        SELECT 1 FROM journal_entries je2
        JOIN journal_entry_lines jl2 ON jl2.journal_entry_id = je2.id
        WHERE je2.source_type = 'transaction' AND je2.source_id = t.id
          AND jl2.account_id = $${++p})`;
      params.push(categoryId);
    }

    const limitIdx = ++p;
    params.push(limit);
    const offsetIdx = ++p;
    params.push(offset);

    const query = `
      SELECT
        t.id, t.date, t.merchant, t.total_amount, t.type, t.is_split, t.notes,
        t.plaid_tx_id, t.created_at, t.account_id, t.funding_coa_id,
        t.vendor_id, t.original_currency, t.original_amount, t.exchange_rate,
        COALESCE(a.name, fcoa.name) AS account_name,
        fcoa.name_key AS account_name_key,
        u.name AS created_by_name,
        v.name AS vendor_name,
        r.id AS receipt_id, r.status AS receipt_status,
        COALESCE(
          json_agg(
            json_build_object(
              'id', jel.id,
              'amount', (jel.debit + jel.credit),
              'account_id', jel.account_id,
              'name_key', coa.name_key,
              'name', coa.name,
              'color', coa.color
            )
          ) FILTER (WHERE coa.id IS NOT NULL),
          '[]'
        ) AS splits
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN chart_of_accounts fcoa ON fcoa.id = t.funding_coa_id
      LEFT JOIN users u ON u.id = t.created_by
      LEFT JOIN receipts r ON r.id = t.receipt_id
      LEFT JOIN vendors v ON v.id = t.vendor_id
      LEFT JOIN journal_entries je
        ON je.source_type = 'transaction' AND je.source_id = t.id
      LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      LEFT JOIN chart_of_accounts coa
        ON coa.id = jel.account_id AND coa.account_type IN ('revenue','expense')
      ${where}
      GROUP BY t.id, a.name, fcoa.name, fcoa.name_key, u.name, v.name, r.id, r.status
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM transactions t WHERE t.business_id = $1",
      [businessId],
    );

    return res.json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    console.error("Get transactions error:", err);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ── GET /api/transactions/:id ────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         t.*, COALESCE(a.name, fcoa.name) AS account_name,
         fcoa.name_key AS account_name_key,
         u.name AS created_by_name,
         r.s3_key AS receipt_s3_key, r.status AS receipt_status,
         COALESCE(
           json_agg(
             json_build_object(
               'id', jel.id,
               'amount', (jel.debit + jel.credit),
               'account_id', jel.account_id,
               'name_key', coa.name_key,
               'name', coa.name,
               'color', coa.color,
               'account_type', coa.account_type,
               'notes', jel.memo
             )
           ) FILTER (WHERE coa.id IS NOT NULL),
           '[]'
         ) AS splits
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN chart_of_accounts fcoa ON fcoa.id = t.funding_coa_id
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN receipts r ON r.id = t.receipt_id
       LEFT JOIN journal_entries je
         ON je.source_type = 'transaction' AND je.source_id = t.id
       LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       LEFT JOIN chart_of_accounts coa
         ON coa.id = jel.account_id AND coa.account_type IN ('revenue','expense')
       WHERE t.id = $1 AND t.business_id = $2
       GROUP BY t.id, a.name, fcoa.name, fcoa.name_key, u.name, r.s3_key, r.status`,
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get transaction error:", err);
    return res.status(500).json({ error: "Failed to fetch transaction" });
  }
});

// ── POST /api/transactions ───────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId, userId } = req.user;
  const {
    accountId,
    fundingCoaId,
    date,
    merchant,
    totalAmount,
    type,
    notes,
    receiptId,
    vendorId,
    originalCurrency,
    originalAmount,
    exchangeRate,
  } = req.body;

  if ((!accountId && !fundingCoaId) || !date || !totalAmount || !type) {
    return res.status(400).json({
      error:
        "A funding source (accountId or fundingCoaId), date, totalAmount and type are required",
    });
  }
  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "type must be income or expense" });
  }
  if (parseFloat(totalAmount) <= 0) {
    return res
      .status(400)
      .json({ error: "totalAmount must be greater than 0" });
  }

  const allocations = readAllocations(req.body);
  if (allocations.length === 0) {
    return res
      .status(400)
      .json({ error: "A categoryId or splits[] is required" });
  }
  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - parseFloat(totalAmount)) > 0.01) {
    return res.status(400).json({
      error: `Split amounts ($${allocSum.toFixed(2)}) must equal total amount ($${parseFloat(totalAmount).toFixed(2)})`,
    });
  }
  for (const a of allocations) {
    if (!a.accountId || !(a.amount > 0)) {
      return res
        .status(400)
        .json({
          error:
            "Each split needs a categoryId (account) and a positive amount",
        });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const funding = await resolveFundingSource(client, businessId, {
      accountId,
      fundingCoaId,
    });
    if (funding.error) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: funding.error });
    }

    const catCheck = await validateCategoryAccounts(
      client,
      businessId,
      allocations.map((a) => a.accountId),
      type,
    );
    if (catCheck.error) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: catCheck.error });
    }

    const isSplit = allocations.length > 1;
    // Exactly one of these is set (enforced by transactions_funding_source_chk).
    const headerAccountId = funding.accountId;
    const headerFundingCoaId = funding.accountId ? null : funding.fundingCoaId;

    // Insert the transaction header (denormalized source document).
    const txResult = await client.query(
      `INSERT INTO transactions
         (business_id, account_id, funding_coa_id, created_by, date, merchant, total_amount, type, is_split, receipt_id, notes,
          vendor_id, original_currency, original_amount, exchange_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
      ],
    );
    const transaction = txResult.rows[0];

    // Post the balanced journal entry.
    const lines = buildLines({
      txType: type,
      total: parseFloat(totalAmount),
      fundingCoaId: funding.fundingCoaId,
      allocations,
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

    await client.query("COMMIT");
    return res.status(201).json(transaction);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create transaction error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to create transaction" });
  } finally {
    client.release();
  }
});

// ── PUT /api/transactions/:id ────────────────────────────────
// Re-post: remove the old journal entry, update the header, post a new entry.
router.put("/:id", async (req, res) => {
  const { businessId, userId } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT * FROM transactions WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }
    const oldTx = existing.rows[0];

    // Merge new values over old.
    const date = req.body.date || oldTx.date;
    const merchant = req.body.merchant ?? oldTx.merchant;
    const totalAmount =
      req.body.totalAmount != null
        ? parseFloat(req.body.totalAmount)
        : Number(oldTx.total_amount);
    const type = req.body.type || oldTx.type;
    const notes = req.body.notes ?? oldTx.notes;
    // Funding source: take whichever the body provides, else keep the old one.
    const fundingInput = req.body.accountId
      ? { accountId: req.body.accountId }
      : req.body.fundingCoaId
        ? { fundingCoaId: req.body.fundingCoaId }
        : oldTx.account_id
          ? { accountId: oldTx.account_id }
          : { fundingCoaId: oldTx.funding_coa_id };
    const vendorId =
      req.body.vendorId !== undefined ? req.body.vendorId : oldTx.vendor_id;
    const originalCurrency =
      req.body.originalCurrency !== undefined
        ? req.body.originalCurrency
        : oldTx.original_currency;
    const originalAmount =
      req.body.originalAmount !== undefined
        ? req.body.originalAmount
        : oldTx.original_amount;
    const exchangeRate =
      req.body.exchangeRate !== undefined
        ? req.body.exchangeRate
        : oldTx.exchange_rate;

    if (!["income", "expense"].includes(type)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "type must be income or expense" });
    }
    if (totalAmount <= 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "totalAmount must be greater than 0" });
    }

    // Allocations: if the body provides them, use them; else recover the
    // category allocation(s) from the existing journal entry (the ledger is
    // the source of truth, not a header column).
    let allocations = readAllocations({ ...req.body, totalAmount });
    if (allocations.length === 0) {
      const existingLines = await client.query(
        `SELECT jel.account_id, (jel.debit + jel.credit) AS amount
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
         WHERE je.source_type = 'transaction' AND je.source_id = $1
           AND coa.account_type IN ('revenue','expense')`,
        [id],
      );
      if (existingLines.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({
            error:
              "A categoryId or splits[] is required to re-post this transaction",
          });
      }
      if (existingLines.rows.length === 1) {
        // single category: rescale to the (possibly new) total
        allocations = [
          {
            accountId: existingLines.rows[0].account_id,
            amount: totalAmount,
            memo: null,
          },
        ];
      } else {
        allocations = existingLines.rows.map((r) => ({
          accountId: r.account_id,
          amount: Number(r.amount),
          memo: null,
        }));
      }
    }
    const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
    if (Math.abs(allocSum - totalAmount) > 0.01) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Split amounts ($${allocSum.toFixed(2)}) must equal total amount ($${totalAmount.toFixed(2)})`,
      });
    }

    const funding = await resolveFundingSource(client, businessId, fundingInput);
    if (funding.error) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: funding.error });
    }
    const catCheck = await validateCategoryAccounts(
      client,
      businessId,
      allocations.map((a) => a.accountId),
      type,
    );
    if (catCheck.error) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: catCheck.error });
    }

    const isSplit = allocations.length > 1;
    // Exactly one of these is set (enforced by transactions_funding_source_chk).
    const headerAccountId = funding.accountId;
    const headerFundingCoaId = funding.accountId ? null : funding.fundingCoaId;

    // Remove the old ledger entry, update the header.
    await deleteEntriesForSource(client, businessId, "transaction", id);

    const updated = await client.query(
      `UPDATE transactions SET
         date = $1, merchant = $2, total_amount = $3, type = $4,
         notes = $5, account_id = $6, funding_coa_id = $7, is_split = $8,
         vendor_id = $9, original_currency = $10, original_amount = $11, exchange_rate = $12
       WHERE id = $13 AND business_id = $14
       RETURNING *`,
      [
        date,
        merchant,
        totalAmount,
        type,
        notes,
        headerAccountId,
        headerFundingCoaId,
        isSplit,
        vendorId || null,
        originalCurrency || null,
        originalAmount != null ? originalAmount : null,
        exchangeRate || 1,
        id,
        businessId,
      ],
    );

    // Re-post.
    const lines = buildLines({
      txType: type,
      total: totalAmount,
      fundingCoaId: funding.fundingCoaId,
      allocations,
    });
    await postJournalEntry(client, {
      businessId,
      date,
      description: merchant || (type === "income" ? "Income" : "Expense"),
      sourceType: "transaction",
      sourceId: id,
      createdBy: userId,
      lines,
    });

    await client.query("COMMIT");
    return res.json({
      message: "Transaction updated",
      transaction: updated.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update transaction error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to update transaction" });
  } finally {
    client.release();
  }
});

// ── DELETE /api/transactions/:id ─────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id FROM transactions WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Remove ledger entry (lines cascade), then the header.
    await deleteEntriesForSource(client, businessId, "transaction", id);
    await client.query(
      "DELETE FROM transactions WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    await client.query("COMMIT");
    return res.json({ message: "Transaction deleted" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete transaction error:", err);
    return res.status(500).json({ error: "Failed to delete transaction" });
  } finally {
    client.release();
  }
});

// ── GET /api/transactions/summary/totals ─────────────────────
// Income vs expense for a date range — derived from the ledger (revenue/
// expense lines), so the dashboard now reflects the authoritative ledger.
router.get("/summary/totals", async (req, res) => {
  const { businessId } = req.user;
  const { startDate, endDate } = req.query;

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN coa.account_type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN coa.account_type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0) AS total_expenses
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE je.business_id = $1
         AND coa.account_type IN ('revenue','expense')
         AND ($2::date IS NULL OR je.entry_date >= $2::date)
         AND ($3::date IS NULL OR je.entry_date <= $3::date)`,
      [businessId, startDate || null, endDate || null],
    );

    const income = Number(result.rows[0].total_income);
    const expenses = Number(result.rows[0].total_expenses);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transactions
       WHERE business_id = $1
         AND ($2::date IS NULL OR date >= $2::date)
         AND ($3::date IS NULL OR date <= $3::date)`,
      [businessId, startDate || null, endDate || null],
    );

    return res.json({
      total_income: Math.round(income * 100) / 100,
      total_expenses: Math.round(expenses * 100) / 100,
      net_profit: Math.round((income - expenses) * 100) / 100,
      transaction_count: parseInt(countResult.rows[0].count, 10),
    });
  } catch (err) {
    console.error("Summary error:", err);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
});

export default router;
