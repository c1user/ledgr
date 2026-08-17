/**
 * routes/notifications.js — the in-app notification center + email prefs.
 *
 * Mount in server.js:  app.use("/api/notifications", notificationRoutes);
 * NOTE: /unsubscribe is PUBLIC (email links open logged-out), so requireAuth
 * is applied per-route rather than router-wide.
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { CATEGORIES } from "../services/notifications.js";

const router = express.Router();

// ── GET /api/notifications ───────────────────────────────────
// Latest 30 for the bell, plus the unread badge count.
router.get("/", requireAuth, async (req, res) => {
  try {
    const [list, unread] = await Promise.all([
      pool.query(
        `SELECT id, type, title, body, link, read_at, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 30`,
        [req.user.userId],
      ),
      pool.query(
        "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL",
        [req.user.userId],
      ),
    ]);
    return res.json({
      notifications: list.rows,
      unreadCount: unread.rows[0].n,
    });
  } catch (err) {
    console.error("List notifications error:", err.message);
    return res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// ── POST /api/notifications/mark-read ────────────────────────
// Body: { id } for one, or { all: true } for everything unread.
router.post("/mark-read", requireAuth, async (req, res) => {
  const { id, all } = req.body;
  if (!id && all !== true) {
    return res.status(400).json({ error: "Provide an id or all: true" });
  }
  try {
    if (all === true) {
      await pool.query(
        "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
        [req.user.userId],
      );
    } else {
      await pool.query(
        "UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2",
        [id, req.user.userId],
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Mark read error:", err.message);
    return res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ── GET /api/notifications/prefs ─────────────────────────────
// Full category list with effective values (missing key = enabled).
router.get("/prefs", requireAuth, async (req, res) => {
  try {
    const r = await pool.query("SELECT notify_prefs FROM users WHERE id = $1", [
      req.user.userId,
    ]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const stored = r.rows[0].notify_prefs || {};
    const prefs = {};
    for (const c of CATEGORIES) prefs[c] = stored[c] !== false;
    return res.json({ prefs, categories: CATEGORIES });
  } catch (err) {
    console.error("Get prefs error:", err.message);
    return res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// ── PUT /api/notifications/prefs ─────────────────────────────
// Body: { invoices: bool, team: bool, ... } — unknown keys rejected.
router.put("/prefs", requireAuth, async (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (keys.length === 0 || keys.some((k) => !CATEGORIES.includes(k))) {
    return res.status(400).json({ error: "Unknown notification category" });
  }
  if (keys.some((k) => typeof updates[k] !== "boolean")) {
    return res.status(400).json({ error: "Preference values must be boolean" });
  }
  try {
    const r = await pool.query(
      `UPDATE users SET notify_prefs = COALESCE(notify_prefs, '{}'::jsonb) || $2::jsonb
       WHERE id = $1
       RETURNING notify_prefs`,
      [req.user.userId, JSON.stringify(updates)],
    );
    const stored = r.rows[0].notify_prefs || {};
    const prefs = {};
    for (const c of CATEGORIES) prefs[c] = stored[c] !== false;
    return res.json({ prefs });
  } catch (err) {
    console.error("Update prefs error:", err.message);
    return res.status(500).json({ error: "Failed to update preferences" });
  }
});

// ── POST /api/notifications/unsubscribe ──────────────────────
// PUBLIC: the one-click link at the bottom of every preference-gated email.
// Body: { token, category } — category "all" turns every category off.
router.post("/unsubscribe", async (req, res) => {
  const { token, category } = req.body;
  if (!token || typeof token !== "string" || token.length > 128) {
    return res.status(400).json({ error: "Invalid unsubscribe link" });
  }
  const valid = category === "all" || CATEGORIES.includes(category);
  if (!valid) {
    return res.status(400).json({ error: "Unknown email category" });
  }
  try {
    const off = {};
    for (const c of category === "all" ? CATEGORIES : [category]) {
      off[c] = false;
    }
    const r = await pool.query(
      `UPDATE users SET notify_prefs = COALESCE(notify_prefs, '{}'::jsonb) || $2::jsonb
       WHERE unsubscribe_token = $1
       RETURNING id`,
      [token, JSON.stringify(off)],
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ error: "Invalid unsubscribe link" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Unsubscribe error:", err.message);
    return res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

export default router;
