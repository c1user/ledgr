import express from "express";
import pool from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import { requireFeature } from "../middleware/entitlements.js";
import {
  buildCashFlowPdf,
  buildPlPdf,
  buildTaxPdf,
  fetchBusiness,
} from "../services/reportPdf.js";
import { postJournalEntry } from "../services/ledger.js";
import { buildSuriFile } from "../services/suriFile.js";
import {
  generateIvuSchedule,
  displayStatus,
} from "../services/complianceSchedule.js";
import { todayPR, toIso } from "../services/prDates.js";
import { decryptField } from "../services/fieldCrypto.js";

const router = express.Router();

router.use(requireAuth);
router.param("id", uuidParam("Obligation"));

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── P&L data (shared by the JSON and PDF endpoints) ──────────
async function getPlData(businessId, startDate, endDate) {
  // Category breakdown from the ledger: sum journal-line activity per
  // chart-of-accounts account. $4 is the account_type ('revenue' or 'expense').
  // Revenue is naturally a credit, expense a debit — normalize to positive.
  const categoryBreakdownSql = `
    SELECT
      coa.id       AS category_id,
      coa.name_key AS category_name_key,
      coa.name     AS category_name,
      coa.color    AS category_color,
      SUM(CASE WHEN coa.account_type = 'revenue'
               THEN jel.credit - jel.debit
               ELSE jel.debit - jel.credit END)::NUMERIC(12,2) AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.business_id = $1
      AND je.entry_date >= $2::date
      AND je.entry_date <= $3::date
      AND coa.account_type = $4
    GROUP BY coa.id, coa.name_key, coa.name, coa.color
    HAVING SUM(CASE WHEN coa.account_type = 'revenue'
               THEN jel.credit - jel.debit
               ELSE jel.debit - jel.credit END) <> 0
    ORDER BY total DESC
  `;

  const trendSql = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', je.entry_date), 'YYYY-MM') AS month,
      SUM(CASE WHEN coa.account_type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END)::NUMERIC(12,2) AS income,
      SUM(CASE WHEN coa.account_type = 'expense' THEN jel.debit - jel.credit ELSE 0 END)::NUMERIC(12,2) AS expenses
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.business_id = $1
      AND coa.account_type IN ('revenue', 'expense')
      AND je.entry_date >= $2::date
      AND je.entry_date <= $3::date
    GROUP BY DATE_TRUNC('month', je.entry_date)
    ORDER BY DATE_TRUNC('month', je.entry_date) ASC
  `;

  // FX summary: transactions recorded in a foreign currency, grouped by currency
  const fxSummarySql = `
    SELECT
      original_currency                        AS currency,
      COUNT(*)::INT                            AS count,
      SUM(original_amount)::NUMERIC(12,2)      AS original_total,
      SUM(total_amount)::NUMERIC(12,2)         AS converted_total,
      b.currency                               AS base_currency
    FROM transactions t
    JOIN businesses b ON b.id = t.business_id
    WHERE t.business_id = $1
      AND t.original_currency IS NOT NULL
      AND t.original_currency != b.currency
      AND t.date >= $2::date
      AND t.date <= $3::date
    GROUP BY t.original_currency, b.currency
    ORDER BY converted_total DESC
  `;

  const [incomeResult, expenseResult, trendResult, fxResult] =
    await Promise.all([
      pool.query(categoryBreakdownSql, [
        businessId,
        startDate,
        endDate,
        "revenue",
      ]),
      pool.query(categoryBreakdownSql, [
        businessId,
        startDate,
        endDate,
        "expense",
      ]),
      pool.query(trendSql, [businessId, startDate, endDate]),
      pool.query(fxSummarySql, [businessId, startDate, endDate]),
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

  return {
    income_categories: incomeCategories,
    expense_categories: expenseCategories,
    total_income: parseFloat(totalIncome.toFixed(2)),
    total_expenses: parseFloat(totalExpenses.toFixed(2)),
    net_income: parseFloat((totalIncome - totalExpenses).toFixed(2)),
    monthly_trend: trendResult.rows,
    fx_currencies: fxResult.rows,
  };
}

// ── GET /api/reports/pl ───────────────────────────────────────
// Profit & Loss report: income/expense by category + monthly trend
router.get("/pl", async (req, res) => {
  const { businessId } = req.user;
  const startDate = req.query.startDate || monthStartStr();
  const endDate = req.query.endDate || todayStr();

  try {
    return res.json(await getPlData(businessId, startDate, endDate));
  } catch (err) {
    console.error("P&L report error:", err);
    return res.status(500).json({ error: "Failed to generate report" });
  }
});

// ── GET /api/reports/pl/pdf ──────────────────────────────────
// Server-side P&L PDF (Phase 3 — replaces window.print()).
router.get("/pl/pdf", requireFeature("pdf_reports"), async (req, res) => {
  const { businessId } = req.user;
  const startDate = req.query.startDate || monthStartStr();
  const endDate = req.query.endDate || todayStr();
  const lang = req.query.lang === "es" ? "es" : "en";

  try {
    const [data, business] = await Promise.all([
      getPlData(businessId, startDate, endDate),
      fetchBusiness(businessId),
    ]);
    const pdf = await buildPlPdf(data, business, { startDate, endDate, lang });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="profit-loss-${startDate}-to-${endDate}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    console.error("P&L PDF error:", err);
    return res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ── Cash-flow data (direct method; shared by JSON and PDF) ───
// "Cash" = the system Cash account plus the COA twin of every operational
// bank account. Double-entry means debits and credits balance per entry, so
// for entries that touch cash, each NON-cash line's (credit − debit) is
// exactly its contribution to the cash movement — the counterpart lines
// explain where cash came from and where it went.
const CASH_ACCOUNTS_SQL = `
  SELECT id FROM chart_of_accounts
  WHERE business_id = $1
    AND (name_key = 'coa.accounts.cash'
         OR id IN (SELECT coa_account_id FROM accounts
                   WHERE business_id = $1 AND coa_account_id IS NOT NULL))
`;

// Sections: revenue/expense and day-to-day system asset/liability accounts
// are operating; custom asset accounts (equipment etc.) are investing;
// equity and custom liabilities (loans) are financing.
function cashFlowSection(row) {
  if (row.account_type === "equity") return "financing";
  if (row.account_type === "asset")
    return row.is_system ? "operating" : "investing";
  if (row.account_type === "liability")
    return row.is_system ? "operating" : "financing";
  return "operating";
}

async function getCashFlowData(businessId, startDate, endDate) {
  const flowsSql = `
    WITH cash_accounts AS (${CASH_ACCOUNTS_SQL}),
    cash_entries AS (
      SELECT DISTINCT jel.journal_entry_id AS id
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.business_id = $1
        AND je.entry_date >= $2::date
        AND je.entry_date <= $3::date
        AND jel.account_id IN (SELECT id FROM cash_accounts)
    )
    SELECT
      coa.id       AS account_id,
      coa.name_key AS account_name_key,
      coa.name     AS account_name,
      coa.color    AS account_color,
      coa.account_type,
      coa.is_system,
      SUM(jel.credit - jel.debit)::NUMERIC(12,2) AS cash_effect
    FROM journal_entry_lines jel
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE jel.journal_entry_id IN (SELECT id FROM cash_entries)
      AND jel.account_id NOT IN (SELECT id FROM cash_accounts)
    GROUP BY coa.id, coa.name_key, coa.name, coa.color,
             coa.account_type, coa.is_system
    HAVING SUM(jel.credit - jel.debit) <> 0
    ORDER BY SUM(jel.credit - jel.debit) DESC
  `;

  const beginningSql = `
    WITH cash_accounts AS (${CASH_ACCOUNTS_SQL})
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::NUMERIC(12,2) AS balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = $1
      AND je.entry_date < $2::date
      AND jel.account_id IN (SELECT id FROM cash_accounts)
  `;

  const [flowsResult, beginningResult] = await Promise.all([
    pool.query(flowsSql, [businessId, startDate, endDate]),
    pool.query(beginningSql, [businessId, startDate]),
  ]);

  const sections = { operating: [], investing: [], financing: [] };
  for (const row of flowsResult.rows) {
    sections[cashFlowSection(row)].push(row);
  }
  const sum = (rows) =>
    parseFloat(
      rows.reduce((s, r) => s + parseFloat(r.cash_effect), 0).toFixed(2),
    );

  const totals = {
    operating: sum(sections.operating),
    investing: sum(sections.investing),
    financing: sum(sections.financing),
  };
  const netChange = parseFloat(
    (totals.operating + totals.investing + totals.financing).toFixed(2),
  );
  const beginningCash = parseFloat(beginningResult.rows[0].balance);

  return {
    beginning_cash: beginningCash,
    net_change: netChange,
    ending_cash: parseFloat((beginningCash + netChange).toFixed(2)),
    operating: { rows: sections.operating, total: totals.operating },
    investing: { rows: sections.investing, total: totals.investing },
    financing: { rows: sections.financing, total: totals.financing },
  };
}

// ── GET /api/reports/cash-flow ───────────────────────────────
router.get(
  "/cash-flow",
  requireFeature("advanced_reports"),
  async (req, res) => {
    const { businessId } = req.user;
    const startDate = req.query.startDate || monthStartStr();
    const endDate = req.query.endDate || todayStr();

    try {
      return res.json(await getCashFlowData(businessId, startDate, endDate));
    } catch (err) {
      console.error("Cash-flow report error:", err);
      return res.status(500).json({ error: "Failed to generate report" });
    }
  },
);

// ── GET /api/reports/cash-flow/pdf ───────────────────────────
router.get(
  "/cash-flow/pdf",
  requireFeature("advanced_reports"),
  async (req, res) => {
    const { businessId } = req.user;
    const startDate = req.query.startDate || monthStartStr();
    const endDate = req.query.endDate || todayStr();
    const lang = req.query.lang === "es" ? "es" : "en";

    try {
      const [data, business] = await Promise.all([
        getCashFlowData(businessId, startDate, endDate),
        fetchBusiness(businessId),
      ]);
      const pdf = await buildCashFlowPdf(data, business, {
        startDate,
        endDate,
        lang,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="cash-flow-${startDate}-to-${endDate}.pdf"`,
      );
      return res.send(pdf);
    } catch (err) {
      console.error("Cash-flow PDF error:", err);
      return res.status(500).json({ error: "Failed to generate PDF" });
    }
  },
);

