import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

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
        a.current_balance,
        a.currency,
        a.is_active,
        a.plaid_account_id,
        a.created_at,
        -- Total income for this account
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.total_amount ELSE 0 END), 0) AS total_income,
        -- Total expenses for this account
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.total_amount ELSE 0 END), 0) AS total_expenses,
        -- Transaction count
        COUNT(t.id) AS transaction_count
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.business_id = $1
       GROUP BY a.id
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
    // Get account
    const accountResult = await pool.query(
      `SELECT * FROM accounts
       WHERE id = $1 AND business_id = $2`,
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
              'category_name', c.name,
              'category_color', c.color,
              'amount', ts.amount
            )
          ) FILTER (WHERE ts.id IS NOT NULL),
          '[]'
        ) AS splits
       FROM transactions t
       LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
       LEFT JOIN categories c ON c.id = ts.category_id
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

  if (!["savings", "current", "credit", "cash", "loan"].includes(type)) {
    return res.status(400).json({
      error: "type must be savings, current, credit, cash, or loan",
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

    const result = await pool.query(
      `INSERT INTO accounts (business_id, name, type, currency, current_balance)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [businessId, name, type, currency || "USD", currentBalance || 0],
    );

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

  if (type && !["bank", "credit", "cash", "loan"].includes(type)) {
    return res.status(400).json({
      error: "type must be bank, credit, cash, or loan",
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

    // Hard delete if no transactions
    await pool.query(
      "DELETE FROM accounts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

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
    const result = await pool.query(
      `SELECT
        SUM(current_balance) AS total_balance,
        SUM(CASE WHEN type = 'bank' THEN current_balance ELSE 0 END) AS bank_balance,
        SUM(CASE WHEN type = 'credit' THEN current_balance ELSE 0 END) AS credit_balance,
        SUM(CASE WHEN type = 'cash' THEN current_balance ELSE 0 END) AS cash_balance,
        COUNT(*) AS account_count
       FROM accounts
       WHERE business_id = $1 AND is_active = TRUE`,
      [businessId],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Account balances error:", err);
    return res.status(500).json({ error: "Failed to fetch balances" });
  }
});

export default router;
