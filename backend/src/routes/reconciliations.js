import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";

const router = express.Router();

router.use(requireAuth);
router.param("id", uuidParam("Reconciliation"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Signed effect of a transaction on the funding source's balance. Withheld
// amounts (§1062.03) never touch the bank — the statement shows net cash.
const SIGNED_SUM = `
  COALESCE(SUM(CASE WHEN t.type = 'income'
                    THEN t.total_amount - COALESCE(t.withholding_amount, 0)
                    ELSE -(t.total_amount - COALESCE(t.withholding_amount, 0))
               END), 0)
`;

async function loadRecon(businessId, id) {
  const result = await pool.query(
    `SELECT r.*,
            a.name       AS account_name,
            coa.name     AS coa_name,
            coa.name_key AS coa_name_key,
            (SELECT COUNT(*)::int FROM transactions t
              WHERE t.reconciliation_id = r.id) AS cleared_count,
            (SELECT ${SIGNED_SUM} FROM transactions t
              WHERE t.reconciliation_id = r.id)::NUMERIC(12,2) AS cleared_delta
     FROM reconciliations r
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN chart_of_accounts coa ON coa.id = r.funding_coa_id
     WHERE r.id = $1 AND r.business_id = $2`,
    [id, businessId],
  );
  return result.rows[0] || null;
}

// ── GET /api/reconciliations ──────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT r.id, r.start_date::text AS start_date, r.end_date::text AS end_date,
              r.statement_start_balance, r.statement_end_balance,
              r.status, r.completed_at, r.created_at,
              a.name       AS account_name,
              coa.name     AS coa_name,
              coa.name_key AS coa_name_key,
              (SELECT COUNT(*)::int FROM transactions t
                WHERE t.reconciliation_id = r.id) AS cleared_count
       FROM reconciliations r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN chart_of_accounts coa ON coa.id = r.funding_coa_id
       WHERE r.business_id = $1
       ORDER BY r.end_date DESC, r.created_at DESC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("List reconciliations error:", err);
    return res.status(500).json({ error: "Failed to fetch reconciliations" });
  }
});

