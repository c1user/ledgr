import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendSupportEmail } from "../services/email.js";

const router = express.Router();

// Deliberately no plan gate — support must be reachable on every tier,
// including a Starter user whose problem IS their plan.
router.use(requireAuth);

const CATEGORIES = new Set(["bug", "billing", "question", "feedback"]);

// ── POST /api/support ─────────────────────────────────────────
// Persist the request (the trail), then forward it to the support inbox
// with the reporting user as reply-to. The row is kept even if the email
// fails — nothing a user reports should be lost to a mail hiccup.
router.post("/", async (req, res) => {
  const { businessId, userId } = req.user;
  const category = String(req.body.category || "");
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();
  const ctx = req.body.context || {};

  if (!CATEGORIES.has(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }
  if (!subject || subject.length > 200) {
    return res
      .status(400)
      .json({ error: "A subject is required (max 200 characters)" });
  }
  if (!message || message.length > 5000) {
    return res
      .status(400)
      .json({ error: "A message is required (max 5000 characters)" });
  }

  try {
    const who = await pool.query(
      `SELECT u.name, u.email, u.role, b.name AS business_name, b.plan
       FROM users u JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1`,
      [userId],
    );
    const user = who.rows[0];

    const context = {
      page: typeof ctx.page === "string" ? ctx.page.slice(0, 200) : null,
      mode: typeof ctx.mode === "string" ? ctx.mode.slice(0, 40) : null,
      userAgent: req.headers["user-agent"]?.slice(0, 300) || null,
    };

    const inserted = await pool.query(
      `INSERT INTO support_requests
         (business_id, user_id, user_email, category, subject, message, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, category, subject, message, context, status, created_at`,
      [
        businessId,
        userId,
        user.email,
        category,
        subject,
        message,
        JSON.stringify(context),
      ],
    );
    const request = inserted.rows[0];

    const email = await sendSupportEmail({
      request,
      user: { name: user.name, email: user.email, role: user.role },
      business: { name: user.business_name, plan: user.plan },
    });

    return res.status(201).json({
      id: request.id,
      created_at: request.created_at,
      email: { delivered: email.delivered, fallback: email.fallback },
    });
  } catch (err) {
    console.error("Support request error:", err);
    return res.status(500).json({ error: "Failed to submit your request" });
  }
});

export default router;
