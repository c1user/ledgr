/**
 * routes/ledger.js
 *
 * Item 3 (Balance sheet) + the trial balance that proves the ledger.
 * Mount in server.js:  app.use("/api/ledger", ledgerRoutes);
 *
 * Endpoints:
 *   GET /api/ledger/trial-balance?asOf=YYYY-MM-DD
 *       Every account's debit/credit totals. total_debits MUST equal
 *       total_credits — if they don't, the ledger is broken.
 *   GET /api/ledger/balance-sheet?asOf=YYYY-MM-DD
 *       Assets = Liabilities + Equity + current-period earnings.
 *       The `balances` flag is the proof your double-entry posting is correct.
 *   GET /api/ledger/journal?limit=&offset=
 *       Raw journal entries with their lines (for an audit/journal view).
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const EPSILON = 0.005;

// Sum debit/credit per account up to a cutoff date (inclusive).
// asOf is optional; null means "all time".
async function accountTotals(businessId, asOf) {
  const result = await pool.query(
    `SELECT
       coa.id, coa.code, coa.name_key, coa.name, coa.account_type, coa.normal_balance,
       COALESCE(SUM(jel.debit),  0) AS debit_total,
       COALESCE(SUM(jel.credit), 0) AS credit_total
     FROM chart_of_accounts coa
     LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
     LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
       AND ($2::date IS NULL OR je.entry_date <= $2::date)
     WHERE coa.business_id = $1
     GROUP BY coa.id, coa.code, coa.name_key, coa.name, coa.account_type, coa.normal_balance
     ORDER BY coa.code NULLS LAST`,
    [businessId, asOf || null],
  );
  return result.rows.map((r) => ({
    ...r,
    debit_total: Number(r.debit_total),
    credit_total: Number(r.credit_total),
    natural_balance:
      r.normal_balance === "debit"
        ? Number(r.debit_total) - Number(r.credit_total)
        : Number(r.credit_total) - Number(r.debit_total),
  }));
}

// ── GET /api/ledger/trial-balance ────────────────────────────
router.get("/trial-balance", async (req, res) => {
  const { businessId } = req.user;
  const { asOf } = req.query;

  try {
    const accounts = await accountTotals(businessId, asOf);
    const totalDebits = accounts.reduce((s, a) => s + a.debit_total, 0);
    const totalCredits = accounts.reduce((s, a) => s + a.credit_total, 0);

    return res.json({
      as_of: asOf || null,
      accounts: accounts.filter(
        (a) => a.debit_total !== 0 || a.credit_total !== 0,
      ),
      total_debits: Math.round(totalDebits * 100) / 100,
      total_credits: Math.round(totalCredits * 100) / 100,
      balances: Math.abs(totalDebits - totalCredits) < EPSILON,
    });
  } catch (err) {
    console.error("Trial balance error:", err);
    return res.status(500).json({ error: "Failed to compute trial balance" });
  }
});

// ── GET /api/ledger/balance-sheet ────────────────────────────
router.get("/balance-sheet", async (req, res) => {
  const { businessId } = req.user;
  const { asOf } = req.query;

  try {
    const accounts = await accountTotals(businessId, asOf);

    const byType = (t) => accounts.filter((a) => a.account_type === t);
    const sumNatural = (rows) =>
      rows.reduce((s, a) => s + a.natural_balance, 0);

    const assets = byType("asset");
    const liabilities = byType("liability");
    const equityAccounts = byType("equity");
    const revenue = byType("revenue");
    const expense = byType("expense");

    const totalAssets = sumNatural(assets);
    const totalLiabilities = sumNatural(liabilities);
    const totalEquityAccounts = sumNatural(equityAccounts);

    // Revenue and expense are temporary accounts that haven't been closed
    // into equity. Their net is current-period earnings, shown as an equity line.
    const netIncome = sumNatural(revenue) - sumNatural(expense);
    const totalEquity = totalEquityAccounts + netIncome;

    const round = (n) => Math.round(n * 100) / 100;
    const difference = totalAssets - (totalLiabilities + totalEquity);

    const present = (rows) =>
      rows
        .filter((a) => a.natural_balance !== 0)
        .map((a) => ({
          id: a.id,
          code: a.code,
          name_key: a.name_key,
          name: a.name,
          balance: round(a.natural_balance),
        }));

    return res.json({
      as_of: asOf || null,
      assets: { accounts: present(assets), total: round(totalAssets) },
      liabilities: {
        accounts: present(liabilities),
        total: round(totalLiabilities),
      },
      equity: {
        accounts: present(equityAccounts),
        current_period_earnings: round(netIncome),
        total: round(totalEquity),
      },
      total_liabilities_and_equity: round(totalLiabilities + totalEquity),
      // The proof: assets must equal liabilities + equity.
      balances: Math.abs(difference) < EPSILON,
      difference: round(difference),
    });
  } catch (err) {
    console.error("Balance sheet error:", err);
    return res.status(500).json({ error: "Failed to compute balance sheet" });
  }
});

// ── GET /api/ledger/journal ──────────────────────────────────
router.get("/journal", async (req, res) => {
  const { businessId } = req.user;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const result = await pool.query(
      `SELECT
         je.id, je.entry_date, je.description, je.source_type, je.source_id,
         je.reverses_entry_id, je.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id', jel.id,
               'account_id', jel.account_id,
               'account_code', coa.code,
               'account_name_key', coa.name_key,
               'account_name', coa.name,
               'debit', jel.debit,
               'credit', jel.credit,
               'memo', jel.memo
             ) ORDER BY jel.line_order
           ) FILTER (WHERE jel.id IS NOT NULL),
           '[]'
         ) AS lines
       FROM journal_entries je
       LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE je.business_id = $1
       GROUP BY je.id
       ORDER BY je.entry_date DESC, je.created_at DESC
       LIMIT $2 OFFSET $3`,
      [businessId, limit, offset],
    );

    return res.json({ entries: result.rows });
  } catch (err) {
    console.error("Journal listing error:", err);
    return res.status(500).json({ error: "Failed to fetch journal" });
  }
});

export default router;