// ── Tax-summary data (shared by the JSON and PDF endpoints) ──
async function getTaxData(businessId, year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Category breakdown from the ledger: sum journal-line activity per
  // chart-of-accounts account. $4 is the account_type ('revenue' or 'expense').
  // Revenue is naturally a credit, expense a debit — normalize to positive.
  const categoryBreakdownSql = `
    SELECT
      coa.id       AS category_id,
      coa.name_key AS category_name_key,
      coa.name     AS category_name,
      coa.color    AS category_color,
      SUM(CASE WHEN coa.account_type = 'revenue'
               THEN jel.credit - jel.debit
               ELSE jel.debit - jel.credit END)::NUMERIC(12,2) AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.business_id = $1
      AND je.entry_date >= $2::date
      AND je.entry_date <= $3::date
      AND coa.account_type = $4
    GROUP BY coa.id, coa.name_key, coa.name, coa.color
    HAVING SUM(CASE WHEN coa.account_type = 'revenue'
               THEN jel.credit - jel.debit
               ELSE jel.debit - jel.credit END) <> 0
    ORDER BY total DESC
  `;

  // Payroll v2 (ROADMAP-V5): reversal-aware sums matched to the
  // business's current payroll mode. federal_tax is structurally 0 —
  // the PR engine has no federal income tax path.
  const payrollTaxSql = `
    WITH signed AS (
      SELECT l.id, l.employee_id, r.id AS run_id, r.reversal_of,
             CASE WHEN r.reversal_of IS NULL THEN 1 ELSE -1 END AS sign,
             l.gross_cents, l.net_cents
      FROM pay_lines l
      JOIN payroll_runs_v2 r ON r.id = l.payroll_run_id
      JOIN pay_periods p ON p.id = r.pay_period_id
      WHERE r.business_id = $1
        AND r.status IN ('finalized', 'reversed')
        AND r.run_mode = (SELECT payroll_mode FROM businesses b WHERE b.id = $1)
        AND EXTRACT(YEAR FROM p.pay_date) = $2
    ),
    item_sums AS (
      SELECT
        COALESCE(SUM(CASE WHEN i.code = 'social_security' THEN s.sign * i.amount_cents END), 0) AS ss,
        COALESCE(SUM(CASE WHEN i.code IN ('medicare', 'medicare_additional') THEN s.sign * i.amount_cents END), 0) AS medicare,
        COALESCE(SUM(CASE WHEN i.code = 'pr_income_tax' THEN s.sign * i.amount_cents END), 0) AS pr_tax,
        COALESCE(SUM(CASE WHEN i.item_type = 'employee_deduction'
                          AND i.code NOT IN ('social_security', 'medicare', 'medicare_additional', 'pr_income_tax')
                          THEN s.sign * i.amount_cents END), 0) AS other_ded
      FROM pay_items i JOIN signed s ON s.id = i.pay_line_id
    )
    SELECT
      (COALESCE(SUM(s.sign * s.gross_cents), 0)::NUMERIC / 100)::NUMERIC(12,2) AS total_gross,
      0::NUMERIC(12,2)                                                          AS total_federal_tax,
      ((SELECT ss FROM item_sums)::NUMERIC / 100)::NUMERIC(12,2)                AS total_social_security,
      ((SELECT medicare FROM item_sums)::NUMERIC / 100)::NUMERIC(12,2)          AS total_medicare,
      ((SELECT pr_tax FROM item_sums)::NUMERIC / 100)::NUMERIC(12,2)            AS total_pr_state_tax,
      ((SELECT other_ded FROM item_sums)::NUMERIC / 100)::NUMERIC(12,2)         AS total_other_deductions,
      (COALESCE(SUM(s.sign * s.net_cents), 0)::NUMERIC / 100)::NUMERIC(12,2)    AS total_net_pay,
      COUNT(DISTINCT s.employee_id)                                             AS employee_count,
      COUNT(DISTINCT CASE WHEN s.reversal_of IS NULL THEN s.run_id END)         AS run_count
    FROM signed s
  `;

  const quarterSql = `
    SELECT
      EXTRACT(QUARTER FROM je.entry_date)::INT AS quarter,
      SUM(CASE WHEN coa.account_type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END)::NUMERIC(12,2) AS income,
      SUM(CASE WHEN coa.account_type = 'expense' THEN jel.debit - jel.credit ELSE 0 END)::NUMERIC(12,2) AS expenses
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.business_id = $1
      AND coa.account_type IN ('revenue', 'expense')
      AND EXTRACT(YEAR FROM je.entry_date) = $2
    GROUP BY EXTRACT(QUARTER FROM je.entry_date)
    ORDER BY quarter ASC
  `;

  const [incomeResult, expenseResult, payrollResult, quarterResult] =
    await Promise.all([
      pool.query(categoryBreakdownSql, [
        businessId,
        startDate,
        endDate,
        "revenue",
      ]),
      pool.query(categoryBreakdownSql, [
        businessId,
        startDate,
        endDate,
        "expense",
      ]),
      pool.query(payrollTaxSql, [businessId, year]),
      pool.query(quarterSql, [businessId, year]),
    ]);

  const incomeCategories = incomeResult.rows;
  const expenseCategories = expenseResult.rows;
  const totalIncome = incomeCategories.reduce(
    (s, r) => s + parseFloat(r.total),
    0,
  );
  const totalExpenses = expenseCategories.reduce(
    (s, r) => s + parseFloat(r.total),
    0,
  );

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

  return {
    year,
    income_categories: incomeCategories,
    expense_categories: expenseCategories,
    total_income: parseFloat(totalIncome.toFixed(2)),
    total_expenses: parseFloat(totalExpenses.toFixed(2)),
    net_income: parseFloat((totalIncome - totalExpenses).toFixed(2)),
    payroll: payrollResult.rows[0],
    quarterly,
  };
}

