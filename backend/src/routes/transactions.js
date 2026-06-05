import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ── GET /api/transactions ─────────────────────────────────────
// Get all transactions for the business with optional filters
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
    let query = `
      SELECT
        t.id,
        t.date,
        t.merchant,
        t.total_amount,
        t.type,
        t.is_split,
        t.notes,
        t.plaid_tx_id,
        t.created_at,
        t.category_id,
        a.name AS account_name,
        u.name AS created_by_name,
        r.id AS receipt_id,
        r.status AS receipt_status,
        cat.name AS category_name,
        cat.color AS category_color,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ts.id,
              'amount', ts.amount,
              'notes', ts.notes,
              'category_id', ts.category_id,
              'category_name', sc.name,
              'category_color', sc.color
            )
          ) FILTER (WHERE ts.id IS NOT NULL),
          '[]'
        ) AS splits
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN users u ON u.id = t.created_by
      LEFT JOIN receipts r ON r.id = t.receipt_id
      LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
      LEFT JOIN categories sc ON sc.id = ts.category_id
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE t.business_id = $1
    `;

    const params = [businessId];
    let paramCount = 1;

    if (startDate) {
      paramCount++;
      query += ` AND t.date >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND t.date <= $${paramCount}`;
      params.push(endDate);
    }

    if (type) {
      paramCount++;
      query += ` AND t.type = $${paramCount}`;
      params.push(type);
    }

    if (accountId) {
      paramCount++;
      query += ` AND t.account_id = $${paramCount}`;
      params.push(accountId);
    }

    if (categoryId) {
      paramCount++;
      query += ` AND (t.category_id = $${paramCount} OR ts.category_id = $${paramCount})`;
      params.push(categoryId);
    }

    query += `
      GROUP BY t.id, a.name, u.name, r.id, r.status, cat.name, cat.color
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transactions t
       WHERE t.business_id = $1`,
      [businessId],
    );

    return res.json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error("Get transactions error:", err);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ── GET /api/transactions/:id ─────────────────────────────────
// Get a single transaction with full split details
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
        t.*,
        a.name AS account_name,
        u.name AS created_by_name,
        r.s3_key AS receipt_s3_key,
        r.status AS receipt_status,
        r.ai_merchant,
        r.ai_total,
        r.ai_date,
        cat.name AS category_name,
        cat.color AS category_color,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ts.id,
              'amount', ts.amount,
              'notes', ts.notes,
              'category_id', ts.category_id,
              'category_name', sc.name,
              'category_color', sc.color,
              'category_type', sc.type
            )
          ) FILTER (WHERE ts.id IS NOT NULL),
          '[]'
        ) AS splits
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN users u ON u.id = t.created_by
      LEFT JOIN receipts r ON r.id = t.receipt_id
      LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
      LEFT JOIN categories sc ON sc.id = ts.category_id
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE t.id = $1 AND t.business_id = $2
      GROUP BY t.id, a.name, u.name, r.s3_key, r.status, r.ai_merchant, r.ai_total, r.ai_date, cat.name, cat.color`,
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

// ── POST /api/transactions ────────────────────────────────────
// Create a new transaction with optional splits
router.post("/", async (req, res) => {
  const { businessId, userId } = req.user;
  const {
    accountId,
    date,
    merchant,
    totalAmount,
    type,
    notes,
    receiptId,
    categoryId,
    splits,
  } = req.body;

  // Validation
  if (!accountId || !date || !totalAmount || !type) {
    return res.status(400).json({
      error: "accountId, date, totalAmount and type are required",
    });
  }

  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "type must be income or expense" });
  }

  if (totalAmount <= 0) {
    return res
      .status(400)
      .json({ error: "totalAmount must be greater than 0" });
  }

  // Validate splits if provided
  if (splits && splits.length > 0) {
    const splitSum = splits.reduce((sum, s) => sum + parseFloat(s.amount), 0);
    const total = parseFloat(totalAmount);
    if (Math.abs(splitSum - total) > 0.01) {
      return res.status(400).json({
        error: `Split amounts ($${splitSum.toFixed(2)}) must equal total amount ($${total.toFixed(2)})`,
      });
    }
    for (const split of splits) {
      if (!split.categoryId || !split.amount || split.amount <= 0) {
        return res.status(400).json({
          error: "Each split must have a categoryId and a positive amount",
        });
      }
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify account belongs to this business
    const accountCheck = await client.query(
      "SELECT id FROM accounts WHERE id = $1 AND business_id = $2",
      [accountId, businessId],
    );
    if (accountCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Account not found" });
    }

    const isSplit = !!(splits && splits.length > 0);

    // Insert transaction
    const txResult = await client.query(
      `INSERT INTO transactions
        (business_id, account_id, created_by, date, merchant, total_amount, type, is_split, receipt_id, notes, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        businessId,
        accountId,
        userId,
        date,
        merchant || null,
        totalAmount,
        type,
        isSplit,
        receiptId || null,
        notes || null,
        !isSplit ? categoryId || null : null,
      ],
    );
    const transaction = txResult.rows[0];

    // Insert splits if provided
    if (isSplit) {
      for (const split of splits) {
        const catCheck = await client.query(
          "SELECT id FROM categories WHERE id = $1 AND business_id = $2",
          [split.categoryId, businessId],
        );
        if (catCheck.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            error: `Category ${split.categoryId} not found`,
          });
        }
        await client.query(
          `INSERT INTO transaction_splits (transaction_id, category_id, amount, notes)
           VALUES ($1, $2, $3, $4)`,
          [transaction.id, split.categoryId, split.amount, split.notes || null],
        );
      }
    }

    // Update account balance
    const balanceChange = type === "income" ? totalAmount : -totalAmount;
    await client.query(
      "UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2",
      [balanceChange, accountId],
    );

    await client.query("COMMIT");

    // Return full transaction with splits and category
    const fullTx = await pool.query(
      `SELECT t.*,
        a.name AS account_name,
        cat.name AS category_name,
        cat.color AS category_color,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ts.id,
              'amount', ts.amount,
              'notes', ts.notes,
              'category_id', ts.category_id,
              'category_name', sc.name,
              'category_color', sc.color
            )
          ) FILTER (WHERE ts.id IS NOT NULL),
          '[]'
        ) AS splits
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
       LEFT JOIN categories sc ON sc.id = ts.category_id
       LEFT JOIN categories cat ON cat.id = t.category_id
       WHERE t.id = $1
       GROUP BY t.id, a.name, cat.name, cat.color`,
      [transaction.id],
    );

    return res.status(201).json(fullTx.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create transaction error:", err);
    return res.status(500).json({ error: "Failed to create transaction" });
  } finally {
    client.release();
  }
});

