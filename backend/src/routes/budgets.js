import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// Parse "YYYY-MM" query param into a DATE string "YYYY-MM-01"
function toPeriod(month) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : currentYearMonth();
  return `${m}-01`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ── GET /api/budgets/summary — before anything else ───────────
router.get("/summary", async (req, res) => {
  const { businessId } = req.user;
  const period = toPeriod(req.query.month);

  try {
    const result = await pool.query(
      `SELECT
         c.id, c.name, c.color, c.type,
         b.amount AS budget_amount,
         b.rollover,
         COALESCE((
           SELECT SUM(t.total_amount)
           FROM transactions t
           WHERE t.business_id = $1
             AND t.category_id = c.id
             AND t.is_split = false
             AND t.date >= $2::date
             AND t.date < $2::date + INTERVAL '1 month'
         ), 0) +
         COALESCE((
           SELECT SUM(ts.amount)
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.business_id = $1
             AND ts.category_id = c.id
             AND t.date >= $2::date
             AND t.date < $2::date + INTERVAL '1 month'
         ), 0) AS actual_amount
       FROM categories c
       JOIN budgets b ON b.category_id = c.id
         AND b.business_id = $1
         AND b.period = $2::date
       WHERE c.business_id = $1
         AND b.amount > 0
       ORDER BY c.type, c.name`,
      [businessId, period],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Budget summary error:", err);
    return res.status(500).json({ error: "Failed to fetch budget summary" });
  }
});

// ── GET /api/budgets?month=YYYY-MM ────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const period = toPeriod(req.query.month);

  try {
    const result = await pool.query(
      `SELECT b.id, b.category_id, b.amount, b.rollover, b.period,
              c.name AS category_name, c.color AS category_color, c.type AS category_type
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       WHERE b.business_id = $1 AND b.period = $2::date
       ORDER BY c.type, c.name`,
      [businessId, period],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get budgets error:", err);
    return res.status(500).json({ error: "Failed to fetch budgets" });
  }
});

// ── PUT /api/budgets — batch upsert ───────────────────────────
// body: { period: "YYYY-MM", lines: [{ categoryId, amount, rollover }] }
router.put("/", async (req, res) => {
  const { businessId } = req.user;
  const { period: monthParam, lines } = req.body;

  if (!Array.isArray(lines)) {
    return res.status(400).json({ error: "lines must be an array" });
  }

  const period = toPeriod(monthParam);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const line of lines) {
      const amount = parseFloat(line.amount) || 0;
      if (amount <= 0) {
        // Clean up rows that were zeroed out
        await client.query(
          "DELETE FROM budgets WHERE business_id=$1 AND category_id=$2 AND period=$3::date",
          [businessId, line.categoryId, period],
        );
      } else {
        await client.query(
          `INSERT INTO budgets (business_id, category_id, period, amount, rollover)
           VALUES ($1, $2, $3::date, $4, $5)
           ON CONFLICT (business_id, category_id, period)
           DO UPDATE SET amount = EXCLUDED.amount, rollover = EXCLUDED.rollover`,
          [businessId, line.categoryId, period, amount, !!line.rollover],
        );
      }
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Save budgets error:", err);
    return res.status(500).json({ error: "Failed to save budgets" });
  } finally {
    client.release();
  }
});

// ── POST /api/budgets/copy-previous ───────────────────────────
// body: { targetMonth: "YYYY-MM" }
router.post("/copy-previous", async (req, res) => {
  const { businessId } = req.user;
  const { targetMonth } = req.body;

  if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
    return res.status(400).json({ error: "targetMonth must be YYYY-MM" });
  }

  // Compute source month (one month before target)
  const [yr, mo] = targetMonth.split("-").map(Number);
  const srcDate = new Date(yr, mo - 2, 1);
  const srcMonth = `${srcDate.getFullYear()}-${String(srcDate.getMonth() + 1).padStart(2, "0")}`;
  const sourcePeriod = `${srcMonth}-01`;
  const targetPeriod = `${targetMonth}-01`;

  try {
    // Fetch source budgets with actual spend (for rollover calculation)
    const srcResult = await pool.query(
      `SELECT
         b.category_id,
         b.amount::numeric AS budget_amount,
         b.rollover,
         COALESCE((
           SELECT SUM(t.total_amount)
           FROM transactions t
           WHERE t.business_id = $1
             AND t.category_id = b.category_id
             AND t.is_split = false
             AND t.date >= $2::date
             AND t.date < $2::date + INTERVAL '1 month'
         ), 0) +
         COALESCE((
           SELECT SUM(ts.amount)
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.business_id = $1
             AND ts.category_id = b.category_id
             AND t.date >= $2::date
             AND t.date < $2::date + INTERVAL '1 month'
         ), 0) AS actual_amount
       FROM budgets b
       WHERE b.business_id = $1 AND b.period = $2::date AND b.amount > 0`,
      [businessId, sourcePeriod],
    );

    if (srcResult.rows.length === 0) {
      return res.status(404).json({ error: "No budget found for previous month" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const row of srcResult.rows) {
        const budgeted = parseFloat(row.budget_amount);
        const actual = parseFloat(row.actual_amount);
        const newAmount = row.rollover
          ? budgeted + Math.max(0, budgeted - actual)
          : budgeted;

        await client.query(
          `INSERT INTO budgets (business_id, category_id, period, amount, rollover)
           VALUES ($1, $2, $3::date, $4, $5)
           ON CONFLICT (business_id, category_id, period) DO NOTHING`,
          [businessId, row.category_id, targetPeriod, newAmount, row.rollover],
        );
      }

      await client.query("COMMIT");
      return res.json({ ok: true, copied: srcResult.rows.length });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Copy previous budget error:", err);
    return res.status(500).json({ error: "Failed to copy previous budget" });
  }
});

export default router;
