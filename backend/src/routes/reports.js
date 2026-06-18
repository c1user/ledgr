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

// ── GET /api/reports/tax ─────────────────────────────────────
// Tax summary report: income/expense by category + payroll taxes + quarterly
router.get("/tax", async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

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

  const payrollTaxSql = `
    SELECT
      COALESCE(SUM(ps.gross_pay), 0)::NUMERIC(12,2)        AS total_gross,
      COALESCE(SUM(ps.federal_tax), 0)::NUMERIC(12,2)       AS total_federal_tax,
      COALESCE(SUM(ps.social_security), 0)::NUMERIC(12,2)   AS total_social_security,
      COALESCE(SUM(ps.medicare), 0)::NUMERIC(12,2)           AS total_medicare,
      COALESCE(SUM(ps.pr_state_tax), 0)::NUMERIC(12,2)       AS total_pr_state_tax,
      COALESCE(SUM(ps.other_deductions), 0)::NUMERIC(12,2)   AS total_other_deductions,
      COALESCE(SUM(ps.net_pay), 0)::NUMERIC(12,2)            AS total_net_pay,
      COUNT(DISTINCT ps.employee_id)                          AS employee_count,
      COUNT(DISTINCT pr.id)                                   AS run_count
    FROM payslips ps
    JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
    WHERE pr.business_id = $1
      AND EXTRACT(YEAR FROM pr.period_start) = $2
      AND pr.status = 'finalized'
  `;

  const quarterSql = `
    SELECT
      EXTRACT(QUARTER FROM date)::INT AS quarter,
      SUM(CASE WHEN type = 'income'  THEN total_amount ELSE 0 END)::NUMERIC(12,2) AS income,
      SUM(CASE WHEN type = 'expense' THEN total_amount ELSE 0 END)::NUMERIC(12,2) AS expenses
    FROM transactions
    WHERE business_id = $1
      AND EXTRACT(YEAR FROM date) = $2
    GROUP BY EXTRACT(QUARTER FROM date)
    ORDER BY quarter ASC
  `;

  try {
    const [incomeResult, expenseResult, payrollResult, quarterResult] =
      await Promise.all([
        pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "income"]),
        pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "expense"]),
        pool.query(payrollTaxSql, [businessId, year]),
        pool.query(quarterSql, [businessId, year]),
      ]);

    const incomeCategories = incomeResult.rows;
    const expenseCategories = expenseResult.rows;
    const totalIncome = incomeCategories.reduce((s, r) => s + parseFloat(r.total), 0);
    const totalExpenses = expenseCategories.reduce((s, r) => s + parseFloat(r.total), 0);

    // Fill in missing quarters with zeros
    const quarterMap = {};
    for (const row of quarterResult.rows) {
      quarterMap[row.quarter] = row;
    }
    const quarterly = [1, 2, 3, 4].map((q) => ({
      quarter: `Q${q}`,
      income: parseFloat(quarterMap[q]?.income || 0),
      expenses: parseFloat(quarterMap[q]?.expenses || 0),
    }));

    return res.json({
      year,
      income_categories: incomeCategories,
      expense_categories: expenseCategories,
      total_income: parseFloat(totalIncome.toFixed(2)),
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      net_income: parseFloat((totalIncome - totalExpenses).toFixed(2)),
      payroll: payrollResult.rows[0],
      quarterly,
    });
  } catch (err) {
    console.error("Tax summary report error:", err);
    return res.status(500).json({ error: "Failed to generate tax report" });
  }
});

export default router;
