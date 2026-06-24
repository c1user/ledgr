/**
 * routes/clients.js
 *
 * Item 5 (Client / customer management) — the receivable-side mirror of
 * vendors. A client is who you bill; invoices (#10) reference one. The list
 * carries each client's outstanding balance (sum of sent/overdue invoices)
 * so the UI can show AR exposure at a glance.
 *
 * Mount in server.js:  app.use("/api/clients", clientRoutes);
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";

const router = express.Router();
router.use(requireAuth);
router.param("id", uuidParam("Client"));

// ── GET /api/clients ──────────────────────────────────────────
// List with search + active filter. Each row carries invoice_count and the
// outstanding balance (invoices that are sent but not yet paid/void).
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { search, active } = req.query;

  try {
    let query = `
      SELECT
        c.id, c.name, c.billing_email, c.billing_address, c.city, c.state,
        c.zip, c.phone, c.payment_terms_days, c.tax_exempt, c.is_active,
        c.notes, c.created_at,
        COUNT(i.id)::int AS invoice_count,
        COALESCE(SUM(i.total) FILTER (WHERE i.status IN ('sent', 'overdue')), 0)::numeric AS outstanding
      FROM clients c
      LEFT JOIN invoices i ON i.client_id = c.id AND i.business_id = $1
      WHERE c.business_id = $1
    `;
    const params = [businessId];
    let n = 1;

    if (search) {
      n++;
      query += ` AND c.name ILIKE $${n}`;
      params.push(`%${search}%`);
    }
    if (active === "true") {
      query += ` AND c.is_active = TRUE`;
    } else if (active === "false") {
      query += ` AND c.is_active = FALSE`;
    }

    query += ` GROUP BY c.id ORDER BY c.name ASC`;

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Get clients error:", err);
    return res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// ── GET /api/clients/:id ──────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM clients WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get client error:", err);
    return res.status(500).json({ error: "Failed to fetch client" });
  }
});

// ── GET /api/clients/:id/invoices ─────────────────────────────
// Invoice history plus a derived overdue flag. Outstanding balance is the
// sum of unpaid (sent/overdue) invoices.
router.get("/:id/invoices", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         i.id, i.invoice_number, i.issue_date, i.due_date, i.status,
         i.subtotal, i.tax_total, i.total, i.tax_type, i.language, i.paid_at,
         (i.status = 'sent' AND i.due_date < CURRENT_DATE) AS is_overdue
       FROM invoices i
       WHERE i.client_id = $1 AND i.business_id = $2
       ORDER BY i.issue_date DESC, i.created_at DESC
       LIMIT 100`,
      [id, businessId],
    );

    const outstanding = result.rows
      .filter((r) => r.status === "sent" || r.status === "overdue")
      .reduce((s, r) => s + parseFloat(r.total), 0);

    return res.json({ invoices: result.rows, outstanding });
  } catch (err) {
    console.error("Get client invoices error:", err);
    return res.status(500).json({ error: "Failed to fetch client invoices" });
  }
});

// ── POST /api/clients ─────────────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const {
    name,
    billing_email,
    billing_address,
    city,
    state,
    zip,
    phone,
    payment_terms_days,
    tax_exempt,
    notes,
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO clients
         (business_id, name, billing_email, billing_address, city, state, zip,
          phone, payment_terms_days, tax_exempt, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        businessId,
        name.trim(),
        billing_email || null,
        billing_address || null,
        city || null,
        state || null,
        zip || null,
        phone || null,
        Number.isFinite(parseInt(payment_terms_days))
          ? parseInt(payment_terms_days)
          : 30,
        !!tax_exempt,
        notes || null,
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create client error:", err);
    return res.status(500).json({ error: "Failed to create client" });
  }
});

// ── PUT /api/clients/:id ──────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const {
    name,
    billing_email,
    billing_address,
    city,
    state,
    zip,
    phone,
    payment_terms_days,
    tax_exempt,
    is_active,
    notes,
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM clients WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const result = await pool.query(
      `UPDATE clients SET
        name               = $1,
        billing_email      = $2,
        billing_address    = $3,
        city               = $4,
        state              = $5,
        zip                = $6,
        phone              = $7,
        payment_terms_days = $8,
        tax_exempt         = $9,
        is_active          = $10,
        notes              = $11
       WHERE id = $12 AND business_id = $13 RETURNING *`,
      [
        name.trim(),
        billing_email || null,
        billing_address || null,
        city || null,
        state || null,
        zip || null,
        phone || null,
        Number.isFinite(parseInt(payment_terms_days))
          ? parseInt(payment_terms_days)
          : 30,
        !!tax_exempt,
        is_active === undefined ? true : !!is_active,
        notes || null,
        id,
        businessId,
      ],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update client error:", err);
    return res.status(500).json({ error: "Failed to update client" });
  }
});

// ── DELETE /api/clients/:id ───────────────────────────────────
// Blocked if the client has invoices (those carry ledger history). Suggest
// deactivating instead.
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT id FROM clients WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const used = await pool.query(
      "SELECT 1 FROM invoices WHERE client_id = $1 LIMIT 1",
      [id],
    );
    if (used.rows.length > 0) {
      return res.status(400).json({
        error:
          "This client has invoices and can't be deleted. Deactivate it instead.",
      });
    }

    await pool.query("DELETE FROM clients WHERE id = $1 AND business_id = $2", [
      id,
      businessId,
    ]);
    return res.json({ message: "Client deleted" });
  } catch (err) {
    console.error("Delete client error:", err);
    return res.status(500).json({ error: "Failed to delete client" });
  }
});

export default router;
