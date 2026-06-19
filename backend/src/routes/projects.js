import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// ── GET /api/projects ────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT
        p.id, p.name, p.description, p.color, p.is_active, p.created_at,
        COUNT(te.id)::int        AS entry_count,
        COALESCE(SUM(te.hours), 0)::numeric AS total_hours,
        COALESCE(SUM(CASE WHEN te.is_billable AND te.hourly_rate IS NOT NULL
          THEN te.hours * te.hourly_rate ELSE 0 END), 0)::numeric AS billable_amount
       FROM projects p
       LEFT JOIN time_entries te ON te.project_id = p.id
       WHERE p.business_id = $1
       GROUP BY p.id
       ORDER BY p.name ASC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get projects error:", err);
    return res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ── GET /api/projects/:id/hours — declared before /:id ──────
router.get("/:id/hours", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN is_billable     THEN hours ELSE 0 END), 0)::numeric AS billable_hours,
        COALESCE(SUM(CASE WHEN NOT is_billable THEN hours ELSE 0 END), 0)::numeric AS non_billable_hours,
        COALESCE(SUM(hours), 0)::numeric                                            AS total_hours,
        COALESCE(SUM(CASE WHEN is_billable AND hourly_rate IS NOT NULL
          THEN hours * hourly_rate ELSE 0 END), 0)::numeric                        AS billable_amount
       FROM time_entries
       WHERE project_id = $1 AND business_id = $2`,
      [id, businessId],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get project hours error:", err);
    return res.status(500).json({ error: "Failed to fetch project hours" });
  }
});

// ── GET /api/projects/:id ────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM projects WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get project error:", err);
    return res.status(500).json({ error: "Failed to fetch project" });
  }
});

// ── POST /api/projects ───────────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const { name, description, color } = req.body;
  if (!name?.trim())
    return res.status(400).json({ error: "name is required" });
  try {
    const result = await pool.query(
      `INSERT INTO projects (business_id, name, description, color)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [businessId, name.trim(), description || null, color || "#4f8ef7"],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create project error:", err);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

// ── PUT /api/projects/:id ────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { name, description, color, is_active } = req.body;
  if (!name?.trim())
    return res.status(400).json({ error: "name is required" });
  try {
    const result = await pool.query(
      `UPDATE projects
       SET name = $1, description = $2, color = $3, is_active = $4
       WHERE id = $5 AND business_id = $6 RETURNING *`,
      [
        name.trim(),
        description || null,
        color || "#4f8ef7",
        is_active !== false,
        id,
        businessId,
      ],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update project error:", err);
    return res.status(500).json({ error: "Failed to update project" });
  }
});

// ── DELETE /api/projects/:id ─────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM projects WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    return res.json({ message: "Project deleted" });
  } catch (err) {
    console.error("Delete project error:", err);
    return res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
