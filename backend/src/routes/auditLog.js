import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

const ACTIONS = new Set(["create", "update", "delete"]);

// ── GET /api/audit-log ────────────────────────────────────────
// Newest first; filter by ?action= and/or ?entityType=; paginate with
// ?limit= and ?offset=.
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = ["business_id = $1"];
  const params = [businessId];
  if (ACTIONS.has(req.query.action)) {
    params.push(req.query.action);
    where.push(`action = $${params.length}`);
  }
  if (req.query.entityType) {
    params.push(String(req.query.entityType));
    where.push(`entity_type = $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT id, user_id, user_name, action, entity_type, entity_id,
              summary, snapshot, created_at
       FROM audit_log
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Audit log list error:", err);
    return res.status(500).json({ error: "Failed to fetch activity" });
  }
});

export default router;
