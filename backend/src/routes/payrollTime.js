/**
 * routes/payrollTime.js — daily payroll time entries (ROADMAP-V5 · Phase 3).
 * Daily granularity is required because PR overtime has a per-DAY
 * threshold. Bulk upsert keyed on (employee, work_date).
 */

import express from "express";
import pool from "../config/db.js";
import { requireRole } from "../middleware/auth.js";

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── GET /api/payroll-time?start&end ───────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { start, end } = req.query;
  if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) {
    return res
      .status(400)
      .json({ error: "start and end (YYYY-MM-DD) are required" });
  }
  try {
    const result = await pool.query(
      `SELECT employee_id, work_date, hours, meal_break_missed, notes
       FROM payroll_time_entries
       WHERE business_id = $1 AND work_date BETWEEN $2 AND $3
       ORDER BY work_date ASC`,
      [businessId, start, end],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("List payroll time error:", err);
    return res.status(500).json({ error: "Failed to fetch time entries" });
  }
});

// ── PUT /api/payroll-time ─────────────────────────────────────
// Bulk upsert: hours > 0 upserts, hours 0/null deletes the day.
router.put("/", requireRole("owner", "admin"), async (req, res) => {
  const { businessId } = req.user;
  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "entries array is required" });
  }
  for (const e of entries) {
    if (!e.employeeId || !DATE_RE.test(e.date || "")) {
      return res
        .status(400)
        .json({ error: "each entry needs employeeId and date (YYYY-MM-DD)" });
    }
    const h = e.hours;
    if (h != null && (typeof h !== "number" || h < 0 || h > 24)) {
      return res.status(400).json({ error: "hours must be 0–24" });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Employee ownership check — never write hours across businesses.
    const ids = [...new Set(entries.map((e) => e.employeeId))];
    const owned = await client.query(
      "SELECT id FROM employees WHERE id = ANY($1::uuid[]) AND business_id = $2",
      [ids, businessId],
    );
    if (owned.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found" });
    }

    let upserts = 0;
    let deletes = 0;
    for (const e of entries) {
      if (e.hours == null || e.hours === 0) {
        const r = await client.query(
          `DELETE FROM payroll_time_entries
           WHERE business_id = $1 AND employee_id = $2 AND work_date = $3`,
          [businessId, e.employeeId, e.date],
        );
        deletes += r.rowCount;
      } else {
        await client.query(
          `INSERT INTO payroll_time_entries
            (business_id, employee_id, work_date, hours, meal_break_missed, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (business_id, employee_id, work_date) DO UPDATE SET
            hours = EXCLUDED.hours,
            meal_break_missed = EXCLUDED.meal_break_missed,
            notes = EXCLUDED.notes`,
          [
            businessId,
            e.employeeId,
            e.date,
            e.hours,
            e.mealBreakMissed === true,
            e.notes || null,
          ],
        );
        upserts += 1;
      }
    }

    await client.query("COMMIT");
    return res.json({ upserts, deletes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Upsert payroll time error:", err);
    return res.status(500).json({ error: "Failed to save time entries" });
  } finally {
    client.release();
  }
});

export default router;