// ── GET /api/reports/tax ─────────────────────────────────────
// Tax summary report: income/expense by category + payroll taxes + quarterly
router.get("/tax", async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  try {
    return res.json(await getTaxData(businessId, year));
  } catch (err) {
    console.error("Tax summary report error:", err);
    return res.status(500).json({ error: "Failed to generate tax report" });
  }
});

// ── GET /api/reports/tax/pdf ─────────────────────────────────
// Server-side Tax Summary PDF (Phase 3 — replaces window.print()).
router.get("/tax/pdf", requireFeature("pdf_reports"), async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const lang = req.query.lang === "es" ? "es" : "en";

  try {
    const [data, business] = await Promise.all([
      getTaxData(businessId, year),
      fetchBusiness(businessId),
    ]);
    const pdf = await buildTaxPdf(data, business, { lang });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tax-summary-${year}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    console.error("Tax summary PDF error:", err);
    return res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ── Accounts Receivable (#13) ────────────────────────────────
// Outstanding = invoices still owed: status IN ('sent','overdue'). Their total
// equals the Accounts Receivable balance on the ledger (DR AR on send, CR AR on
// pay), so these reports tie out to the balance sheet. Aging is measured from
// the due date as of today; "current" means not yet past due.
const AR_OUTSTANDING_STATUSES = "('sent', 'overdue')";

// Map a days-overdue count to its aging bucket key.
function agingBucket(daysOverdue) {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

const EMPTY_BUCKETS = () => ({
  current: { count: 0, total: 0 },
  d1_30: { count: 0, total: 0 },
  d31_60: { count: 0, total: 0 },
  d61_90: { count: 0, total: 0 },
  d90_plus: { count: 0, total: 0 },
});

// ── GET /api/reports/ar-aging ────────────────────────────────
// Aging buckets + the underlying outstanding invoices (each with days_overdue
// and its bucket), so the UI can render both the summary and an overdue list.
router.get("/ar-aging", requireFeature("invoicing"), async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT
         i.id, i.invoice_number, i.client_id, i.issue_date, i.due_date,
         i.total::NUMERIC(12,2) AS total,
         c.name AS client_name,
         GREATEST(0, (CURRENT_DATE - i.due_date))::int AS days_overdue
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       WHERE i.business_id = $1
         AND i.status IN ${AR_OUTSTANDING_STATUSES}
       ORDER BY i.due_date ASC`,
      [businessId],
    );

    const buckets = EMPTY_BUCKETS();
    let totalOutstanding = 0;
    let totalOverdue = 0;

    const invoices = result.rows.map((r) => {
      const total = parseFloat(r.total);
      const bucket = agingBucket(r.days_overdue);
      buckets[bucket].count += 1;
      buckets[bucket].total += total;
      totalOutstanding += total;
      if (r.days_overdue > 0) totalOverdue += total;
      return { ...r, total, bucket };
    });

    // Round bucket totals to cents after accumulation.
    for (const b of Object.values(buckets)) {
      b.total = parseFloat(b.total.toFixed(2));
    }

    return res.json({
      as_of: todayStr(),
      buckets,
      total_outstanding: parseFloat(totalOutstanding.toFixed(2)),
      total_overdue: parseFloat(totalOverdue.toFixed(2)),
      invoice_count: invoices.length,
      invoices,
    });
  } catch (err) {
    console.error("AR aging report error:", err);
    return res
      .status(500)
      .json({ error: "Failed to generate AR aging report" });
  }
});

// ── GET /api/reports/ar-summary ──────────────────────────────
// Total outstanding by client, with the same aging buckets per client.
router.get("/ar-summary", requireFeature("invoicing"), async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT
         c.id   AS client_id,
         c.name AS client_name,
         COUNT(*)::int AS invoice_count,
         SUM(i.total)::NUMERIC(12,2) AS total,
         SUM(CASE WHEN i.due_date >= CURRENT_DATE THEN i.total ELSE 0 END)::NUMERIC(12,2) AS current,
         SUM(CASE WHEN (CURRENT_DATE - i.due_date) BETWEEN 1 AND 30  THEN i.total ELSE 0 END)::NUMERIC(12,2) AS d1_30,
         SUM(CASE WHEN (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60 THEN i.total ELSE 0 END)::NUMERIC(12,2) AS d31_60,
         SUM(CASE WHEN (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90 THEN i.total ELSE 0 END)::NUMERIC(12,2) AS d61_90,
         SUM(CASE WHEN (CURRENT_DATE - i.due_date) > 90 THEN i.total ELSE 0 END)::NUMERIC(12,2) AS d90_plus
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       WHERE i.business_id = $1
         AND i.status IN ${AR_OUTSTANDING_STATUSES}
       GROUP BY c.id, c.name
       ORDER BY total DESC`,
      [businessId],
    );

    const clients = result.rows.map((r) => ({
      client_id: r.client_id,
      client_name: r.client_name,
      invoice_count: r.invoice_count,
      current: parseFloat(r.current),
      d1_30: parseFloat(r.d1_30),
      d31_60: parseFloat(r.d31_60),
      d61_90: parseFloat(r.d61_90),
      d90_plus: parseFloat(r.d90_plus),
      total: parseFloat(r.total),
    }));

    const totalOutstanding = clients.reduce((s, c) => s + c.total, 0);

    return res.json({
      as_of: todayStr(),
      total_outstanding: parseFloat(totalOutstanding.toFixed(2)),
      clients,
    });
  } catch (err) {
    console.error("AR summary report error:", err);
    return res
      .status(500)
      .json({ error: "Failed to generate AR summary report" });
  }
});

// ── 1099 filing prep (#15) ───────────────────────────────────
// A vendor must be filed a 1099-NEC when it's flagged 1099-eligible AND it was
// paid at least the IRS threshold ($600) in the tax year. Filing also needs a
// complete recipient record — TIN + mailing address — so we surface which
// fields are missing and hard-block the CSV export until they're filled.
const THRESHOLD_1099 = 600;
const REQUIRED_1099_FIELDS = ["ein", "address", "city", "state", "zip"];

// TIN requirement depends on the payee type (§2.4): entities need an EIN,
// individuals an SSN on file (stored encrypted; presence = ssn_encrypted).
function missing1099Fields(v) {
  return REQUIRED_1099_FIELDS.filter((f) => {
    if (f === "ein") {
      return v.payee_type === "individual"
        ? !v.ssn_encrypted
        : v.ein == null || String(v.ein).trim() === "";
    }
    return v[f] == null || String(v[f]).trim() === "";
  }).map((f) => (f === "ein" && v.payee_type === "individual" ? "ssn" : f));
}

// Per-vendor expense totals for 1099-eligible vendors in a tax year. The "paid"
// figure is the sum of expense transactions tagged to the vendor (vendor_id).
async function fetch1099Vendors(businessId, year) {
  const result = await pool.query(
    `SELECT
       v.id, v.name, v.ein, v.payee_type, v.ssn_encrypted, v.ssn_last4,
       v.address, v.city, v.state, v.zip, v.email, v.phone,
       COALESCE(SUM(t.total_amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS total_paid,
       COUNT(t.id) FILTER (WHERE t.type = 'expense')::int AS payment_count
     FROM vendors v
     LEFT JOIN transactions t ON t.vendor_id = v.id
       AND t.business_id = $1
       AND EXTRACT(YEAR FROM t.date) = $2
     WHERE v.business_id = $1 AND v.is_1099_eligible = TRUE
     GROUP BY v.id
     ORDER BY total_paid DESC`,
    [businessId, year],
  );
  return result.rows.map((v) => {
    const total = parseFloat(v.total_paid);
    const { ssn_encrypted, ssn_last4, ...pub } = v;
    return {
      ...pub,
      ssn_last4: ssn_last4 ? `***-**-${ssn_last4}` : null,
      has_ssn: Boolean(ssn_encrypted),
      total_paid: total,
      flagged: total >= THRESHOLD_1099,
      missing_fields: missing1099Fields(v),
    };
  });
}

// Quote a CSV cell only when it contains a delimiter, quote, or newline.
function csvCell(val) {
  const s = val == null ? "" : String(val);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── GET /api/reports/1099?year= ──────────────────────────────
// 1099-NEC prep: eligible vendors, who crosses the $600 threshold, and which
// flagged vendors are missing required recipient fields (blocks export).
router.get("/1099", requireFeature("vendors"), async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const vendors = await fetch1099Vendors(businessId, year);
    const flagged = vendors.filter((v) => v.flagged);
    const incomplete = flagged.filter((v) => v.missing_fields.length > 0);
    const totalReportable = flagged.reduce((s, v) => s + v.total_paid, 0);

    return res.json({
      year,
      threshold: THRESHOLD_1099,
      vendors,
      eligible_count: vendors.length,
      flagged_count: flagged.length,
      incomplete_count: incomplete.length,
      total_reportable: parseFloat(totalReportable.toFixed(2)),
    });
  } catch (err) {
    console.error("1099 report error:", err);
    return res.status(500).json({ error: "Failed to generate 1099 report" });
  }
});

