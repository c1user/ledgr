/**
 * routes/payrollRules.js — the payroll rules admin API (ROADMAP-V5 · Phase 1)
 *
 * Mounted behind gate("payroll") (requireAuth + premium entitlement).
 * Everything is scoped to req.user.businessId — rules are per-business
 * records, so no tenant can ever see or touch another tenant's tax data.
 *
 * Mutations are owner-only. VERIFY is deliberately the most guarded
 * action in the module: it records the OWNER's attestation that the
 * payload matches the cited official source. Nothing in this codebase
 * sets VERIFIED on its own — that invariant is what makes production
 * mode meaningful.
 */

import express from "express";
import pool from "../config/db.js";
import { requireRole } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import { preflightRun } from "../services/payrollRules.js";
import { todayPR } from "../services/prDates.js";

const router = express.Router();
router.param("id", uuidParam("Payroll rule"));

const ownerOnly = requireRole("owner");

// Postgres exclusion-constraint violation (overlapping effective range).
const EXCLUSION_VIOLATION = "23P01";

// ── GET /api/payroll-rules ────────────────────────────────────
// List every rule version for the business (payloads come from /:id).
router.get("/", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        r.id, r.rule_type, r.jurisdiction, r.effective_from, r.effective_to,
        r.verification_status, r.verified_at, r.source_citation, r.notes,
        r.created_at,
        u.name AS verified_by_name
       FROM payroll_rules r
       LEFT JOIN users u ON u.id = r.verified_by
       WHERE r.business_id = $1
       ORDER BY r.rule_type ASC, r.effective_from DESC`,
      [businessId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("List payroll rules error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll rules" });
  }
});

// ── GET /api/payroll-rules/mode ───────────────────────────────
router.get("/mode", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        b.payroll_mode,
        (SELECT COUNT(*) FROM payroll_rules r
          WHERE r.business_id = b.id
            AND r.verification_status = 'UNVERIFIED'
            AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
        ) AS unverified_count
       FROM businesses b WHERE b.id = $1`,
      [businessId],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get payroll mode error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll mode" });
  }
});

// ── PUT /api/payroll-rules/mode ───────────────────────────────
// Switching to production is allowed even with UNVERIFIED rules — the
// run preflight is the hard gate that will refuse those runs — but the
// response always reports the blocker count so the UI can warn.
router.put("/mode", ownerOnly, async (req, res) => {
  const { businessId } = req.user;
  const { mode } = req.body;

  if (!["sandbox", "production"].includes(mode)) {
    return res
      .status(400)
      .json({ error: "mode must be 'sandbox' or 'production'" });
  }

  try {
    await pool.query("UPDATE businesses SET payroll_mode = $1 WHERE id = $2", [
      mode,
      businessId,
    ]);

    const count = await pool.query(
      `SELECT COUNT(*) AS unverified_count FROM payroll_rules
       WHERE business_id = $1 AND verification_status = 'UNVERIFIED'
         AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
      [businessId],
    );

    return res.json({
      payroll_mode: mode,
      unverified_count: count.rows[0].unverified_count,
    });
  } catch (err) {
    console.error("Set payroll mode error:", err);
    return res.status(500).json({ error: "Failed to set payroll mode" });
  }
});

// ── GET /api/payroll-rules/preflight?date=YYYY-MM-DD ─────────
// What a run on the given pay date would resolve: mode, watermark,
// and the exact list of blocking rules if production.
router.get("/preflight", async (req, res) => {
  const { businessId } = req.user;
  const date = req.query.date || todayPR();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }

  try {
    const { mode, watermark, ok, blockers } = await preflightRun(
      pool,
      businessId,
      date,
    );
    // resolved/snapshot are engine inputs, not UI concerns — omit them.
    return res.json({ mode, watermark, ok, blockers, pay_date: date });
  } catch (err) {
    console.error("Payroll preflight error:", err);
    return res.status(500).json({ error: "Failed to run payroll preflight" });
  }
});

// ── GET /api/payroll-rules/:id ────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT r.*, u.name AS verified_by_name
       FROM payroll_rules r
       LEFT JOIN users u ON u.id = r.verified_by
       WHERE r.id = $1 AND r.business_id = $2`,
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payroll rule not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get payroll rule error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll rule" });
  }
});

// ── POST /api/payroll-rules ───────────────────────────────────
// Create a new rule version (e.g. next year's rates, this employer's
// SUTA experience rate). Close the prior version's effective_to first;
// overlapping ranges are refused by the DB.
router.post("/", ownerOnly, async (req, res) => {
  const { businessId } = req.user;
  const {
    ruleType,
    jurisdiction,
    payload,
    effectiveFrom,
    effectiveTo,
    sourceCitation,
    notes,
  } = req.body;

  if (!ruleType || typeof ruleType !== "string") {
    return res.status(400).json({ error: "ruleType is required" });
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return res.status(400).json({ error: "payload must be a JSON object" });
  }
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return res.status(400).json({ error: "effectiveFrom must be YYYY-MM-DD" });
  }
  if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
    return res.status(400).json({ error: "effectiveTo must be YYYY-MM-DD" });
  }
  if (!sourceCitation || !sourceCitation.trim()) {
    return res.status(400).json({
      error: "sourceCitation is required — name the official document and URL",
    });
  }
  if (jurisdiction && !["PR", "US"].includes(jurisdiction)) {
    return res.status(400).json({ error: "jurisdiction must be PR or US" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO payroll_rules
         (business_id, rule_type, jurisdiction, payload,
          effective_from, effective_to, source_citation, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        businessId,
        ruleType.trim(),
        jurisdiction || "PR",
        JSON.stringify(payload),
        effectiveFrom,
        effectiveTo || null,
        sourceCitation.trim(),
        notes || null,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      return res.status(409).json({
        error:
          "This version's effective range overlaps an existing version of the same rule. Close the prior version (set its end date) first.",
      });
    }
    console.error("Create payroll rule error:", err);
    return res.status(500).json({ error: "Failed to create payroll rule" });
  }
});

// ── PUT /api/payroll-rules/:id ────────────────────────────────
// Edit an UNVERIFIED rule in place (replacing placeholder values with
// official ones before verifying). Verified rules are immutable — the
// only permitted edits are effective_to (to supersede) and notes.
router.put("/:id", ownerOnly, async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { payload, effectiveFrom, effectiveTo, sourceCitation, notes } =
    req.body;

  if (
    payload !== undefined &&
    (payload === null || typeof payload !== "object" || Array.isArray(payload))
  ) {
    return res.status(400).json({ error: "payload must be a JSON object" });
  }
  if (effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return res.status(400).json({ error: "effectiveFrom must be YYYY-MM-DD" });
  }
  if (
    effectiveTo !== undefined &&
    effectiveTo !== null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)
  ) {
    return res.status(400).json({ error: "effectiveTo must be YYYY-MM-DD" });
  }

  try {
    const existing = await pool.query(
      "SELECT * FROM payroll_rules WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Payroll rule not found" });
    }
    const rule = existing.rows[0];

    const frozen = rule.verification_status === "VERIFIED";
    if (
      frozen &&
      (payload !== undefined ||
        effectiveFrom !== undefined ||
        sourceCitation !== undefined)
    ) {
      return res.status(409).json({
        error:
          "Verified rules are immutable. Create a new version to change values, or revert the verification first.",
      });
    }

    const result = await pool.query(
      `UPDATE payroll_rules SET
        payload         = COALESCE($1, payload),
        effective_from  = COALESCE($2, effective_from),
        effective_to    = $3,
        source_citation = COALESCE($4, source_citation),
        notes           = $5
       WHERE id = $6 AND business_id = $7
       RETURNING *`,
      [
        payload !== undefined ? JSON.stringify(payload) : null,
        effectiveFrom || null,
        effectiveTo !== undefined ? effectiveTo : rule.effective_to,
        sourceCitation?.trim() || null,
        notes !== undefined ? notes : rule.notes,
        id,
        businessId,
      ],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      return res.status(409).json({
        error:
          "This version's effective range overlaps an existing version of the same rule.",
      });
    }
    console.error("Update payroll rule error:", err);
    return res.status(500).json({ error: "Failed to update payroll rule" });
  }
});

