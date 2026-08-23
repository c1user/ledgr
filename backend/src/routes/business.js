/**
 * routes/business.js
 *
 * Business (payer) profile. Exposes the fields the 480.6SP "informante" block
 * needs — EIN (tax_id) and mailing address — which had no edit surface before.
 *
 * Mount in server.js:  app.use("/api/business", businessRoutes);
 */

import express from "express";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getPlan } from "../middleware/entitlements.js";
import { getEntitlements, PLANS } from "../config/entitlements.js";
import {
  exportBusinessData,
  deleteBusinessData,
} from "../services/businessData.js";

const router = express.Router();
router.use(requireAuth);

// ── GET /api/business/export ─────────────────────────────────
// Owner-only: every record the business owns, as one JSON download.
router.get("/export", requireRole("owner"), async (req, res) => {
  try {
    const data = await exportBusinessData(pool, req.user.businessId);
    if (!data) return res.status(404).json({ error: "Business not found" });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="abaco-export-${stamp}.json"`,
    );
    return res.json(data);
  } catch (err) {
    console.error("Export error:", err.message);
    return res.status(500).json({ error: "Failed to export data" });
  }
});

// ── DELETE /api/business ─────────────────────────────────────
// Owner-only, irreversible: removes every row the business owns.
// Two-factor confirmation: the owner's current password AND the exact
// business name must both match.
router.delete("/", requireRole("owner"), async (req, res) => {
  const { password, confirmName } = req.body;

  if (!password || !confirmName) {
    return res
      .status(400)
      .json({ error: "Password and business name confirmation are required" });
  }

  const client = await pool.connect();
  try {
    const check = await client.query(
      `SELECT u.password_hash, b.name AS business_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1`,
      [req.user.userId],
    );
    if (check.rows.length === 0 || !check.rows[0].password_hash) {
      return res.status(404).json({ error: "User not found" });
    }

    const matches = await bcrypt.compare(password, check.rows[0].password_hash);
    if (!matches) {
      // 400, not 401 — see change-password: 401 would force a logout.
      return res.status(400).json({ error: "Password is incorrect" });
    }
    if (confirmName !== check.rows[0].business_name) {
      return res
        .status(400)
        .json({ error: "The business name does not match" });
    }

    await client.query("BEGIN");
    const counts = await deleteBusinessData(client, req.user.businessId);
    await client.query("COMMIT");

    console.log(
      `Business ${req.user.businessId} closed by user ${req.user.userId}:`,
      JSON.stringify(counts),
    );
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Close business error:", err.message);
    return res.status(500).json({ error: "Failed to close the business" });
  } finally {
    client.release();
  }
});

// ── GET /api/business/entitlements ───────────────────────────
// The frontend mirror of config/entitlements.js: current plan, its feature
// list and limits, plus the feature→minimum-plan map that drives upsell copy.
router.get("/entitlements", async (req, res) => {
  try {
    const plan = await getPlan(req.user.businessId);
    return res.json(getEntitlements(plan));
  } catch (err) {
    console.error("Get entitlements error:", err);
    return res.status(500).json({ error: "Failed to fetch entitlements" });
  }
});

// ── PUT /api/business/plan ───────────────────────────────────
// Owner-only plan switch. Billing is deliberately not wired yet — until
// Stripe lands, the owner picks the tier directly and the entitlement
// gates apply immediately.
router.put("/plan", requireRole("owner"), async (req, res) => {
  const { plan } = req.body;
  if (!PLANS.includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }
  try {
    const result = await pool.query(
      "UPDATE businesses SET plan = $2 WHERE id = $1 RETURNING plan",
      [req.user.businessId, plan],
    );
    return res.json(getEntitlements(result.rows[0].plan));
  } catch (err) {
    console.error("Update plan error:", err);
    return res.status(500).json({ error: "Failed to update plan" });
  }
});

// ── GET /api/business ────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT id, name, tax_id, merchant_registration_number,
              address, city, state, zip, currency, plan
       FROM businesses WHERE id = $1`,
      [businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get business error:", err);
    return res.status(500).json({ error: "Failed to fetch business profile" });
  }
});

// ── PUT /api/business ────────────────────────────────────────
// Update the payer profile: name, EIN, and address block. Owner/admin only.
router.put("/", requireRole("owner", "admin"), async (req, res) => {
  const { businessId } = req.user;
  const { name, taxId, merchantRegistrationNumber, address, city, state, zip } =
    req.body;

  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: "Business name cannot be empty" });
  }

  try {
    const existing = await pool.query(
      "SELECT * FROM businesses WHERE id = $1",
      [businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }
    const old = existing.rows[0];

    const result = await pool.query(
      `UPDATE businesses SET
         name    = $1,
         tax_id  = $2,
         merchant_registration_number = $3,
         address = $4,
         city    = $5,
         state   = $6,
         zip     = $7
       WHERE id = $8
       RETURNING id, name, tax_id, merchant_registration_number,
                 address, city, state, zip, currency, plan`,
      [
        name !== undefined ? String(name).trim() : old.name,
        taxId !== undefined ? taxId || null : old.tax_id,
        merchantRegistrationNumber !== undefined
          ? merchantRegistrationNumber || null
          : old.merchant_registration_number,
        address !== undefined ? address || null : old.address,
        city !== undefined ? city || null : old.city,
        state !== undefined ? state || null : old.state,
        zip !== undefined ? zip || null : old.zip,
        businessId,
      ],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update business error:", err);
    return res.status(500).json({ error: "Failed to update business profile" });
  }
});

export default router;
