import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// All routes require authentication
router.use(requireAuth);

// ── Helper: fetch business financial context ──────────────────
// Pulls relevant data from DB to give Claude accurate numbers
const getBusinessContext = async (businessId) => {
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const firstOfMonth = `${thisYear}-${String(thisMonth).padStart(2, "0")}-01`;
  const firstOfYear = `${thisYear}-01-01`;

  // Run all queries in parallel for speed
  const [
    businessResult,
    monthlyTotals,
    yearlyTotals,
    topExpenses,
    topIncome,
    recentTransactions,
    categoryBreakdown,
    accountBalances,
    payrollYTD,
    activeEmployees,
  ] = await Promise.all([
    // Business info
    pool.query("SELECT name, plan, currency FROM businesses WHERE id = $1", [
      businessId,
    ]),

    // This month totals
    pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN total_amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN total_amount ELSE 0 END), 0) AS expenses,
        COUNT(*) AS transaction_count
       FROM transactions
       WHERE business_id = $1 AND date >= $2`,
      [businessId, firstOfMonth],
    ),

    // This year totals
    pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN total_amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN total_amount ELSE 0 END), 0) AS expenses
       FROM transactions
       WHERE business_id = $1 AND date >= $2`,
      [businessId, firstOfYear],
    ),

    // Top 5 expense categories this year
    pool.query(
      `SELECT
        c.name AS category,
        COALESCE(SUM(ts.amount), 0) AS total
       FROM transaction_splits ts
       JOIN categories c ON c.id = ts.category_id
       JOIN transactions t ON t.id = ts.transaction_id
       WHERE t.business_id = $1
         AND t.type = 'expense'
         AND t.date >= $2
       GROUP BY c.name
       ORDER BY total DESC
       LIMIT 5`,
      [businessId, firstOfYear],
    ),

    // Top 5 income categories this year
    pool.query(
      `SELECT
        c.name AS category,
        COALESCE(SUM(ts.amount), 0) AS total
       FROM transaction_splits ts
       JOIN categories c ON c.id = ts.category_id
       JOIN transactions t ON t.id = ts.transaction_id
       WHERE t.business_id = $1
         AND t.type = 'income'
         AND t.date >= $2
       GROUP BY c.name
       ORDER BY total DESC
       LIMIT 5`,
      [businessId, firstOfYear],
    ),

    // Last 10 transactions
    pool.query(
      `SELECT
        t.date,
        t.merchant,
        t.total_amount,
        t.type,
        t.notes
       FROM transactions t
       WHERE t.business_id = $1
       ORDER BY t.date DESC
       LIMIT 10`,
      [businessId],
    ),

    // Expense breakdown by category this month
    pool.query(
      `SELECT
        c.name AS category,
        COALESCE(SUM(ts.amount), 0) AS total
       FROM transaction_splits ts
       JOIN categories c ON c.id = ts.category_id
       JOIN transactions t ON t.id = ts.transaction_id
       WHERE t.business_id = $1
         AND t.type = 'expense'
         AND t.date >= $2
       GROUP BY c.name
       ORDER BY total DESC`,
      [businessId, firstOfMonth],
    ),

    // Account balances
    pool.query(
      `SELECT name, type, current_balance, currency
       FROM accounts
       WHERE business_id = $1 AND is_active = TRUE
       ORDER BY current_balance DESC`,
      [businessId],
    ),

    // Payroll YTD
    pool.query(
      `SELECT
        COALESCE(SUM(total_gross), 0) AS ytd_gross,
        COALESCE(SUM(total_taxes), 0) AS ytd_taxes,
        COALESCE(SUM(total_net), 0) AS ytd_net,
        COUNT(*) AS total_runs
       FROM payroll_runs
       WHERE business_id = $1
         AND status = 'finalized'
         AND EXTRACT(YEAR FROM period_end) = $2`,
      [businessId, thisYear],
    ),

    // Active employee count and avg salary
    pool.query(
      `SELECT
        COUNT(*) AS total,
        COALESCE(AVG(CASE WHEN pay_type = 'salary' THEN pay_rate END), 0) AS avg_salary,
        COUNT(CASE WHEN pay_type = 'hourly' THEN 1 END) AS hourly_count,
        COUNT(CASE WHEN pay_type = 'salary' THEN 1 END) AS salary_count
       FROM employees
       WHERE business_id = $1 AND is_active = TRUE`,
      [businessId],
    ),
  ]);

  const biz = businessResult.rows[0];
  const monthly = monthlyTotals.rows[0];
  const yearly = yearlyTotals.rows[0];
  const payroll = payrollYTD.rows[0];
  const employees = activeEmployees.rows[0];

  return `
You are a financial assistant for ${biz.name}. You have access to their real business data below.
Answer questions accurately based on this data. Be concise and helpful.
If asked about something not in the data, say so honestly.
Never make up numbers. Always use the currency ${biz.currency}.
Today's date is ${now.toISOString().split("T")[0]}.
 
=== THIS MONTH (${thisYear}-${String(thisMonth).padStart(2, "0")}) ===
Income: $${parseFloat(monthly.income).toFixed(2)}
Expenses: $${parseFloat(monthly.expenses).toFixed(2)}
Net Profit: $${(parseFloat(monthly.income) - parseFloat(monthly.expenses)).toFixed(2)}
Transactions: ${monthly.transaction_count}
 
=== THIS YEAR (${thisYear}) ===
Income: $${parseFloat(yearly.income).toFixed(2)}
Expenses: $${parseFloat(yearly.expenses).toFixed(2)}
Net Profit: $${(parseFloat(yearly.income) - parseFloat(yearly.expenses)).toFixed(2)}
 
=== TOP EXPENSE CATEGORIES THIS YEAR ===
${topExpenses.rows.map((r) => `${r.category}: $${parseFloat(r.total).toFixed(2)}`).join("\n") || "No data yet"}
 
=== TOP INCOME CATEGORIES THIS YEAR ===
${topIncome.rows.map((r) => `${r.category}: $${parseFloat(r.total).toFixed(2)}`).join("\n") || "No data yet"}
 
=== THIS MONTH EXPENSE BREAKDOWN ===
${categoryBreakdown.rows.map((r) => `${r.category}: $${parseFloat(r.total).toFixed(2)}`).join("\n") || "No expenses this month"}
 
=== ACCOUNT BALANCES ===
${accountBalances.rows.map((r) => `${r.name} (${r.type}): $${parseFloat(r.current_balance).toFixed(2)}`).join("\n") || "No accounts"}
 
=== RECENT TRANSACTIONS (last 10) ===
${
  recentTransactions.rows
    .map(
      (r) =>
        `${r.date.toISOString().split("T")[0]} | ${r.type.toUpperCase()} | $${parseFloat(r.total_amount).toFixed(2)} | ${r.merchant || "No merchant"}`,
    )
    .join("\n") || "No transactions"
}
 
=== PAYROLL (${thisYear} YTD) ===
Total Gross Paid: $${parseFloat(payroll.ytd_gross).toFixed(2)}
Total Taxes Withheld: $${parseFloat(payroll.ytd_taxes).toFixed(2)}
Total Net Paid: $${parseFloat(payroll.ytd_net).toFixed(2)}
Payroll Runs: ${payroll.total_runs}
 
=== EMPLOYEES ===
Active Employees: ${employees.total}
Salaried: ${employees.salary_count} | Hourly: ${employees.hourly_count}
Average Annual Salary: $${parseFloat(employees.avg_salary).toFixed(2)}
`.trim();
};

