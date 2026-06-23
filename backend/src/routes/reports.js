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

  try {
    const [incomeResult, expenseResult, trendResult, fxResult] = await Promise.all([
      pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "revenue"]),
      pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "expense"]),
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

    return res.json({
      income_categories: incomeCategories,
      expense_categories: expenseCategories,
      total_income: parseFloat(totalIncome.toFixed(2)),
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      net_income: parseFloat((totalIncome - totalExpenses).toFixed(2)),
      monthly_trend: trendResult.rows,
      fx_currencies: fxResult.rows,
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

  try {
    const [incomeResult, expenseResult, payrollResult, quarterResult] =
      await Promise.all([
        pool.query(categoryBreakdownSql, [businessId, startDate, endDate, "revenue"]),
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
router.get("/ar-aging", async (req, res) => {
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
    return res.status(500).json({ error: "Failed to generate AR aging report" });
  }
});

// ── GET /api/reports/ar-summary ──────────────────────────────
// Total outstanding by client, with the same aging buckets per client.
router.get("/ar-summary", async (req, res) => {
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
    return res.status(500).json({ error: "Failed to generate AR summary report" });
  }
});

// ── 1099 filing prep (#15) ───────────────────────────────────
// A vendor must be filed a 1099-NEC when it's flagged 1099-eligible AND it was
// paid at least the IRS threshold ($600) in the tax year. Filing also needs a
// complete recipient record — TIN + mailing address — so we surface which
// fields are missing and hard-block the CSV export until they're filled.
const THRESHOLD_1099 = 600;
const REQUIRED_1099_FIELDS = ["ein", "address", "city", "state", "zip"];

function missing1099Fields(v) {
  return REQUIRED_1099_FIELDS.filter(
    (f) => v[f] == null || String(v[f]).trim() === "",
  );
}

// Per-vendor expense totals for 1099-eligible vendors in a tax year. The "paid"
// figure is the sum of expense transactions tagged to the vendor (vendor_id).
async function fetch1099Vendors(businessId, year) {
  const result = await pool.query(
    `SELECT
       v.id, v.name, v.ein, v.address, v.city, v.state, v.zip, v.email, v.phone,
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
    return {
      ...v,
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
router.get("/1099", async (req, res) => {
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
router.get("/1099/export", async (req, res) => {
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
      .map((v) => ({ id: v.id, name: v.name, missing_fields: v.missing_fields }));
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
        [v.name, v.ein, v.address, v.city, v.state, v.zip, v.total_paid.toFixed(2)]
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
       v.id, v.name, v.ein, v.address, v.city, v.state, v.zip,
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

async function fetchPayer(businessId) {
  const r = await pool.query(
    `SELECT name, tax_id, address, city, state, zip FROM businesses WHERE id = $1`,
    [businessId],
  );
  return r.rows[0] || null;
}

// ── GET /api/reports/480-6sp?year= ───────────────────────────
router.get("/480-6sp", async (req, res) => {
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
      vendors,
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

// ── GET /api/reports/480-6sp/export?year= ────────────────────
// CSV in 480.6SP recipient layout, flagged vendors only. Blocks (422) if the
// payer block is incomplete or any flagged vendor is missing required fields.
router.get("/480-6sp/export", async (req, res) => {
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
      .map((v) => ({ id: v.id, name: v.name, missing_fields: v.missing_fields }));
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
          v.ein,
          v.address,
          v.city,
          v.state,
          v.zip,
          v.gross_paid.toFixed(2),
          v.subject.toFixed(2),
          v.withheld.toFixed(2),
          v.not_subject.toFixed(2),
          v.waiver_certificate_no,
        ].map(csvCell).join(","),
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

export default router;
