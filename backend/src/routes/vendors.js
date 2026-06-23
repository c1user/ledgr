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
        v.email, v.phone, v.is_1099_eligible,
        v.withholding_exempt, v.waiver_certificate_no, v.created_at,
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

// The 1099 report moved to GET /api/reports/1099 (+ /1099/export) — see
// routes/reports.js. It adds threshold flagging, missing-field detection, and
// a CSV export, so the thin per-vendor aggregation that lived here was removed.

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
    // Category now lives in the ledger (journal entry lines), not on
    // transactions.category_id. Pull the primary revenue/expense line as the
    // category. System categories carry a name_key (resolve via i18n on the
    // client); custom ones carry a plain name.
    let q = `
      SELECT t.id, t.date, t.merchant, t.total_amount, t.type, t.notes,
        a.name AS account_name,
        cat.name_key AS category_name_key,
        cat.name AS category_name,
        cat.color AS category_color
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN LATERAL (
        SELECT coa.name_key, coa.name, coa.color
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        JOIN chart_of_accounts coa ON coa.id = jel.account_id
          AND coa.account_type IN ('revenue', 'expense')
        WHERE je.source_type = 'transaction' AND je.source_id = t.id
        ORDER BY jel.id
        LIMIT 1
      ) cat ON TRUE
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
  const {
    name, ein, address, city, state, zip, email, phone, is_1099_eligible,
    withholding_exempt, waiver_certificate_no,
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vendors (business_id, name, ein, address, city, state, zip, email, phone, is_1099_eligible, withholding_exempt, waiver_certificate_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
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
        !!withholding_exempt,
        waiver_certificate_no || null,
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
  const {
    name, ein, address, city, state, zip, email, phone, is_1099_eligible,
    withholding_exempt, waiver_certificate_no,
  } = req.body;

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
        name                  = $1,
        ein                   = $2,
        address               = $3,
        city                  = $4,
        state                 = $5,
        zip                   = $6,
        email                 = $7,
        phone                 = $8,
        is_1099_eligible      = $9,
        withholding_exempt    = $10,
        waiver_certificate_no = $11
       WHERE id = $12 AND business_id = $13 RETURNING *`,
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
        !!withholding_exempt,
        waiver_certificate_no || null,
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
