import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

// ── GET /api/rules ────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        r.id, r.priority, r.name, r.match_type, r.pattern,
        r.category_id, r.is_active, r.created_at,
        c.name_key AS category_name_key, c.name AS category_name,
        c.color AS category_color,
        CASE WHEN c.account_type = 'revenue' THEN 'income' ELSE 'expense' END AS category_type
       FROM categorization_rules r
       JOIN chart_of_accounts c ON c.id = r.category_id
       WHERE r.business_id = $1
       ORDER BY r.priority ASC, r.created_at ASC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get rules error:", err);
    return res.status(500).json({ error: "Failed to fetch rules" });
  }
});

// ── POST /api/rules/reorder ───────────────────────────────────
// Must be before /:id routes to avoid matching "reorder" as an id
router.post("/reorder", async (req, res) => {
  const { businessId } = req.user;
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        "UPDATE categorization_rules SET priority = $1 WHERE id = $2 AND business_id = $3",
        [i, ids[i], businessId],
      );
    }
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reorder rules error:", err);
    return res.status(500).json({ error: "Failed to reorder rules" });
  } finally {
    client.release();
  }
});

// ── POST /api/rules/test ──────────────────────────────────────
router.post("/test", async (req, res) => {
  const { businessId } = req.user;
  const { match_type, pattern } = req.body;

  if (!match_type || !pattern) {
    return res.status(400).json({ error: "match_type and pattern are required" });
  }

  try {
    let whereClause;
    let params;

    if (match_type === "contains") {
      whereClause = `(LOWER(merchant) LIKE '%' || LOWER($2) || '%' OR LOWER(notes) LIKE '%' || LOWER($2) || '%')`;
      params = [businessId, pattern];
    } else if (match_type === "equals") {
      whereClause = `LOWER(merchant) = LOWER($2)`;
      params = [businessId, pattern];
    } else if (match_type === "regex") {
      // Validate regex before running the query
      try {
        new RegExp(pattern);
      } catch {
        return res.status(400).json({ error: "Invalid regex pattern" });
      }
      whereClause = `(merchant ~* $2 OR notes ~* $2)`;
      params = [businessId, pattern];
    } else {
      return res.status(400).json({ error: "Invalid match_type" });
    }

    const [countResult, samplesResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM transactions WHERE business_id = $1 AND ${whereClause}`,
        params,
      ),
      pool.query(
        `SELECT merchant, date, total_amount, type FROM transactions
         WHERE business_id = $1 AND ${whereClause}
         ORDER BY date DESC LIMIT 5`,
        params,
      ),
    ]);

    return res.json({
      count: parseInt(countResult.rows[0].count),
      samples: samplesResult.rows,
    });
  } catch (err) {
    console.error("Test rule error:", err);
    return res.status(500).json({ error: "Failed to test rule" });
  }
});

// ── POST /api/rules ───────────────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const { name, match_type, pattern, category_id, is_active = true } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  if (!["contains", "equals", "regex"].includes(match_type)) {
    return res.status(400).json({ error: "match_type must be contains, equals, or regex" });
  }
  if (!pattern?.trim()) return res.status(400).json({ error: "pattern is required" });
  if (!category_id) return res.status(400).json({ error: "category_id is required" });

  if (match_type === "regex") {
    try { new RegExp(pattern); } catch {
      return res.status(400).json({ error: "Invalid regex pattern" });
    }
  }

  try {
    const catCheck = await pool.query(
      `SELECT id FROM chart_of_accounts
       WHERE id = $1 AND business_id = $2
         AND account_type IN ('revenue', 'expense')`,
      [category_id, businessId],
    );
    if (catCheck.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Assign lowest priority (highest number) by default
    const maxResult = await pool.query(
      "SELECT COALESCE(MAX(priority), -1) + 1 AS next_priority FROM categorization_rules WHERE business_id = $1",
      [businessId],
    );
    const priority = maxResult.rows[0].next_priority;

    const result = await pool.query(
      `INSERT INTO categorization_rules (business_id, priority, name, match_type, pattern, category_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [businessId, priority, name.trim(), match_type, pattern.trim(), category_id, is_active],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create rule error:", err);
    return res.status(500).json({ error: "Failed to create rule" });
  }
});

// ── PUT /api/rules/:id ────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const { name, match_type, pattern, category_id, is_active } = req.body;

  if (match_type && !["contains", "equals", "regex"].includes(match_type)) {
    return res.status(400).json({ error: "Invalid match_type" });
  }
  if (match_type === "regex" && pattern) {
    try { new RegExp(pattern); } catch {
      return res.status(400).json({ error: "Invalid regex pattern" });
    }
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM categorization_rules WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }

    if (category_id) {
      const catCheck = await pool.query(
        `SELECT id FROM chart_of_accounts
         WHERE id = $1 AND business_id = $2
           AND account_type IN ('revenue', 'expense')`,
        [category_id, businessId],
      );
      if (catCheck.rows.length === 0) {
        return res.status(404).json({ error: "Category not found" });
      }
    }

    const result = await pool.query(
      `UPDATE categorization_rules
       SET
         name        = COALESCE($1, name),
         match_type  = COALESCE($2, match_type),
         pattern     = COALESCE($3, pattern),
         category_id = COALESCE($4, category_id),
         is_active   = COALESCE($5, is_active)
       WHERE id = $6 AND business_id = $7
       RETURNING *`,
      [name?.trim() || null, match_type || null, pattern?.trim() || null, category_id || null, is_active ?? null, id, businessId],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update rule error:", err);
    return res.status(500).json({ error: "Failed to update rule" });
  }
});

// ── DELETE /api/rules/:id ─────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM categorization_rules WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete rule error:", err);
    return res.status(500).json({ error: "Failed to delete rule" });
  }
});

export default router;
