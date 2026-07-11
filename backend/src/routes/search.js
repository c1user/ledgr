import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// ── GET /api/search?q= ────────────────────────────────────────
// Global quick search for the command palette: a few best matches from
// transactions, invoices, clients and vendors. Business-scoped, read-only.
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const q = String(req.query.q || "").trim();

  if (q.length < 2) {
    return res.json({ transactions: [], invoices: [], clients: [], vendors: [] });
  }
  const like = `%${q}%`;

  try {
    const [tx, invoices, clients, vendors] = await Promise.all([
      pool.query(
        `SELECT id, date::text AS date, merchant, notes, total_amount, type
         FROM transactions
         WHERE business_id = $1 AND (merchant ILIKE $2 OR notes ILIKE $2)
         ORDER BY date DESC
         LIMIT 5`,
        [businessId, like],
      ),
      pool.query(
        `SELECT i.id, i.invoice_number, i.status, i.total,
                c.name AS client_name
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         WHERE i.business_id = $1
           AND (i.invoice_number ILIKE $2 OR c.name ILIKE $2)
         ORDER BY i.issue_date DESC
         LIMIT 5`,
        [businessId, like],
      ),
      pool.query(
        `SELECT id, name, billing_email
         FROM clients
         WHERE business_id = $1 AND is_active
           AND (name ILIKE $2 OR billing_email ILIKE $2)
         ORDER BY name
         LIMIT 5`,
        [businessId, like],
      ),
      pool.query(
        `SELECT id, name
         FROM vendors
         WHERE business_id = $1 AND name ILIKE $2
         ORDER BY name
         LIMIT 5`,
        [businessId, like],
      ),
    ]);

    return res.json({
      transactions: tx.rows,
      invoices: invoices.rows,
      clients: clients.rows,
      vendors: vendors.rows,
    });
  } catch (err) {
    console.error("Global search error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

export default router;