// ── PUT /api/transactions/:id ─────────────────────────────────
// Update a transaction and its splits
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const {
    date,
    merchant,
    totalAmount,
    type,
    notes,
    accountId,
    categoryId,
    splits,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get existing transaction
    const existing = await client.query(
      "SELECT * FROM transactions WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Transaction not found" });
    }
    const oldTx = existing.rows[0];

    // Validate splits if provided
    if (splits && splits.length > 0) {
      const amount = totalAmount || oldTx.total_amount;
      const splitSum = splits.reduce((sum, s) => sum + parseFloat(s.amount), 0);
      if (Math.abs(splitSum - parseFloat(amount)) > 0.01) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Split amounts ($${splitSum.toFixed(2)}) must equal total amount ($${parseFloat(amount).toFixed(2)})`,
        });
      }
    }

    // Reverse old balance change
    const oldBalanceChange =
      oldTx.type === "income" ? -oldTx.total_amount : oldTx.total_amount;
    await client.query(
      "UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2",
      [oldBalanceChange, oldTx.account_id],
    );

    const isSplit = !!(splits && splits.length > 0);

    // Update transaction
    const updatedTx = await client.query(
      `UPDATE transactions SET
        date         = COALESCE($1, date),
        merchant     = COALESCE($2, merchant),
        total_amount = COALESCE($3, total_amount),
        type         = COALESCE($4, type),
        notes        = COALESCE($5, notes),
        account_id   = COALESCE($6, account_id),
        is_split     = $7,
        category_id  = CASE WHEN $7 = true THEN NULL ELSE COALESCE($8, category_id) END
       WHERE id = $9 AND business_id = $10
       RETURNING *`,
      [
        date,
        merchant,
        totalAmount,
        type,
        notes,
        accountId,
        isSplit,
        categoryId || null,
        id,
        businessId,
      ],
    );
    const tx = updatedTx.rows[0];

    // Replace splits
    if (splits !== undefined) {
      await client.query(
        "DELETE FROM transaction_splits WHERE transaction_id = $1",
        [id],
      );
      if (isSplit) {
        for (const split of splits) {
          await client.query(
            `INSERT INTO transaction_splits (transaction_id, category_id, amount, notes)
             VALUES ($1, $2, $3, $4)`,
            [id, split.categoryId, split.amount, split.notes || null],
          );
        }
      }
    }

    // Apply new balance change
    const newType = type || oldTx.type;
    const newAmount = totalAmount || oldTx.total_amount;
    const newAccountId = accountId || oldTx.account_id;
    const newBalanceChange = newType === "income" ? newAmount : -newAmount;
    await client.query(
      "UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2",
      [newBalanceChange, newAccountId],
    );

    await client.query("COMMIT");

    return res.json({ message: "Transaction updated", transaction: tx });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update transaction error:", err);
    return res.status(500).json({ error: "Failed to update transaction" });
  } finally {
    client.release();
  }
});

// ── DELETE /api/transactions/:id ──────────────────────────────
// Delete a transaction and its splits (cascade handles splits)
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
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
    const tx = existing.rows[0];

    await client.query(
      "DELETE FROM transactions WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    const balanceChange =
      tx.type === "income" ? -tx.total_amount : tx.total_amount;
    await client.query(
      "UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2",
      [balanceChange, tx.account_id],
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
// Get income vs expense totals for a date range (for dashboard)
router.get("/summary/totals", async (req, res) => {
  const { businessId } = req.user;
  const { startDate, endDate } = req.query;

  try {
    const result = await pool.query(
      `SELECT
        SUM(CASE WHEN type = 'income' THEN total_amount ELSE 0 END) AS total_income,
        SUM(CASE WHEN type = 'expense' THEN total_amount ELSE 0 END) AS total_expenses,
        SUM(CASE WHEN type = 'income' THEN total_amount ELSE -total_amount END) AS net_profit,
        COUNT(*) AS transaction_count
       FROM transactions
       WHERE business_id = $1
         AND ($2::date IS NULL OR date >= $2::date)
         AND ($3::date IS NULL OR date <= $3::date)`,
      [businessId, startDate || null, endDate || null],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Summary error:", err);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
});

export default router;
