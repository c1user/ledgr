/**
 * routes/chartOfAccounts.js
 *
 * Item 1 (Chart of accounts) — API.
 * Mount in server.js:  app.use("/api/chart-of-accounts", chartOfAccountsRoutes);
 *
 * Returns the chart of accounts as a type-grouped tree. Names are returned
 * as BOTH name_key (for i18n resolution on the frontend) and name (for
 * user-created accounts). The frontend resolves: nameKey ? t(nameKey) : name.
 *
 * Point ChartOfAccounts.jsx at this endpoint instead of /accounts — it is
 * the real chart of accounts (assets, liabilities, equity, revenue, expense),
 * not a visual grouping of bank accounts.
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

// ── GET /api/chart-of-accounts ───────────────────────────────
// Type-grouped, parent/child tree, each account with its current balance.
router.get("/", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
         coa.id, coa.code, coa.name_key, coa.name, coa.account_type,
         coa.normal_balance, coa.color, coa.parent_id, coa.is_system, coa.is_active,
         COALESCE(bal.natural_balance, 0) AS balance
       FROM chart_of_accounts coa
       LEFT JOIN account_ledger_balances bal ON bal.account_id = coa.id
       WHERE coa.business_id = $1
       ORDER BY coa.code NULLS LAST, coa.name_key NULLS LAST, coa.name`,
      [businessId],
    );

    // Build parent/child tree
    const byId = new Map();
    result.rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
    const roots = [];
    byId.forEach((node) => {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Group roots by account type, in conventional order
    const grouped = TYPE_ORDER.map((type) => ({
      account_type: type,
      accounts: roots.filter((n) => n.account_type === type),
      total: roots
        .filter((n) => n.account_type === type)
        .reduce((sum, n) => sum + Number(n.balance), 0),
    })).filter((g) => g.accounts.length > 0);

    return res.json(grouped);
  } catch (err) {
    console.error("Get chart of accounts error:", err);
    return res.status(500).json({ error: "Failed to fetch chart of accounts" });
  }
});

// ── POST /api/chart-of-accounts ──────────────────────────────
// Create a custom account. normal_balance is derived from account_type.
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const { name, accountType, code, color, parentId } = req.body;

  if (!name || !accountType) {
    return res.status(400).json({ error: "name and accountType are required" });
  }
  if (!TYPE_ORDER.includes(accountType)) {
    return res
      .status(400)
      .json({ error: `accountType must be one of: ${TYPE_ORDER.join(", ")}` });
  }

  const normalBalance =
    accountType === "asset" || accountType === "expense" ? "debit" : "credit";

  try {
    // If a parent is given, it must belong to this business and share the type.
    if (parentId) {
      const parent = await pool.query(
        "SELECT account_type FROM chart_of_accounts WHERE id = $1 AND business_id = $2",
        [parentId, businessId],
      );
      if (parent.rows.length === 0) {
        return res.status(404).json({ error: "Parent account not found" });
      }
      if (parent.rows[0].account_type !== accountType) {
        return res.status(400).json({
          error: "A sub-account must have the same account type as its parent",
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO chart_of_accounts
         (business_id, code, name, account_type, normal_balance, color, parent_id, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       RETURNING *`,
      [
        businessId,
        code || null,
        name,
        accountType,
        normalBalance,
        color || "#888888",
        parentId || null,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "An account with that code already exists" });
    }
    console.error("Create account error:", err);
    return res.status(500).json({ error: "Failed to create account" });
  }
});

// ── PUT /api/chart-of-accounts/:id ───────────────────────────
// System accounts: only name/color/active editable. Type is immutable
// (changing it would corrupt historical postings).
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { name, color, isActive } = req.body;

  try {
    const existing = await pool.query(
      "SELECT * FROM chart_of_accounts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }
    const acct = existing.rows[0];

    // System accounts keep their name_key (i18n); only color/active change.
    const newName = acct.is_system ? acct.name : (name ?? acct.name);

    const result = await pool.query(
      `UPDATE chart_of_accounts
         SET name = $1, color = COALESCE($2, color), is_active = COALESCE($3, is_active)
       WHERE id = $4 AND business_id = $5
       RETURNING *`,
      [newName, color || null, isActive ?? null, id, businessId],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update account error:", err);
    return res.status(500).json({ error: "Failed to update account" });
  }
});

// ── DELETE /api/chart-of-accounts/:id ────────────────────────
// Only allowed if the account has never been posted to. System accounts
// can't be deleted (deactivate instead).
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM chart_of_accounts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Account not found" });
    }
    if (existing.rows[0].is_system) {
      return res
        .status(400)
        .json({
          error: "System accounts can't be deleted. Deactivate it instead.",
        });
    }

    const used = await pool.query(
      "SELECT 1 FROM journal_entry_lines WHERE account_id = $1 LIMIT 1",
      [id],
    );
    if (used.rows.length > 0) {
      return res.status(400).json({
        error:
          "This account has ledger postings and can't be deleted. Deactivate it instead.",
      });
    }

    await pool.query(
      "DELETE FROM chart_of_accounts WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    return res.json({ message: "Account deleted" });
  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: "Failed to delete account" });
  }
});

export default router;
