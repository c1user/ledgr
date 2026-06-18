import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// ── GET /api/vendors ──────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { search, eligible } = req.query;

  try {
    let query = `
      SELECT
        v.id, v.name, v.ein, v.address, v.city, v.state, v.zip,
        v.email, v.phone, v.is_1099_eligible, v.created_at,
        COUNT(t.id)::int AS transaction_count,
        COALESCE(SUM(t.total_amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS ytd_paid
      FROM vendors v
      LEFT JOIN transactions t ON t.vendor_id = v.id AND t.business_id = $1
        AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
      WHERE v.business_id = $1
    `;
    const params = [businessId];
    let n = 1;

    if (search) {
      n++;
      query += ` AND v.name ILIKE $${n}`;
      params.push(`%${search}%`);
    }
    if (eligible === "true") {
      query += ` AND v.is_1099_eligible = TRUE`;
    }

    query += ` GROUP BY v.id ORDER BY v.name ASC`;

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Get vendors error:", err);
    return res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

// ── GET /api/vendors/1099-report — declared BEFORE /:id ──────
router.get("/1099-report", async (req, res) => {
  const { businessId } = req.user;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  try {
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

    const vendors = result.rows;
    return res.json({
      year,
      vendors,
      threshold: 600,
      flagged: vendors.filter((v) => parseFloat(v.total_paid) >= 600),
    });
  } catch (err) {
    console.error("1099 report error:", err);
    return res.status(500).json({ error: "Failed to generate 1099 report" });
  }
});

// ── GET /api/vendors/:id ──────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM vendors WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get vendor error:", err);
    return res.status(500).json({ error: "Failed to fetch vendor" });
  }
});

// ── GET /api/vendors/:id/transactions ────────────────────────
router.get("/:id/transactions", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { year } = req.query;

  try {
    let q = `
      SELECT t.id, t.date, t.merchant, t.total_amount, t.type, t.notes,
        t.category_id, cat.name AS category_name, cat.color AS category_color,
        a.name AS account_name
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.vendor_id = $1 AND t.business_id = $2
    `;
    const params = [id, businessId];

    if (year) {
      q += ` AND EXTRACT(YEAR FROM t.date) = $3`;
      params.push(parseInt(year));
    }

    q += ` ORDER BY t.date DESC LIMIT 50`;
    const result = await pool.query(q, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Get vendor transactions error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch vendor transactions" });
  }
});

// ── POST /api/vendors ─────────────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const { name, ein, address, city, state, zip, email, phone, is_1099_eligible } =
    req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vendors (business_id, name, ein, address, city, state, zip, email, phone, is_1099_eligible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        businessId,
        name.trim(),
        ein || null,
        address || null,
        city || null,
        state || null,
        zip || null,
        email || null,
        phone || null,
        !!is_1099_eligible,
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create vendor error:", err);
    return res.status(500).json({ error: "Failed to create vendor" });
  }
});

// ── PUT /api/vendors/:id ──────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { name, ein, address, city, state, zip, email, phone, is_1099_eligible } =
    req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM vendors WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const result = await pool.query(
      `UPDATE vendors SET
        name             = $1,
        ein              = $2,
        address          = $3,
        city             = $4,
        state            = $5,
        zip              = $6,
        email            = $7,
        phone            = $8,
        is_1099_eligible = $9
       WHERE id = $10 AND business_id = $11 RETURNING *`,
      [
        name.trim(),
        ein || null,
        address || null,
        city || null,
        state || null,
        zip || null,
        email || null,
        phone || null,
        !!is_1099_eligible,
        id,
        businessId,
      ],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update vendor error:", err);
    return res.status(500).json({ error: "Failed to update vendor" });
  }
});

// ── DELETE /api/vendors/:id ───────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT id FROM vendors WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    await pool.query(
      "DELETE FROM vendors WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    return res.json({ message: "Vendor deleted" });
  } catch (err) {
    console.error("Delete vendor error:", err);
    return res.status(500).json({ error: "Failed to delete vendor" });
  }
});

export default router;
