import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// ── GET /api/products ────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT
        p.id, p.name, p.sku, p.description, p.unit_cost, p.sell_price,
        p.qty_on_hand, p.reorder_point, p.valuation_method, p.is_active,
        p.category_id, p.created_at,
        c.name  AS category_name,
        c.color AS category_color,
        (p.qty_on_hand * p.unit_cost)::numeric AS stock_value,
        (p.reorder_point > 0 AND p.qty_on_hand <= p.reorder_point)::bool AS needs_reorder
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.business_id = $1
       ORDER BY p.name ASC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get products error:", err);
    return res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ── GET /api/products/reorder-count — must be before /:id ───
router.get("/reorder-count", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM products
       WHERE business_id = $1 AND is_active = TRUE
         AND reorder_point > 0 AND qty_on_hand <= reorder_point`,
      [businessId],
    );
    return res.json({ count: result.rows[0].count });
  } catch (err) {
    console.error("Reorder count error:", err);
    return res.status(500).json({ error: "Failed to fetch reorder count" });
  }
});

// ── GET /api/products/:id ────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const [productRes, movementsRes] = await Promise.all([
      pool.query(
        `SELECT p.*, c.name AS category_name, c.color AS category_color
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1 AND p.business_id = $2`,
        [id, businessId],
      ),
      pool.query(
        `SELECT im.*, t.merchant AS transaction_merchant, t.date AS transaction_date
         FROM inventory_movements im
         LEFT JOIN transactions t ON t.id = im.transaction_id
         WHERE im.product_id = $1 AND im.business_id = $2
         ORDER BY im.created_at DESC
         LIMIT 50`,
        [id, businessId],
      ),
    ]);
    if (productRes.rows.length === 0)
      return res.status(404).json({ error: "Product not found" });
    return res.json({ ...productRes.rows[0], movements: movementsRes.rows });
  } catch (err) {
    console.error("Get product error:", err);
    return res.status(500).json({ error: "Failed to fetch product" });
  }
});

// ── POST /api/products ───────────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const {
    name, sku, description, unitCost, sellPrice,
    reorderPoint, valuationMethod, categoryId,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  const cost = parseFloat(unitCost) || 0;
  if (cost < 0) return res.status(400).json({ error: "unit_cost cannot be negative" });
  try {
    const result = await pool.query(
      `INSERT INTO products
         (business_id, name, sku, description, unit_cost, sell_price, reorder_point, valuation_method, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        businessId,
        name.trim(),
        sku?.trim() || null,
        description || null,
        cost,
        sellPrice ? parseFloat(sellPrice) : null,
        parseFloat(reorderPoint) || 0,
        valuationMethod === "fifo" ? "fifo" : "avg",
        categoryId || null,
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "SKU already exists for this business" });
    console.error("Create product error:", err);
    return res.status(500).json({ error: "Failed to create product" });
  }
});

// ── PUT /api/products/:id ────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const {
    name, sku, description, unitCost, sellPrice,
    reorderPoint, valuationMethod, categoryId, isActive,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  try {
    const result = await pool.query(
      `UPDATE products SET
        name             = $1,
        sku              = $2,
        description      = $3,
        unit_cost        = $4,
        sell_price       = $5,
        reorder_point    = $6,
        valuation_method = $7,
        category_id      = $8,
        is_active        = $9
       WHERE id = $10 AND business_id = $11 RETURNING *`,
      [
        name.trim(),
        sku?.trim() || null,
        description || null,
        parseFloat(unitCost) || 0,
        sellPrice ? parseFloat(sellPrice) : null,
        parseFloat(reorderPoint) || 0,
        valuationMethod === "fifo" ? "fifo" : "avg",
        categoryId || null,
        isActive !== false,
        id,
        businessId,
      ],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Product not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "SKU already exists for this business" });
    console.error("Update product error:", err);
    return res.status(500).json({ error: "Failed to update product" });
  }
});

// ── DELETE /api/products/:id ─────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM products WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Product not found" });
    return res.json({ message: "Product deleted" });
  } catch (err) {
    console.error("Delete product error:", err);
    return res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
