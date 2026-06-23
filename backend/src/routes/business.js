/**
 * routes/business.js
 *
 * Business (payer) profile. Exposes the fields the 480.6SP "informante" block
 * needs — EIN (tax_id) and mailing address — which had no edit surface before.
 *
 * Mount in server.js:  app.use("/api/business", businessRoutes);
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// ── GET /api/business ────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT id, name, tax_id, address, city, state, zip, currency, plan
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
  const { name, taxId, address, city, state, zip } = req.body;

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
         address = $3,
         city    = $4,
         state   = $5,
         zip     = $6
       WHERE id = $7
       RETURNING id, name, tax_id, address, city, state, zip, currency, plan`,
      [
        name !== undefined ? String(name).trim() : old.name,
        taxId !== undefined ? taxId || null : old.tax_id,
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
