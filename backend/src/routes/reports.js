import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── GET /api/reports/pl ───────────────────────────────────────
// Profit & Loss report: income/expense by category + monthly trend
router.get("/pl", async (req, res) => {
  const { businessId } = req.user;

  const startDate = req.query.startDate || monthStartStr();
  const endDate = req.query.endDate || todayStr();

  const categoryBreakdownSql = `
    SELECT
      category_id,
      category_name,
      category_color,
      SUM(total)::NUMERIC(12,2) AS total
    FROM (
      SELECT
        c.id   AS category_id,
        c.name AS category_name,
        c.color AS category_color,
        ts.amount AS total
      FROM transaction_splits ts
      JOIN categories  c ON c.id = ts.category_id
      JOIN transactions t ON t.id = ts.transaction_id
      WHERE t.business_id = $1
        AND t.date >= $2::date
        AND t.date <= $3::date
        AND c.type = $4

      UNION ALL

      SELECT
        c.id,
        c.name,
        c.color,
        t.total_amount
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      WHERE t.business_id = $1
        AND t.date >= $2::date
        AND t.date <= $3::date
        AND t.is_split = FALSE
        AND c.type = $4
    ) combined
    GROUP BY category_id, category_name, category_color
    ORDER BY total DESC
  `;

  const trendSql = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month,
      SUM(CASE WHEN type = 'income'  THEN total_amount ELSE 0 END)::NUMERIC(12,2) AS income,
      SUM(CASE WHEN type = 'expense' THEN total_amount ELSE 0 END)::NUMERIC(12,2) AS expenses
    FROM transactions
    WHERE business_id = $1
      AND date >= $2::date
      AND date <= $3::date
    GROUP BY DATE_TRUNC('month', date)
    ORDER BY DATE_TRUNC('month', date) ASC
  `;

  try {
    const [incomeResult, expenseResult, trendResult] = await Promise.all([
      pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "income"]),
      pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "expense"]),
      pool.query(trendSql, [businessId, startDate, endDate]),
    ]);

    const incomeCategories = incomeResult.rows;
    const expenseCategories = expenseResult.rows;

    const totalIncome = incomeCategories.reduce(
      (sum, r) => sum + parseFloat(r.total),
      0,
    );
    const totalExpenses = expenseCategories.reduce(
      (sum, r) => sum + parseFloat(r.total),
      0,
    );

    return res.json({
      income_categories: incomeCategories,
      expense_categories: expenseCategories,
      total_income: parseFloat(totalIncome.toFixed(2)),
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      net_income: parseFloat((totalIncome - totalExpenses).toFixed(2)),
      monthly_trend: trendResult.rows,
    });
  } catch (err) {
    console.error("P&L report error:", err);
    return res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
