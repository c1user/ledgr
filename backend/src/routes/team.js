import express from "express";
import crypto from "crypto";
import validator from "validator";
import pool from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import { sendInviteEmail } from "../services/email.js";

const router = express.Router();

router.use(requireAuth);
router.param("id", uuidParam("User"));

const INVITABLE_ROLES = new Set(["admin", "viewer"]);
const INVITE_TTL_DAYS = 7;

const inviteLink = (token) => {
  const base = process.env.APP_URL || "http://localhost:5173";
  return `${base}/join?token=${token}`;
};

async function fetchBusinessName(businessId) {
  const r = await pool.query("SELECT name FROM businesses WHERE id = $1", [
    businessId,
  ]);
  return r.rows[0]?.name || "";
}

// ── GET /api/team ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_active,
              (password_hash IS NULL) AS pending,
              invite_expires_at, last_login, created_at
       FROM users
       WHERE business_id = $1
       ORDER BY created_at ASC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("List team error:", err);
    return res.status(500).json({ error: "Failed to fetch team" });
  }
});

// ── POST /api/team/invites ────────────────────────────────────
// Owners and admins can invite. The invite is a user row with no password;
// the response always carries the link so it can be shared manually even
// when SMTP isn't configured.
router.post("/invites", requireRole("owner", "admin"), async (req, res) => {
  const { businessId } = req.user;
  const email = String(req.body.email || "")
    .toLowerCase()
    .trim();
  const role = req.body.role;
  const lang = req.body.lang === "es" ? "es" : "en";

  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if (!INVITABLE_ROLES.has(role)) {
    return res.status(400).json({ error: "Role must be admin or viewer" });
  }

  try {
    // Emails are globally unique (login has no business scope).
    const existing = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email],
    );
    if (existing.rowCount > 0) {
      return res
        .status(400)
        .json({ error: "A user with this email already exists" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const inserted = await pool.query(
      `INSERT INTO users
         (business_id, name, email, role, password_hash,
          invite_token, invite_expires_at, unsubscribe_token)
       VALUES ($1, $2, $3, $4, NULL, $5, NOW() + INTERVAL '${INVITE_TTL_DAYS} days',
               $6)
       RETURNING id, name, email, role, is_active,
                 (password_hash IS NULL) AS pending, created_at`,
      [
        businessId,
        email.split("@")[0],
        email,
        role,
        token,
        crypto.randomBytes(24).toString("hex"),
      ],
    );

    const link = inviteLink(token);
    const emailResult = await sendInviteEmail({
      to: email,
      businessName: await fetchBusinessName(businessId),
      inviteLink: link,
      lang,
    });

    return res.status(201).json({
      user: inserted.rows[0],
      inviteLink: link,
      email: emailResult,
    });
  } catch (err) {
    console.error("Create invite error:", err);
    return res.status(500).json({ error: "Failed to create invite" });
  }
});

// ── POST /api/team/:id/resend ─────────────────────────────────
router.post("/:id/resend", requireRole("owner", "admin"), async (req, res) => {
  const { businessId } = req.user;
  const lang = req.body.lang === "es" ? "es" : "en";
  try {
    const token = crypto.randomBytes(32).toString("hex");
    const updated = await pool.query(
      `UPDATE users
       SET invite_token = $3,
           invite_expires_at = NOW() + INTERVAL '${INVITE_TTL_DAYS} days'
       WHERE id = $1 AND business_id = $2 AND password_hash IS NULL
       RETURNING email`,
      [req.params.id, businessId, token],
    );
    if (updated.rowCount === 0) {
      return res.status(404).json({ error: "Pending invite not found" });
    }

    const link = inviteLink(token);
    const emailResult = await sendInviteEmail({
      to: updated.rows[0].email,
      businessName: await fetchBusinessName(businessId),
      inviteLink: link,
      lang,
    });
    return res.json({ inviteLink: link, email: emailResult });
  } catch (err) {
    console.error("Resend invite error:", err);
    return res.status(500).json({ error: "Failed to resend invite" });
  }
});

// ── PUT /api/team/:id ─────────────────────────────────────────
// Owner only: change role and/or active state. The last active owner can
// never be demoted or deactivated, and you can't edit yourself.
router.put("/:id", requireRole("owner"), async (req, res) => {
  const { businessId, userId } = req.user;
  const { role, isActive } = req.body;

  if (req.params.id === userId) {
    return res.status(400).json({ error: "You can't change your own account here" });
  }
  if (role !== undefined && !["owner", "admin", "viewer"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    const target = await pool.query(
      "SELECT id, role, is_active FROM users WHERE id = $1 AND business_id = $2",
      [req.params.id, businessId],
    );
    if (target.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Guard the last active owner.
    const becomingNonOwner = role !== undefined && role !== "owner";
    const becomingInactive = isActive === false;
    if (
      target.rows[0].role === "owner" &&
      (becomingNonOwner || becomingInactive)
    ) {
      const owners = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE business_id = $1 AND role = 'owner' AND is_active AND id <> $2`,
        [businessId, req.params.id],
      );
      if (owners.rows[0].n === 0) {
        return res
          .status(400)
          .json({ error: "The business must keep at least one active owner" });
      }
    }

    const updated = await pool.query(
      `UPDATE users
       SET role = COALESCE($3, role),
           is_active = COALESCE($4, is_active)
       WHERE id = $1 AND business_id = $2
       RETURNING id, name, email, role, is_active,
                 (password_hash IS NULL) AS pending, last_login, created_at`,
      [req.params.id, businessId, role ?? null, isActive ?? null],
    );
    return res.json(updated.rows[0]);
  } catch (err) {
    console.error("Update team member error:", err);
    return res.status(500).json({ error: "Failed to update user" });
  }
});

// ── DELETE /api/team/:id ──────────────────────────────────────
// Pending invites are removed outright (they never acted, so there's no
// history to preserve); real users are deactivated instead.
router.delete("/:id", requireRole("owner"), async (req, res) => {
  const { businessId, userId } = req.user;
  if (req.params.id === userId) {
    return res.status(400).json({ error: "You can't remove yourself" });
  }
  try {
    const target = await pool.query(
      `SELECT id, role, (password_hash IS NULL) AS pending
       FROM users WHERE id = $1 AND business_id = $2`,
      [req.params.id, businessId],
    );
    if (target.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (target.rows[0].pending) {
      await pool.query(
        "DELETE FROM users WHERE id = $1 AND business_id = $2",
        [req.params.id, businessId],
      );
      return res.json({ ok: true, removed: true });
    }

    if (target.rows[0].role === "owner") {
      const owners = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE business_id = $1 AND role = 'owner' AND is_active AND id <> $2`,
        [businessId, req.params.id],
      );
      if (owners.rows[0].n === 0) {
        return res
          .status(400)
          .json({ error: "The business must keep at least one active owner" });
      }
    }

    await pool.query(
      "UPDATE users SET is_active = FALSE WHERE id = $1 AND business_id = $2",
      [req.params.id, businessId],
    );
    return res.json({ ok: true, removed: false });
  } catch (err) {
    console.error("Remove team member error:", err);
    return res.status(500).json({ error: "Failed to remove user" });
  }
});

export default router;