// ── GET /api/reports/1099/export?year= ───────────────────────
// CSV in 1099-NEC recipient layout, flagged vendors only. Blocks (422) if any
// flagged vendor is missing required fields, returning the offenders so the UI
// can point the owner at exactly what to fix.
router.get("/1099/export", requireFeature("vendors"), async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const vendors = await fetch1099Vendors(businessId, year);
    const flagged = vendors.filter((v) => v.flagged);

    if (flagged.length === 0) {
      return res.status(422).json({
        error: `No vendors reached the $${THRESHOLD_1099} threshold in ${year}.`,
      });
    }

    const incomplete = flagged
      .filter((v) => v.missing_fields.length > 0)
      .map((v) => ({
        id: v.id,
        name: v.name,
        missing_fields: v.missing_fields,
      }));
    if (incomplete.length > 0) {
      return res.status(422).json({
        error:
          "Some vendors over the threshold are missing required 1099 fields. Complete them before exporting.",
        incomplete,
      });
    }

    const header = [
      "Recipient Name",
      "Recipient TIN",
      "Street Address",
      "City",
      "State",
      "ZIP",
      "Box 1 Nonemployee Compensation",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const v of flagged) {
      lines.push(
        [
          v.name,
          v.ein,
          v.address,
          v.city,
          v.state,
          v.zip,
          v.total_paid.toFixed(2),
        ]
          .map(csvCell)
          .join(","),
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="1099-nec-${year}.csv"`,
    );
    return res.send(lines.join("\r\n"));
  } catch (err) {
    console.error("1099 export error:", err);
    return res.status(500).json({ error: "Failed to export 1099 report" });
  }
});

// ── Hacienda 480.6SP — Services Rendered (#16) ───────────────
// Puerto Rico's annual informative return for service payments to vendors,
// split between amounts subject and not subject to §1062.03 withholding. PR's
// reporting threshold is $500 (vs the US $600). This is PREP data for the
// owner's accountant to file via SURI by Feb 28 — not a filed return. The
// payer (informante) block needs the business EIN + address; the recipient
// block reuses the same required vendor fields as the 1099 report.
const THRESHOLD_480SP = 500;
const REQUIRED_PAYER_FIELDS = ["tax_id", "address", "city", "state", "zip"];

function missingPayerFields(biz) {
  return REQUIRED_PAYER_FIELDS.filter(
    (f) => biz?.[f] == null || String(biz[f]).trim() === "",
  );
}

// Per-vendor service totals for 480.6SP: gross paid, the portion subject to
// withholding (any payment with withholding_amount > 0), tax withheld, and the
// remainder (not subject). Same eligibility flag as the 1099 report.
async function fetch480spVendors(businessId, year) {
  const result = await pool.query(
    `SELECT
       v.id, v.name, v.ein, v.payee_type, v.ssn_encrypted, v.ssn_last4,
       v.address, v.city, v.state, v.zip,
       v.waiver_certificate_no,
       COALESCE(SUM(t.total_amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS gross_paid,
       COALESCE(SUM(t.withholding_amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS withheld,
       COALESCE(SUM(t.total_amount) FILTER (WHERE t.type = 'expense' AND t.withholding_amount > 0), 0)::numeric AS subject,
       COUNT(t.id) FILTER (WHERE t.type = 'expense')::int AS payment_count
     FROM vendors v
     LEFT JOIN transactions t ON t.vendor_id = v.id
       AND t.business_id = $1
       AND EXTRACT(YEAR FROM t.date) = $2
     WHERE v.business_id = $1 AND v.is_1099_eligible = TRUE
     GROUP BY v.id
     ORDER BY gross_paid DESC`,
    [businessId, year],
  );
  return result.rows.map((v) => {
    const gross = parseFloat(v.gross_paid);
    const subject = parseFloat(v.subject);
    return {
      ...v,
      gross_paid: gross,
      withheld: parseFloat(v.withheld),
      subject,
      not_subject: parseFloat((gross - subject).toFixed(2)),
      flagged: gross >= THRESHOLD_480SP,
      missing_fields: missing1099Fields(v),
    };
  });
}

// Strip SSN ciphertext and mask the last-4 before a vendor row leaves the
// API (the SURI e-file builder is the only consumer of the ciphertext).
function present480spVendor(v) {
  const { ssn_encrypted, ssn_last4, ...pub } = v;
  return {
    ...pub,
    ssn_last4: ssn_last4 ? `***-**-${ssn_last4}` : null,
    has_ssn: Boolean(ssn_encrypted),
  };
}

async function fetchPayer(businessId) {
  const r = await pool.query(
    `SELECT name, tax_id, address, city, state, zip FROM businesses WHERE id = $1`,
    [businessId],
  );
  return r.rows[0] || null;
}

// ── Withholding remittance (§1062.03) ────────────────────────
// The services-withholding liability accrues as credits when expense
// transactions withhold; remitting to Hacienda posts debit liability /
// credit cash. Quarterly view = the data for Form 480.6SP-1.
const WITHHOLDING_KEY = "coa.accounts.services_withholding_payable";

async function withholdingAccountId(businessId) {
  const r = await pool.query(
    "SELECT id FROM chart_of_accounts WHERE business_id = $1 AND name_key = $2",
    [businessId, WITHHOLDING_KEY],
  );
  return r.rows[0]?.id || null;
}

// GET /api/reports/withholding-summary?year=
router.get(
  "/withholding-summary",
  requireFeature("hacienda"),
  async (req, res) => {
    const { businessId } = req.user;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    try {
      const accountId = await withholdingAccountId(businessId);
      if (!accountId) {
        return res
          .status(404)
          .json({ error: "Withholding liability account not found" });
      }

      const [byQuarter, allTime] = await Promise.all([
        pool.query(
          `SELECT EXTRACT(QUARTER FROM je.entry_date)::int AS quarter,
                  COALESCE(SUM(jel.credit), 0)::NUMERIC(12,2) AS withheld,
                  COALESCE(SUM(jel.debit), 0)::NUMERIC(12,2) AS remitted
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.business_id = $1 AND jel.account_id = $2
             AND je.entry_date >= $3::date AND je.entry_date <= $4::date
           GROUP BY 1 ORDER BY 1`,
          [businessId, accountId, `${year}-01-01`, `${year}-12-31`],
        ),
        pool.query(
          `SELECT COALESCE(SUM(jel.credit - jel.debit), 0)::NUMERIC(12,2)
             AS balance
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE je.business_id = $1 AND jel.account_id = $2`,
          [businessId, accountId],
        ),
      ]);

      const quarters = [1, 2, 3, 4].map((q) => {
        const row = byQuarter.rows.find((r) => r.quarter === q);
        return {
          quarter: q,
          withheld: parseFloat(row?.withheld || 0),
          remitted: parseFloat(row?.remitted || 0),
        };
      });
      return res.json({
        year,
        quarters,
        total_withheld: parseFloat(
          quarters.reduce((s, q) => s + q.withheld, 0).toFixed(2),
        ),
        total_remitted: parseFloat(
          quarters.reduce((s, q) => s + q.remitted, 0).toFixed(2),
        ),
        balance_due: parseFloat(allTime.rows[0].balance),
      });
    } catch (err) {
      console.error("Withholding summary error:", err);
      return res.status(500).json({ error: "Failed to load summary" });
    }
  },
);

// POST /api/reports/withholding-remit { date, amount, fundingCoaId }
// Ledger-funded only: paying from an operational bank account would need
// its separately-tracked balance updated too — out of scope for v1.
router.post(
  "/withholding-remit",
  requireFeature("hacienda"),
  async (req, res) => {
    const { businessId, userId } = req.user;
    const { date, amount, fundingCoaId } = req.body;
    const amt = parseFloat(amount);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    }
    if (!(amt > 0)) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }
    if (!fundingCoaId) {
      return res
        .status(400)
        .json({ error: "fundingCoaId (a ledger asset account) is required" });
    }

    const client = await pool.connect();
    try {
      const withholdingId = await withholdingAccountId(businessId);
      const funding = await client.query(
        `SELECT id FROM chart_of_accounts
         WHERE id = $1 AND business_id = $2 AND account_type = 'asset'`,
        [fundingCoaId, businessId],
      );
      if (!withholdingId || funding.rowCount === 0) {
        return res.status(400).json({ error: "Invalid funding account" });
      }

      await client.query("BEGIN");
      const entry = await postJournalEntry(client, {
        businessId,
        date,
        description: "Withholding remittance to Hacienda (§1062.03)",
        sourceType: "withholding_remittance",
        createdBy: userId,
        lines: [
          { accountId: withholdingId, debit: amt },
          { accountId: fundingCoaId, credit: amt },
        ],
      });
      await client.query("COMMIT");
      return res.status(201).json({ ok: true, entryId: entry.id });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Withholding remit error:", err);
      return res.status(500).json({ error: "Failed to record remittance" });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/reports/480-6sp?year= ───────────────────────────
router.get("/480-6sp", requireFeature("hacienda"), async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const [vendors, payer] = await Promise.all([
      fetch480spVendors(businessId, year),
      fetchPayer(businessId),
    ]);
    const flagged = vendors.filter((v) => v.flagged);
    const incomplete = flagged.filter((v) => v.missing_fields.length > 0);
    const payerMissing = missingPayerFields(payer);

    const totals = flagged.reduce(
      (acc, v) => ({
        gross: acc.gross + v.gross_paid,
        subject: acc.subject + v.subject,
        withheld: acc.withheld + v.withheld,
        not_subject: acc.not_subject + v.not_subject,
      }),
      { gross: 0, subject: 0, withheld: 0, not_subject: 0 },
    );
    for (const k of Object.keys(totals)) {
      totals[k] = parseFloat(totals[k].toFixed(2));
    }

    return res.json({
      year,
      threshold: THRESHOLD_480SP,
      payer: {
        name: payer?.name || null,
        ein: payer?.tax_id || null,
        address: payer?.address || null,
        city: payer?.city || null,
        state: payer?.state || null,
        zip: payer?.zip || null,
        complete: payerMissing.length === 0,
        missing_fields: payerMissing,
      },
      vendors: vendors.map(present480spVendor),
      eligible_count: vendors.length,
      flagged_count: flagged.length,
      incomplete_count: incomplete.length,
      totals,
    });
  } catch (err) {
    console.error("480.6SP report error:", err);
    return res.status(500).json({ error: "Failed to generate 480.6SP report" });
  }
});

// ── GET /api/reports/480-6sp/suri?year=&controlStart= ────────
// SURI bulk-filing text file per Pub 25-03 (see services/suriFile.js).
// Same completeness guards as the CSV export, plus the Treasury-assigned
// starting control number the filer obtained in SURI.
router.get("/480-6sp/suri", requireFeature("hacienda"), async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const controlStart = parseInt(req.query.controlStart, 10);

  if (!(controlStart >= 1 && controlStart <= 999999999)) {
    return res.status(400).json({
      error:
        "controlStart is required — the first control number of the range assigned by Hacienda in SURI (up to 9 digits).",
    });
  }

  try {
    const [vendors, payer] = await Promise.all([
      fetch480spVendors(businessId, year),
      fetchPayer(businessId),
    ]);
    const flagged = vendors.filter((v) => v.flagged);

    if (flagged.length === 0) {
      return res.status(422).json({
        error: `No vendors reached the $${THRESHOLD_480SP} threshold in ${year}.`,
      });
    }
    const payerMissing = missingPayerFields(payer);
    if (payerMissing.length > 0) {
      return res.status(422).json({
        error:
          "Your business (payer) profile is missing required 480.6SP fields. Complete it before exporting.",
        payer_missing: payerMissing,
      });
    }
    const incomplete = flagged
      .filter((v) => v.missing_fields.length > 0)
      .map((v) => ({
        id: v.id,
        name: v.name,
        missing_fields: v.missing_fields,
      }));
    if (incomplete.length > 0) {
      return res.status(422).json({
        error:
          "Some vendors over the threshold are missing required 480.6SP fields. Complete them before exporting.",
        incomplete,
      });
    }

    const owner = await pool.query(
      `SELECT email FROM users
       WHERE business_id = $1 AND role = 'owner' AND is_active
       ORDER BY created_at ASC LIMIT 1`,
      [businessId],
    );

    // Individual payees file under their SSN — decrypted here, straight
    // into the e-file, never logged (same discipline as the W-2PR route).
    const withSsn = flagged.map((v) => {
      let ssn = null;
      if (v.payee_type === "individual" && v.ssn_encrypted) {
        try {
          ssn = decryptField(v.ssn_encrypted);
        } catch {
          ssn = null;
        }
      }
      return { ...v, ssn };
    });

    const { content, filename } = buildSuriFile({
      payer,
      vendors: withSsn,
      year,
      controlStart,
      contactEmail: owner.rows[0]?.email || "",
    });

    // SSN-bearing download — explicit audit row (the auto middleware only
    // covers mutations, and GET downloads would otherwise leave no trace).
    const ssnCount = withSsn.filter((v) => v.ssn).length;
    if (ssnCount > 0) {
      try {
        await pool.query(
          `INSERT INTO audit_log
             (business_id, user_id, user_name, action, entity_type, summary, snapshot)
           VALUES ($1, $2, (SELECT name FROM users WHERE id = $2),
                   'export', 'reports', $3, $4)`,
          [
            businessId,
            req.user.userId,
            `480.6SP SURI file ${year}`,
            JSON.stringify({ ssn_count: ssnCount }),
          ],
        );
      } catch (auditErr) {
        console.error("SURI export audit write error:", auditErr.message);
      }
    }

    res.setHeader("Content-Type", "text/plain; charset=ascii");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(content);
  } catch (err) {
    console.error("480.6SP SURI export error:", err);
    return res.status(500).json({ error: "Failed to generate SURI file" });
  }
});

// ── GET /api/reports/480-6sp/export?year= ────────────────────
// CSV in 480.6SP recipient layout, flagged vendors only. Blocks (422) if the
// payer block is incomplete or any flagged vendor is missing required fields.
router.get("/480-6sp/export", requireFeature("hacienda"), async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  try {
    const [vendors, payer] = await Promise.all([
      fetch480spVendors(businessId, year),
      fetchPayer(businessId),
    ]);
    const flagged = vendors.filter((v) => v.flagged);

    if (flagged.length === 0) {
      return res.status(422).json({
        error: `No vendors reached the $${THRESHOLD_480SP} threshold in ${year}.`,
      });
    }

    const payerMissing = missingPayerFields(payer);
    if (payerMissing.length > 0) {
      return res.status(422).json({
        error:
          "Your business (payer) profile is missing required 480.6SP fields. Complete it before exporting.",
        payer_missing: payerMissing,
      });
    }

    const incomplete = flagged
      .filter((v) => v.missing_fields.length > 0)
      .map((v) => ({
        id: v.id,
        name: v.name,
        missing_fields: v.missing_fields,
      }));
    if (incomplete.length > 0) {
      return res.status(422).json({
        error:
          "Some vendors over the threshold are missing required 480.6SP fields. Complete them before exporting.",
        incomplete,
      });
    }

    const header = [
      "Payer Name",
      "Payer EIN",
      "Recipient Name",
      "Recipient TIN",
      "Street Address",
      "City",
      "State",
      "ZIP",
      "Total Payments",
      "Payments Subject to Withholding",
      "Tax Withheld",
      "Payments Not Subject to Withholding",
      "Waiver Certificate No",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const v of flagged) {
      lines.push(
        [
          payer.name,
          payer.tax_id,
          v.name,
          // Individuals: masked SSN — the full TIN travels only inside the
          // SURI e-file, never a spreadsheet.
          v.payee_type === "individual"
            ? v.ssn_last4
              ? `***-**-${v.ssn_last4}`
              : ""
            : v.ein,
          v.address,
          v.city,
          v.state,
          v.zip,
          v.gross_paid.toFixed(2),
          v.subject.toFixed(2),
          v.withheld.toFixed(2),
          v.not_subject.toFixed(2),
          v.waiver_certificate_no,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="480-6sp-${year}.csv"`,
    );
    return res.send(lines.join("\r\n"));
  } catch (err) {
    console.error("480.6SP export error:", err);
    return res.status(500).json({ error: "Failed to export 480.6SP report" });
  }
});

// ── IVU mensual (SC 2915) ────────────────────────────────────
// Monthly sales & use tax prep for SURI. Sales figures are accrual-basis
// from invoices (tax_type='ivu', issue_date month, drafts/voids excluded) —
// the same basis the ledger posts on send. Remittances and the running
// balance come from the seeded "IVU por pagar" liability (2200), so manual
// journal entries against it flow into the report too.
const IVU_KEY = "coa.accounts.sales_tax_payable";

async function ivuAccountId(businessId) {
  const r = await pool.query(
    "SELECT id FROM chart_of_accounts WHERE business_id = $1 AND name_key = $2",
    [businessId, IVU_KEY],
  );
  return r.rows[0]?.id || null;
}

// Shared by the JSON and CSV endpoints.
async function getIvuMonths(businessId, accountId, year) {
  const [byMonth, ledgerByMonth] = await Promise.all([
    pool.query(
      `SELECT EXTRACT(MONTH FROM issue_date)::int AS month,
              COALESCE(SUM(subtotal) FILTER (WHERE tax_total > 0 AND tax_muni_rate > 0), 0)::NUMERIC(12,2) AS taxable_sales,
              COALESCE(SUM(subtotal) FILTER (WHERE tax_total > 0 AND tax_muni_rate = 0), 0)::NUMERIC(12,2) AS reduced_sales,
              COALESCE(SUM(subtotal) FILTER (WHERE tax_total = 0), 0)::NUMERIC(12,2) AS exempt_sales,
              COALESCE(SUM(tax_state_total), 0)::NUMERIC(12,2) AS state_tax,
              COALESCE(SUM(tax_muni_total), 0)::NUMERIC(12,2) AS muni_tax,
              COALESCE(SUM(tax_total), 0)::NUMERIC(12,2) AS tax_total
       FROM invoices
       WHERE business_id = $1 AND tax_type = 'ivu'
         AND status IN ('sent', 'paid', 'overdue')
         AND issue_date >= $2::date AND issue_date <= $3::date
       GROUP BY 1`,
      [businessId, `${year}-01-01`, `${year}-12-31`],
    ),
    pool.query(
      `SELECT EXTRACT(MONTH FROM je.entry_date)::int AS month,
              COALESCE(SUM(jel.debit), 0)::NUMERIC(12,2) AS remitted
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE je.business_id = $1 AND jel.account_id = $2
         AND je.entry_date >= $3::date AND je.entry_date <= $4::date
       GROUP BY 1`,
      [businessId, accountId, `${year}-01-01`, `${year}-12-31`],
    ),
  ]);

  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const inv = byMonth.rows.find((r) => r.month === m);
    const led = ledgerByMonth.rows.find((r) => r.month === m);
    return {
      month: m,
      period: `${year}-${String(m).padStart(2, "0")}`,
      taxable_sales: parseFloat(inv?.taxable_sales || 0),
      reduced_sales: parseFloat(inv?.reduced_sales || 0),
      exempt_sales: parseFloat(inv?.exempt_sales || 0),
      state_tax: parseFloat(inv?.state_tax || 0),
      muni_tax: parseFloat(inv?.muni_tax || 0),
      tax_total: parseFloat(inv?.tax_total || 0),
      remitted: parseFloat(led?.remitted || 0),
    };
  });
}

// GET /api/reports/ivu-summary?year=
router.get("/ivu-summary", requireFeature("hacienda"), async (req, res) => {
  const { businessId } = req.user;
  const year =
    parseInt(req.query.year, 10) || Number(todayPR().slice(0, 4));
  try {
    const accountId = await ivuAccountId(businessId);
    if (!accountId) {
      return res
        .status(404)
        .json({ error: "Sales tax (IVU) liability account not found" });
    }

    const [payerRow, months, allTime] = await Promise.all([
      pool.query(
        "SELECT name, merchant_registration_number FROM businesses WHERE id = $1",
        [businessId],
      ),
      getIvuMonths(businessId, accountId, year),
      pool.query(
        `SELECT COALESCE(SUM(jel.credit - jel.debit), 0)::NUMERIC(12,2) AS balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE je.business_id = $1 AND jel.account_id = $2`,
        [businessId, accountId],
      ),
    ]);

    // Refresh the year's SC 2915 due dates (idempotent; statuses survive).
    for (const o of generateIvuSchedule(year)) {
      await pool.query(
        `INSERT INTO compliance_obligations
           (business_id, obligation_type, period_start, period_end, due_date, rule_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (business_id, obligation_type, period_start)
         DO UPDATE SET period_end = EXCLUDED.period_end,
                       due_date = EXCLUDED.due_date,
                       rule_id = EXCLUDED.rule_id`,
        [
          businessId,
          o.obligation_type,
          o.period_start,
          o.period_end,
          o.due_date,
          o.rule_id,
        ],
      );
    }
    // Filter by period (not due date): exactly the 12 months of `year`,
    // so the previous December — due Jan 20 of `year` — can't sneak in.
    const obligations = await pool.query(
      `SELECT * FROM compliance_obligations
       WHERE business_id = $1 AND obligation_type = 'ivu_monthly'
         AND period_start >= $2::date AND period_start <= $3::date
       ORDER BY period_start ASC`,
      [businessId, `${year}-01-01`, `${year}-12-31`],
    );

    const payer = payerRow.rows[0] || {};
    const sum = (key) =>
      parseFloat(months.reduce((s, m) => s + m[key], 0).toFixed(2));
    const today = todayPR();

    return res.json({
      year,
      payer: {
        name: payer.name || "",
        merchant_registration_number:
          payer.merchant_registration_number || null,
        complete: !!payer.merchant_registration_number,
      },
      months,
      totals: {
        taxable_sales: sum("taxable_sales"),
        reduced_sales: sum("reduced_sales"),
        exempt_sales: sum("exempt_sales"),
        state_tax: sum("state_tax"),
        muni_tax: sum("muni_tax"),
        tax_total: sum("tax_total"),
        remitted: sum("remitted"),
      },
      balance_due: parseFloat(allTime.rows[0].balance),
      // pg DATE columns come back as JS Date objects — normalize to
      // 'YYYY-MM-DD' so the client can slice months without tz drift.
      obligations: obligations.rows.map((o) => ({
        ...o,
        period_start: toIso(o.period_start),
        period_end: toIso(o.period_end),
        due_date: toIso(o.due_date),
        display_status: displayStatus(o, today),
      })),
    });
  } catch (err) {
    console.error("IVU summary error:", err);
    return res.status(500).json({ error: "Failed to load IVU summary" });
  }
});

// POST /api/reports/ivu-remit { date, amount, fundingCoaId }
// Records the monthly IVU payment to Hacienda: debit "IVU por pagar" /
// credit a ledger asset account. Ledger-funded only, same as the
// withholding remittance (operational bank balances are tracked separately).
router.post("/ivu-remit", requireFeature("hacienda"), async (req, res) => {
  const { businessId, userId } = req.user;
  const { date, amount, fundingCoaId } = req.body;
  const amt = parseFloat(amount);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
  }
  if (!(amt > 0)) {
    return res.status(400).json({ error: "amount must be greater than 0" });
  }
  if (!fundingCoaId) {
    return res
      .status(400)
      .json({ error: "fundingCoaId (a ledger asset account) is required" });
  }

  const client = await pool.connect();
  try {
    const ivuId = await ivuAccountId(businessId);
    const funding = await client.query(
      `SELECT id FROM chart_of_accounts
       WHERE id = $1 AND business_id = $2 AND account_type = 'asset'`,
      [fundingCoaId, businessId],
    );
    if (!ivuId || funding.rowCount === 0) {
      return res.status(400).json({ error: "Invalid funding account" });
    }

    await client.query("BEGIN");
    const entry = await postJournalEntry(client, {
      businessId,
      date,
      description: "IVU remittance to Hacienda (SC 2915 / SURI)",
      sourceType: "ivu_remittance",
      createdBy: userId,
      lines: [
        { accountId: ivuId, debit: amt },
        { accountId: fundingCoaId, credit: amt },
      ],
    });
    await client.query("COMMIT");
    return res.status(201).json({ ok: true, entryId: entry.id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("IVU remit error:", err);
    return res.status(500).json({ error: "Failed to record IVU payment" });
  } finally {
    client.release();
  }
});

// PUT /api/reports/ivu-calendar/:id/status { done }
// Mark an SC 2915 obligation filed/unfiled. Scoped to ivu_monthly rows so
// this professional-tier route can't touch premium payroll obligations.
router.put(
  "/ivu-calendar/:id/status",
  requireFeature("hacienda"),
  requireRole("owner", "admin"),
  async (req, res) => {
    const { businessId } = req.user;
    const { id } = req.params;
    const done = !!req.body?.done;
    try {
      const r = await pool.query(
        `UPDATE compliance_obligations SET status = $1
         WHERE id = $2 AND business_id = $3 AND obligation_type = 'ivu_monthly'
         RETURNING *`,
        [done ? "done" : "upcoming", id, businessId],
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ error: "Obligation not found" });
      }
      const row = r.rows[0];
      return res.json({ ...row, display_status: displayStatus(row, todayPR()) });
    } catch (err) {
      console.error("IVU calendar status error:", err);
      return res.status(500).json({ error: "Failed to update obligation" });
    }
  },
);