// ── POST /api/ai/chat ─────────────────────────────────────────
// Send a message and get a response from Claude
router.post("/chat", async (req, res) => {
  const { businessId, userId } = req.user;
  const { message, conversationId } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: "Message is required" });
  }

  if (message.length > 1000) {
    return res
      .status(400)
      .json({ error: "Message too long. Keep it under 1000 characters." });
  }

  try {
    // Get or create conversation
    let conversation;

    if (conversationId) {
      // Load existing conversation — verify it belongs to this business
      const existing = await pool.query(
        "SELECT * FROM ai_conversations WHERE id = $1 AND business_id = $2",
        [conversationId, businessId],
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      conversation = existing.rows[0];
    } else {
      // Start a new conversation
      const newConvo = await pool.query(
        `INSERT INTO ai_conversations (business_id, user_id, messages)
         VALUES ($1, $2, '[]')
         RETURNING *`,
        [businessId, userId],
      );
      conversation = newConvo.rows[0];
    }

    // Build message history for Claude
    const history = conversation.messages || [];

    // Add user message to history
    const updatedHistory = [
      ...history,
      { role: "user", content: message.trim() },
    ];

    // Fetch fresh business context
    const systemPrompt = await getBusinessContext(businessId);

    // Keep only last 20 messages to stay within token limits
    const recentHistory = updatedHistory.slice(-20);

    // Call Claude
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: recentHistory,
    });

    const aiReply = response.content[0].text;

    // Save full conversation back to DB
    const finalHistory = [
      ...updatedHistory,
      { role: "assistant", content: aiReply },
    ];

    await pool.query(
      `UPDATE ai_conversations
       SET messages = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(finalHistory), conversation.id],
    );

    return res.json({
      conversationId: conversation.id,
      message: aiReply,
      history: finalHistory,
    });
  } catch (err) {
    console.error("AI chat error:", err);
    return res.status(500).json({ error: "Failed to get AI response" });
  }
});

// ── GET /api/ai/conversations ─────────────────────────────────
// Get all past conversations for this business
router.get("/conversations", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        ac.id,
        ac.created_at,
        ac.updated_at,
        u.name AS user_name,
        -- Get first user message as preview
        (ac.messages->0->>'content') AS first_message
       FROM ai_conversations ac
       JOIN users u ON u.id = ac.user_id
       WHERE ac.business_id = $1
         AND jsonb_array_length(ac.messages) > 0
       ORDER BY ac.updated_at DESC
       LIMIT 20`,
      [businessId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Get conversations error:", err);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ── GET /api/ai/conversations/:id ────────────────────────────
// Get a single conversation with full message history
router.get("/conversations/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT ac.*, u.name AS user_name
       FROM ai_conversations ac
       JOIN users u ON u.id = ac.user_id
       WHERE ac.id = $1 AND ac.business_id = $2`,
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get conversation error:", err);
    return res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ── DELETE /api/ai/conversations/:id ─────────────────────────
// Delete a conversation
router.delete("/conversations/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT id FROM ai_conversations WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await pool.query(
      "DELETE FROM ai_conversations WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    return res.json({ message: "Conversation deleted" });
  } catch (err) {
    console.error("Delete conversation error:", err);
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
});

export default router;
