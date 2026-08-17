/**
 * routes/payrollProfile.js — employer payroll compliance identity
 * (ROADMAP-V5 · Phase 2.1). Mounted behind gate("payroll").
 *
 * One row per business (payroll_employer_profiles). The federal EIN is
 * NOT here — it lives on businesses.tax_id (shared with 480.6SP); GET
 * returns it read-only for display so the UI shows the full identity.
 */

import express from "express";
import pool from "../config/db.js";
import { requireRole } from "../middleware/auth.js";

const router = express.Router();

const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"];

// ── GET /api/payroll-profile ──────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT b.tax_id AS ein, p.merchant_reg_no, p.suri_account_ref,
              p.dtrh_employer_no, p.cfse_policy_no, p.default_pay_frequency,
              p.size_band, p.default_municipality,
              p.check_offset_x_mm, p.check_offset_y_mm, p.updated_at
       FROM businesses b
       LEFT JOIN payroll_employer_profiles p ON p.business_id = b.id
       WHERE b.id = $1`,
      [businessId],
    );

    return res.json(result.rows[0] || {});
  } catch (err) {
    console.error("Get payroll profile error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll profile" });
  }
});

// ── PUT /api/payroll-profile ──────────────────────────────────
router.put("/", requireRole("owner", "admin"), async (req, res) => {
  const { businessId } = req.user;
  const {
    merchantRegNo,
    suriAccountRef,
    dtrhEmployerNo,
    cfsePolicyNo,
    defaultPayFrequency,
    sizeBand,
    defaultMunicipality,
    checkOffsetXMm,
    checkOffsetYMm,
  } = req.body;

  if (defaultPayFrequency && !FREQUENCIES.includes(defaultPayFrequency)) {
    return res.status(400).json({
      error: `defaultPayFrequency must be one of: ${FREQUENCIES.join(", ")}`,
    });
  }
  for (const [name, v] of [
    ["checkOffsetXMm", checkOffsetXMm],
    ["checkOffsetYMm", checkOffsetYMm],
  ]) {
    if (v != null && (typeof v !== "number" || Math.abs(v) > 50)) {
      return res
        .status(400)
        .json({ error: `${name} must be a number between -50 and 50 (mm)` });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO payroll_employer_profiles
         (business_id, merchant_reg_no, suri_account_ref, dtrh_employer_no,
          cfse_policy_no, default_pay_frequency, size_band,
          default_municipality, check_offset_x_mm, check_offset_y_mm,
          updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'biweekly'), $7, $8,
               COALESCE($9, 0), COALESCE($10, 0), NOW())
       ON CONFLICT (business_id) DO UPDATE SET
         merchant_reg_no       = COALESCE($2, payroll_employer_profiles.merchant_reg_no),
         suri_account_ref      = COALESCE($3, payroll_employer_profiles.suri_account_ref),
         dtrh_employer_no      = COALESCE($4, payroll_employer_profiles.dtrh_employer_no),
         cfse_policy_no        = COALESCE($5, payroll_employer_profiles.cfse_policy_no),
         default_pay_frequency = COALESCE($6, payroll_employer_profiles.default_pay_frequency),
         size_band             = COALESCE($7, payroll_employer_profiles.size_band),
         default_municipality  = COALESCE($8, payroll_employer_profiles.default_municipality),
         check_offset_x_mm     = COALESCE($9, payroll_employer_profiles.check_offset_x_mm),
         check_offset_y_mm     = COALESCE($10, payroll_employer_profiles.check_offset_y_mm),
         updated_at            = NOW()
       RETURNING *`,
      [
        businessId,
        merchantRegNo ?? null,
        suriAccountRef ?? null,
        dtrhEmployerNo ?? null,
        cfsePolicyNo ?? null,
        defaultPayFrequency || null,
        sizeBand ?? null,
        defaultMunicipality ?? null,
        checkOffsetXMm ?? null,
        checkOffsetYMm ?? null,
      ],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update payroll profile error:", err);
    return res.status(500).json({ error: "Failed to update payroll profile" });
  }
});

export default router;
