import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// ── GET /api/time-entries ────────────────────────────────────
// Filters: week=YYYY-MM-DD (Monday), project_id, user_id, startDate, endDate
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { week, project_id, user_id, startDate, endDate } = req.query;

  try {
    let query = `
      SELECT
        te.id, te.date, te.hours, te.description, te.is_billable, te.hourly_rate,
        te.created_at, te.user_id,
        u.name  AS user_name,
        te.project_id,
        p.name  AS project_name,
        p.color AS project_color
      FROM time_entries te
      LEFT JOIN users    u ON u.id = te.user_id
      LEFT JOIN projects p ON p.id = te.project_id
      WHERE te.business_id = $1
    `;
    const params = [businessId];
    let n = 1;

    if (week) {
      n++;
      query += ` AND te.date >= $${n}::date`;
      params.push(week);
      n++;
      query += ` AND te.date < $${n}::date + INTERVAL '7 days'`;
      params.push(week);
    } else if (startDate) {
      n++;
      query += ` AND te.date >= $${n}::date`;
      params.push(startDate);
      if (endDate) {
        n++;
        query += ` AND te.date <= $${n}::date`;
        params.push(endDate);
      }
    }

    if (project_id) {
      n++;
      query += ` AND te.project_id = $${n}`;
      params.push(project_id);
    }

    if (user_id) {
      n++;
      query += ` AND te.user_id = $${n}`;
      params.push(user_id);
    }

    query += ` ORDER BY te.date ASC, te.created_at ASC`;

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Get time entries error:", err);
    return res.status(500).json({ error: "Failed to fetch time entries" });
  }
});

// ── POST /api/time-entries ───────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId, id: userId } = req.user;
  const { projectId, date, hours, description, isBillable, hourlyRate } =
    req.body;

  if (!date) return res.status(400).json({ error: "date is required" });
  const h = parseFloat(hours);
  if (!h || h <= 0)
    return res.status(400).json({ error: "hours must be greater than 0" });

  try {
    const result = await pool.query(
      `INSERT INTO time_entries
         (business_id, user_id, project_id, date, hours, description, is_billable, hourly_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        businessId,
        userId,
        projectId || null,
        date,
        h,
        description || null,
        isBillable !== false,
        hourlyRate ? parseFloat(hourlyRate) : null,
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create time entry error:", err);
    return res.status(500).json({ error: "Failed to create time entry" });
  }
});

// ── PUT /api/time-entries/:id ────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { projectId, date, hours, description, isBillable, hourlyRate } =
    req.body;

  if (!date) return res.status(400).json({ error: "date is required" });
  const h = parseFloat(hours);
  if (!h || h <= 0)
    return res.status(400).json({ error: "hours must be greater than 0" });

  try {
    const result = await pool.query(
      `UPDATE time_entries
       SET project_id  = $1,
           date        = $2,
           hours       = $3,
           description = $4,
           is_billable = $5,
           hourly_rate = $6
       WHERE id = $7 AND business_id = $8 RETURNING *`,
      [
        projectId || null,
        date,
        h,
        description || null,
        isBillable !== false,
        hourlyRate ? parseFloat(hourlyRate) : null,
        id,
        businessId,
      ],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Time entry not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update time entry error:", err);
    return res.status(500).json({ error: "Failed to update time entry" });
  }
});

// ── DELETE /api/time-entries/:id ─────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM time_entries WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Time entry not found" });
    return res.json({ message: "Time entry deleted" });
  } catch (err) {
    console.error("Delete time entry error:", err);
    return res.status(500).json({ error: "Failed to delete time entry" });
  }
});

export default router;