// ── POST /api/reconciliations ─────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId, userId } = req.user;
  const {
    accountId,
    fundingCoaId,
    startDate,
    endDate,
    statementStartBalance,
    statementEndBalance,
  } = req.body;

  if ((!accountId && !fundingCoaId) || (accountId && fundingCoaId)) {
    return res.status(400).json({
      error: "Provide exactly one funding source: accountId or fundingCoaId",
    });
  }
  if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "")) {
    return res
      .status(400)
      .json({ error: "startDate and endDate (YYYY-MM-DD) are required" });
  }
  if (endDate < startDate) {
    return res.status(400).json({ error: "endDate cannot be before startDate" });
  }
  const startBal = parseFloat(statementStartBalance ?? 0);
  const endBal = parseFloat(statementEndBalance);
  if (Number.isNaN(startBal) || Number.isNaN(endBal)) {
    return res
      .status(400)
      .json({ error: "statementEndBalance is required and must be a number" });
  }

  try {
    // The funding source must belong to this business.
    if (accountId) {
      const chk = await pool.query(
        "SELECT 1 FROM accounts WHERE id = $1 AND business_id = $2",
        [accountId, businessId],
      );
      if (chk.rowCount === 0)
        return res.status(400).json({ error: "Account not found" });
    } else {
      const chk = await pool.query(
        "SELECT 1 FROM chart_of_accounts WHERE id = $1 AND business_id = $2",
        [fundingCoaId, businessId],
      );
      if (chk.rowCount === 0)
        return res.status(400).json({ error: "Ledger account not found" });
    }

    const inserted = await pool.query(
      `INSERT INTO reconciliations
         (business_id, account_id, funding_coa_id, start_date, end_date,
          statement_start_balance, statement_end_balance, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        businessId,
        accountId || null,
        fundingCoaId || null,
        startDate,
        endDate,
        startBal,
        endBal,
        userId,
      ],
    );
    return res
      .status(201)
      .json(await loadRecon(businessId, inserted.rows[0].id));
  } catch (err) {
    console.error("Create reconciliation error:", err);
    return res.status(500).json({ error: "Failed to create reconciliation" });
  }
});

// ── GET /api/reconciliations/:id ──────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  try {
    const recon = await loadRecon(businessId, req.params.id);
    if (!recon)
      return res.status(404).json({ error: "Reconciliation not found" });
    return res.json(recon);
  } catch (err) {
    console.error("Get reconciliation error:", err);
    return res.status(500).json({ error: "Failed to fetch reconciliation" });
  }
});

// ── GET /api/reconciliations/:id/transactions ─────────────────
// Candidate transactions: same funding source, inside the period, and either
// not reconciled yet or cleared in THIS reconciliation.
router.get("/:id/transactions", async (req, res) => {
  const { businessId } = req.user;
  try {
    const recon = await loadRecon(businessId, req.params.id);
    if (!recon)
      return res.status(404).json({ error: "Reconciliation not found" });

    const fundingWhere = recon.account_id
      ? "t.account_id = $4"
      : "t.funding_coa_id = $4";
    const result = await pool.query(
      `SELECT t.id, t.date::text AS date, t.merchant, t.notes,
              t.total_amount, t.type,
              (t.total_amount - COALESCE(t.withholding_amount, 0))::NUMERIC(12,2)
                AS cash_amount,
              (t.reconciliation_id = $2) AS cleared
       FROM transactions t
       WHERE t.business_id = $1
         AND ${fundingWhere}
         AND t.date >= $3::date AND t.date <= $5::date
         AND (t.reconciliation_id IS NULL OR t.reconciliation_id = $2)
       ORDER BY t.date ASC, t.created_at ASC`,
      [
        businessId,
        recon.id,
        recon.start_date,
        recon.account_id || recon.funding_coa_id,
        recon.end_date,
      ],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Reconciliation candidates error:", err);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ── PUT /api/reconciliations/:id/transactions ─────────────────
// Clear / unclear transactions while the reconciliation is in progress.
router.put("/:id/transactions", async (req, res) => {
  const { businessId } = req.user;
  const add = Array.isArray(req.body.add) ? req.body.add : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove : [];

  try {
    const recon = await loadRecon(businessId, req.params.id);
    if (!recon)
      return res.status(404).json({ error: "Reconciliation not found" });
    if (recon.status !== "in_progress") {
      return res
        .status(400)
        .json({ error: "Reconciliation is already completed" });
    }

    const fundingWhere = recon.account_id
      ? "account_id = $4"
      : "funding_coa_id = $4";
    if (add.length > 0) {
      // Only free transactions of the same funding source, inside the period.
      await pool.query(
        `UPDATE transactions SET reconciliation_id = $2
         WHERE business_id = $1 AND id = ANY($3::uuid[])
           AND ${fundingWhere}
           AND date >= $5::date AND date <= $6::date
           AND reconciliation_id IS NULL`,
        [
          businessId,
          recon.id,
          add,
          recon.account_id || recon.funding_coa_id,
          recon.start_date,
          recon.end_date,
        ],
      );
    }
    if (remove.length > 0) {
      await pool.query(
        `UPDATE transactions SET reconciliation_id = NULL
         WHERE business_id = $1 AND reconciliation_id = $2
           AND id = ANY($3::uuid[])`,
        [businessId, recon.id, remove],
      );
    }
    return res.json(await loadRecon(businessId, recon.id));
  } catch (err) {
    console.error("Update reconciliation transactions error:", err);
    return res.status(500).json({ error: "Failed to update transactions" });
  }
});

// ── POST /api/reconciliations/:id/complete ────────────────────
// Server-side check: cleared activity must explain the statement movement.
router.post("/:id/complete", async (req, res) => {
  const { businessId } = req.user;
  try {
    const recon = await loadRecon(businessId, req.params.id);
    if (!recon)
      return res.status(404).json({ error: "Reconciliation not found" });
    if (recon.status !== "in_progress") {
      return res
        .status(400)
        .json({ error: "Reconciliation is already completed" });
    }

    const expected =
      parseFloat(recon.statement_end_balance) -
      parseFloat(recon.statement_start_balance);
    const cleared = parseFloat(recon.cleared_delta);
    if (Math.abs(expected - cleared) > 0.005) {
      return res.status(400).json({
        error: "Cleared transactions do not match the statement",
        difference: parseFloat((expected - cleared).toFixed(2)),
      });
    }

    await pool.query(
      `UPDATE reconciliations SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [recon.id, businessId],
    );
    return res.json(await loadRecon(businessId, recon.id));
  } catch (err) {
    console.error("Complete reconciliation error:", err);
    return res.status(500).json({ error: "Failed to complete reconciliation" });
  }
});

// ── DELETE /api/reconciliations/:id ───────────────────────────
// Cancel an in-progress reconciliation. The FK is ON DELETE SET NULL, so
// its transactions are released automatically.
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  try {
    const recon = await loadRecon(businessId, req.params.id);
    if (!recon)
      return res.status(404).json({ error: "Reconciliation not found" });
    if (recon.status !== "in_progress") {
      return res.status(400).json({
        error: "Completed reconciliations can't be deleted",
      });
    }
    await pool.query(
      "DELETE FROM reconciliations WHERE id = $1 AND business_id = $2",
      [recon.id, businessId],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete reconciliation error:", err);
    return res.status(500).json({ error: "Failed to delete reconciliation" });
  }
});

export default router;