// ── PUT /api/payroll-rules/:id/verify ─────────────────────────
// Records the owner's attestation. The request must carry an explicit
// attest flag — the UI shows the citation and makes the human confirm
// they checked the payload against it. Never called by app code.
router.put("/:id/verify", ownerOnly, async (req, res) => {
  const { businessId, userId } = req.user;
  const { id } = req.params;

  if (req.body?.attest !== true) {
    return res.status(400).json({
      error:
        "Verification requires attest: true — confirm the values match the cited official source",
    });
  }

  try {
    const existing = await pool.query(
      "SELECT verification_status, source_citation FROM payroll_rules WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Payroll rule not found" });
    }
    if (existing.rows[0].verification_status === "VERIFIED") {
      return res.status(400).json({ error: "Rule is already verified" });
    }
    if (/^PLACEHOLDER\b/i.test(existing.rows[0].source_citation || "")) {
      return res.status(400).json({
        error:
          "Replace the placeholder citation with the official document name and URL before verifying",
      });
    }

    const result = await pool.query(
      `UPDATE payroll_rules SET
        verification_status = 'VERIFIED',
        verified_by = $1,
        verified_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [userId, id, businessId],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Verify payroll rule error:", err);
    return res.status(500).json({ error: "Failed to verify payroll rule" });
  }
});

// ── PUT /api/payroll-rules/:id/unverify ───────────────────────
// A human walking back a mistaken attestation. Past runs are unaffected
// (they snapshot rule-version IDs); future production runs re-block.
router.put("/:id/unverify", ownerOnly, async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: "Unverify requires confirm: true" });
  }

  try {
    const result = await pool.query(
      `UPDATE payroll_rules SET verification_status = 'UNVERIFIED'
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [id, businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payroll rule not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Unverify payroll rule error:", err);
    return res.status(500).json({ error: "Failed to unverify payroll rule" });
  }
});

// ── DELETE /api/payroll-rules/:id ─────────────────────────────
// Discard a botched UNVERIFIED draft version. Verified rules can never
// be deleted (DB trigger enforces even if this check is bypassed).
router.delete("/:id", ownerOnly, async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT verification_status FROM payroll_rules WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Payroll rule not found" });
    }
    if (existing.rows[0].verification_status === "VERIFIED") {
      return res.status(409).json({
        error:
          "Verified rules cannot be deleted — supersede with a new version instead",
      });
    }

    await pool.query(
      "DELETE FROM payroll_rules WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    return res.json({ message: "Payroll rule deleted" });
  } catch (err) {
    console.error("Delete payroll rule error:", err);
    return res.status(500).json({ error: "Failed to delete payroll rule" });
  }
});

export default router;