// GET /api/reports/ivu-summary/export?year= — monthly CSV for the accountant.
router.get(
  "/ivu-summary/export",
  requireFeature("hacienda"),
  async (req, res) => {
    const { businessId } = req.user;
    const year =
      parseInt(req.query.year, 10) || Number(todayPR().slice(0, 4));
    try {
      const accountId = await ivuAccountId(businessId);
      if (!accountId) {
        return res
          .status(404)
          .json({ error: "Sales tax (IVU) liability account not found" });
      }
      const months = await getIvuMonths(businessId, accountId, year);
      const hasData = months.some(
        (m) => m.tax_total > 0 || m.exempt_sales > 0 || m.remitted > 0,
      );
      if (!hasData) {
        return res
          .status(422)
          .json({ error: `No IVU activity recorded in ${year}.` });
      }

      const payer = await pool.query(
        "SELECT name, merchant_registration_number FROM businesses WHERE id = $1",
        [businessId],
      );
      const header = [
        "Periodo",
        "Ventas gravadas (tasa combinada)",
        "Ventas 4% (servicios designados)",
        "Ventas exentas",
        "IVU estatal",
        "IVU municipal",
        "IVU total",
        "Pagado",
      ];
      const lines = [
        `Negocio,${csvCell(payer.rows[0]?.name || "")}`,
        `Registro de Comerciante,${csvCell(payer.rows[0]?.merchant_registration_number || "")}`,
        `Año,${year}`,
        "",
        header.map(csvCell).join(","),
        ...months.map((m) =>
          [
            m.period,
            m.taxable_sales.toFixed(2),
            m.reduced_sales.toFixed(2),
            m.exempt_sales.toFixed(2),
            m.state_tax.toFixed(2),
            m.muni_tax.toFixed(2),
            m.tax_total.toFixed(2),
            m.remitted.toFixed(2),
          ]
            .map(csvCell)
            .join(","),
        ),
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ivu-${year}.csv"`,
      );
      return res.send(lines.join("\r\n"));
    } catch (err) {
      console.error("IVU export error:", err);
      return res.status(500).json({ error: "Failed to export IVU summary" });
    }
  },
);

export default router;
