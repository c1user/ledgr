import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ── GET /api/categories ───────────────────────────────────────
// Get all categories for the business
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { type } = req.query; // optional filter: income | expense

  try {
    let query = `
      SELECT 
        c.id,
        c.name,
        c.type,
        c.color,
        c.is_system,
        c.parent_id,
        p.name AS parent_name
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.business_id = $1
    `;

    const params = [businessId];

    if (type) {
      query += ` AND c.type = $2`;
      params.push(type);
    }

    query += ` ORDER BY c.type ASC, c.is_system DESC, c.name ASC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (err) {
    console.error("Get categories error:", err);
    return res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// ── GET /api/categories/:id ───────────────────────────────────
// Get a single category
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        c.id,
        c.name,
        c.type,
        c.color,
        c.is_system,
        c.parent_id,
        p.name AS parent_name
       FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE c.id = $1 AND c.business_id = $2`,
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get category error:", err);
    return res.status(500).json({ error: "Failed to fetch category" });
  }
});

// ── POST /api/categories ──────────────────────────────────────
// Create a new custom category
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const { name, type, color, parentId } = req.body;

  // Validation
  if (!name || !type) {
    return res.status(400).json({ error: "name and type are required" });
  }

  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "type must be income or expense" });
  }

  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return res
      .status(400)
      .json({ error: "color must be a valid hex color e.g. #FF0000" });
  }

  try {
    // Check for duplicate name within same business and type
    const existing = await pool.query(
      "SELECT id FROM categories WHERE business_id = $1 AND name = $2 AND type = $3",
      [businessId, name, type],
    );
    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "A category with this name already exists" });
    }

    // Validate parent category if provided
    if (parentId) {
      const parentCheck = await pool.query(
        "SELECT id, type FROM categories WHERE id = $1 AND business_id = $2",
        [parentId, businessId],
      );
      if (parentCheck.rows.length === 0) {
        return res.status(404).json({ error: "Parent category not found" });
      }
      if (parentCheck.rows[0].type !== type) {
        return res.status(400).json({
          error: "Parent category must be the same type (income or expense)",
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO categories (business_id, name, type, color, is_system, parent_id)
       VALUES ($1, $2, $3, $4, FALSE, $5)
       RETURNING *`,
      [businessId, name, type, color || "#888888", parentId || null],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create category error:", err);
    return res.status(500).json({ error: "Failed to create category" });
  }
});

// ── PUT /api/categories/:id ───────────────────────────────────
// Update a category — system categories can only have color updated
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { name, color, parentId } = req.body;

  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return res
      .status(400)
      .json({ error: "color must be a valid hex color e.g. #FF0000" });
  }

  try {
    const existing = await pool.query(
      "SELECT * FROM categories WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    const category = existing.rows[0];

    // System categories can only have their color changed
    if (category.is_system && name && name !== category.name) {
      return res.status(400).json({
        error:
          "System categories cannot be renamed. You can only change the color.",
      });
    }

    const result = await pool.query(
      `UPDATE categories SET
        name = COALESCE($1, name),
        color = COALESCE($2, color),
        parent_id = COALESCE($3, parent_id)
       WHERE id = $4 AND business_id = $5
       RETURNING *`,
      [
        category.is_system ? category.name : name || null,
        color || null,
        parentId || null,
        id,
        businessId,
      ],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update category error:", err);
    return res.status(500).json({ error: "Failed to update category" });
  }
});

// ── DELETE /api/categories/:id ────────────────────────────────
// Delete a category — system categories cannot be deleted
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM categories WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    if (existing.rows[0].is_system) {
      return res.status(400).json({
        error: "System categories cannot be deleted",
      });
    }

    // Check if category is in use
    const inUse = await pool.query(
      "SELECT id FROM transaction_splits WHERE category_id = $1 LIMIT 1",
      [id],
    );
    if (inUse.rows.length > 0) {
      return res.status(400).json({
        error:
          "Cannot delete a category that has transactions. Reassign those transactions first.",
      });
    }

    await pool.query(
      "DELETE FROM categories WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    return res.json({ message: "Category deleted" });
  } catch (err) {
    console.error("Delete category error:", err);
    return res.status(500).json({ error: "Failed to delete category" });
  }
});

export default router;
