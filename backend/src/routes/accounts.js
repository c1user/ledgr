import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import {
  createAccountCoa,
  ACCOUNT_TYPES,
  ASSET_ACCOUNT_TYPES,
} from "../services/coaSeed.js";
import { postJournalEntry } from "../services/ledger.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);
router.param("id", uuidParam("Account"));

// ── GET /api/accounts ─────────────────────────────────────────
// Get all accounts for the business
router.get("/", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        a.id,
        a.name,
        a.type,
        -- Live balance from the ledger (opening entry + posted activity),
        -- not the stored opening amount. Falls back to the stored value for
        -- accounts with no ledger twin/activity yet.
        COALESCE(bal.natural_balance, a.current_balance) AS current_balance,
        a.currency,
        a.is_active,
        a.plaid_account_id,
        a.coa_account_id,
        a.created_at,
        -- Total income for this account
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.total_amount ELSE 0 END), 0) AS total_income,
        -- Total expenses for this account
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.total_amount ELSE 0 END), 0) AS total_expenses,
        -- Transaction count
        COUNT(t.id) AS transaction_count
       FROM accounts a
       LEFT JOIN account_ledger_balances bal ON bal.account_id = a.coa_account_id
       LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.business_id = $1
       GROUP BY a.id, bal.natural_balance
       ORDER BY a.is_active DESC, a.created_at ASC`,
      [businessId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Get accounts error:", err);
    return res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

// ── GET /api/accounts/:id ─────────────────────────────────────
// Get a single account with recent transactions
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    // Get account — current_balance reflects the live ledger balance.
    const accountResult = await pool.query(
      `SELECT
        a.id, a.business_id, a.name, a.type, a.plaid_account_id,
        a.currency, a.is_active, a.created_at, a.coa_account_id,
        COALESCE(bal.natural_balance, a.current_balance) AS current_balance
       FROM accounts a
       LEFT JOIN account_ledger_balances bal ON bal.account_id = a.coa_account_id
       WHERE a.id = $1 AND a.business_id = $2`,
      [id, businessId],
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    const account = accountResult.rows[0];

    // Get last 10 transactions for this account
    const txResult = await pool.query(
      `SELECT
        t.id,
        t.date,
        t.merchant,
        t.total_amount,
        t.type,
        t.is_split,
        t.notes,
        COALESCE(
          json_agg(
            json_build_object(
              'category_name', coa.name,
              'category_name_key', coa.name_key,
              'category_color', coa.color,
              'amount', (jel.debit + jel.credit)
            )
          ) FILTER (WHERE coa.id IS NOT NULL),
          '[]'
        ) AS splits
       FROM transactions t
       LEFT JOIN journal_entries je
         ON je.source_type = 'transaction' AND je.source_id = t.id
       LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       LEFT JOIN chart_of_accounts coa
         ON coa.id = jel.account_id AND coa.account_type IN ('revenue', 'expense')
       WHERE t.account_id = $1 AND t.business_id = $2
       GROUP BY t.id
       ORDER BY t.date DESC
       LIMIT 10`,
      [id, businessId],
    );

    return res.json({
      ...account,
      recent_transactions: txResult.rows,
    });
  } catch (err) {
    console.error("Get account error:", err);
    return res.status(500).json({ error: "Failed to fetch account" });
  }
});

// ── POST /api/accounts ────────────────────────────────────────
// Create a new account
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const { name, type, currency, currentBalance } = req.body;

  // Validation
  if (!name || !type) {
    return res.status(400).json({ error: "name and type are required" });
  }

  if (!ACCOUNT_TYPES.includes(type)) {
    return res.status(400).json({
      error: `type must be one of: ${ACCOUNT_TYPES.join(", ")}`,
    });
  }

  try {
    // Check for duplicate account name within business
    const existing = await pool.query(
      "SELECT id FROM accounts WHERE business_id = $1 AND name = $2",
      [businessId, name],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "An account with this name already exists",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO accounts (business_id, name, type, currency, current_balance)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [businessId, name, type, currency || "USD", currentBalance || 0],
      );
      const account = result.rows[0];

      // Ledger identity for this account (asset or liability).
      const coaId = await createAccountCoa(client, businessId, account);

      // Opening balance → opening journal entry against Owner's equity (code 3000).
      const opening = parseFloat(currentBalance || 0);
      if (opening !== 0) {
        const eq = await client.query(
          "SELECT id FROM chart_of_accounts WHERE business_id = $1 AND code = '3000'",
          [businessId],
        );
        const equityId = eq.rows[0].id;
        const isAsset = ASSET_ACCOUNT_TYPES.includes(type);
        const lines = isAsset
          ? [
              { accountId: coaId, debit: Math.abs(opening) },
              { accountId: equityId, credit: Math.abs(opening) },
            ]
          : [
              { accountId: equityId, debit: Math.abs(opening) },
              { accountId: coaId, credit: Math.abs(opening) },
            ];
        await postJournalEntry(client, {
          businessId,
          date: new Date().toISOString().slice(0, 10),
          description: `Opening balance: ${name}`,
          sourceType: "opening_balance",
          sourceId: account.id,
          createdBy: req.user.userId,
          lines,
        });
      }

      await client.query("COMMIT");
      return res.status(201).json(account);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Create account error:", err);
      return res.status(500).json({ error: "Failed to create account" });
    } finally {
      client.release();
    }

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create account error:", err);
    return res.status(500).json({ error: "Failed to create account" });
  }
});

// ── PUT /api/accounts/:id ─────────────────────────────────────
// Update an account name, type, or currency
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { name, type, currency, isActive } = req.body;

  if (type && !ACCOUNT_TYPES.includes(type)) {
    return res.status(400).json({
      error: `type must be one of: ${ACCOUNT_TYPES.join(", ")}`,
    });
  }

  try {
    const existing = await pool.query(
      "SELECT * FROM accounts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    const result = await pool.query(
      `UPDATE accounts SET
        name      = COALESCE($1, name),
        type      = COALESCE($2, type),
        currency  = COALESCE($3, currency),
        is_active = COALESCE($4, is_active)
       WHERE id = $5 AND business_id = $6
       RETURNING *`,
      [
        name || null,
        type || null,
        currency || null,
        isActive ?? null,
        id,
        businessId,
      ],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update account error:", err);
    return res.status(500).json({ error: "Failed to update account" });
  }
});

// ── DELETE /api/accounts/:id ──────────────────────────────────
// Soft delete — sets is_active to false instead of removing
// Hard delete is blocked if account has transactions
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM accounts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Check if account has transactions
    const hasTx = await pool.query(
      "SELECT id FROM transactions WHERE account_id = $1 LIMIT 1",
      [id],
    );

    if (hasTx.rows.length > 0) {
      // Soft delete — keep for historical records
      await pool.query(
        "UPDATE accounts SET is_active = FALSE WHERE id = $1 AND business_id = $2",
        [id, businessId],
      );
      return res.json({
        message: "Account deactivated. Historical transactions are preserved.",
      });
    }

    // Hard delete if no transactions. The account's opening-balance journal
    // entry (source_type 'opening_balance', source_id = account id) and its
    // dedicated ledger account go with it — otherwise they'd sit orphaned
    // in the ledger, still counted by the equity side of the balance sheet.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM journal_entry_lines l USING journal_entries e
         WHERE e.id = l.journal_entry_id
           AND e.business_id = $1
           AND e.source_type = 'opening_balance' AND e.source_id = $2`,
        [businessId, id],
      );
      await client.query(
        `DELETE FROM journal_entries
         WHERE business_id = $1
           AND source_type = 'opening_balance' AND source_id = $2`,
        [businessId, id],
      );
      const coaId = existing.rows[0].coa_account_id;
      await client.query(
        "DELETE FROM accounts WHERE id = $1 AND business_id = $2",
        [id, businessId],
      );
      if (coaId) {
        await client.query(
          "DELETE FROM chart_of_accounts WHERE id = $1 AND business_id = $2",
          [coaId, businessId],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return res.json({ message: "Account deleted" });
  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: "Failed to delete account" });
  }
});

// ── GET /api/accounts/summary/balances ───────────────────────
// Get total balance across all active accounts (for dashboard)
router.get("/summary/balances", async (req, res) => {
  const { businessId } = req.user;

  try {
    // Sum the live ledger balance per account, grouped by type.
    const result = await pool.query(
      `SELECT
        SUM(bal_amt) AS total_balance,
        -- "Bank" groups the savings + current account types (there is no 'bank' type)
        SUM(CASE WHEN type IN ('savings', 'current') THEN bal_amt ELSE 0 END) AS bank_balance,
        SUM(CASE WHEN type = 'credit' THEN bal_amt ELSE 0 END) AS credit_balance,
        SUM(CASE WHEN type = 'cash' THEN bal_amt ELSE 0 END) AS cash_balance,
        COUNT(*) AS account_count
       FROM (
         SELECT a.type,
                COALESCE(bal.natural_balance, a.current_balance) AS bal_amt
         FROM accounts a
         LEFT JOIN account_ledger_balances bal ON bal.account_id = a.coa_account_id
         WHERE a.business_id = $1 AND a.is_active = TRUE
       ) s`,
      [businessId],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Account balances error:", err);
    return res.status(500).json({ error: "Failed to fetch balances" });
  }
});

export default router;
