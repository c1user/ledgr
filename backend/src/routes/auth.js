/**
 * auth.js (SECURITY-HARDENED)
 *
 * Fixes applied:
 * - OWASP A02: JWT secret entropy validation at startup (crashes fast if missing)
 * - OWASP A07: Added password complexity requirements
 * - OWASP A04: Rate limiting applied (import authLimiter in server.js)
 * - Input validation via validator library (npm install validator)
 */

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import validator from "validator";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { seedChartOfAccounts } from "../services/coaSeed.js";
import { seedPayrollRules } from "../services/payrollRulesSeed.js";
import crypto from "crypto";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from "../services/email.js";
import {
  generateSecret,
  verifyTotp,
  otpauthUrl,
  generateBackupCodes,
  hashBackupCode,
} from "../services/totp.js";
import { notify } from "../services/notifications.js";

const router = express.Router();

// ── OWASP A02: Validate JWT secret at module load time ────────
// This crashes the server fast rather than silently accepting a weak secret.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    "FATAL: JWT_SECRET env var is missing or too short (minimum 32 characters). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
  );
}

// ── Helper: OWASP A07 password policy (shared by every route that
// sets a password). Returns an error message, or null when acceptable.
const passwordPolicyError = (password) => {
  if (!password || password.length < 12) {
    return "Password must be at least 12 characters";
  }
  if (
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return "Password must contain uppercase, lowercase, and a number";
  }
  return null;
};

// ── Helper: generate JWT ──────────────────────────────────────
// tokenVersion pins the JWT to the user's current session generation —
// requireAuth rejects tokens whose version no longer matches the DB.
const signToken = (user) =>
  jwt.sign(
    {
      userId: user.id,
      businessId: user.business_id,
      role: user.role,
      tokenVersion: user.token_version ?? 0,
    },
    JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      algorithm: "HS256", // Explicit algorithm prevents algorithm confusion attacks
    },
  );

// Short-lived intermediate token for the 2FA login step: proves the
// password check passed without granting any API access.
const signMfaToken = (userId) =>
  jwt.sign({ userId, mfa: true }, JWT_SECRET, {
    expiresIn: "5m",
    algorithm: "HS256",
  });

// Consume a backup code: returns the remaining hashes array if it matched,
// or null. Codes are single-use — the matched hash is removed.
const consumeBackupCode = (storedHashes, code) => {
  if (!Array.isArray(storedHashes)) return null;
  const submitted = hashBackupCode(code);
  const idx = storedHashes.indexOf(submitted);
  if (idx === -1) return null;
  return storedHashes.filter((_, i) => i !== idx);
};

// ── POST /api/auth/register ───────────────────────────────────
router.post("/register", async (req, res) => {
  const { businessName, email, password, taxId, currency, consent } = req.body;

  // OWASP A03: Input validation
  if (!businessName || !email || !password) {
    return res
      .status(400)
      .json({ error: "Business name, email, and password are required" });
  }

  // Signup consent — the account record keeps the timestamp (consented_at)
  if (consent !== true) {
    return res.status(400).json({
      error: "You must agree to the Terms of Service and Privacy Policy",
    });
  }

  // Validate email format
  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // OWASP A07: Password strength — minimum viable for financial data
  const policyError = passwordPolicyError(password);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  // Sanitize businessName — strip control characters
  const safeName = validator.stripLow(businessName.trim());
  if (safeName.length < 2 || safeName.length > 100) {
    return res
      .status(400)
      .json({ error: "Business name must be 2–100 characters" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase().trim()],
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }

    const businessResult = await client.query(
      `INSERT INTO businesses (name, email, tax_id, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, plan, currency`,
      [safeName, email.toLowerCase().trim(), taxId || null, currency || "USD"],
    );
    const business = businessResult.rows[0];

    // OWASP A02: Increased bcrypt cost factor for financial app
    const passwordHash = await bcrypt.hash(password, 14);

    // New signups start unverified with a 24h verification link.
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const userResult = await client.query(
      `INSERT INTO users (business_id, name, email, role, password_hash,
                          consented_at, verify_token, verify_expires_at,
                          unsubscribe_token)
       VALUES ($1, $2, $3, 'owner', $4, NOW(), $5, NOW() + INTERVAL '24 hours',
               $6)
       RETURNING id, business_id, name, email, role, language, email_verified,
                 token_version`,
      [
        business.id,
        safeName,
        email.toLowerCase().trim(),
        passwordHash,
        verifyToken,
        crypto.randomBytes(24).toString("hex"),
      ],
    );
    const user = userResult.rows[0];

    // Seed the standard chart of accounts (i18n keys, not English strings)
    await seedChartOfAccounts(client, business.id);

    // Seed the UNVERIFIED payroll rule placeholders (ROADMAP-V5 Phase 1)
    await seedPayrollRules(client, business.id);

    await client.query("COMMIT");

    // Fire-and-forget — a mail hiccup must never fail a registration.
    const mailLang = req.body.lang === "es" ? "es" : "en";
    sendWelcomeEmail({
      to: user.email,
      name: user.name,
      businessName: business.name,
      lang: mailLang,
    }).catch(() => {});
    const base = process.env.APP_URL || "http://localhost:5173";
    sendVerificationEmail({
      to: user.email,
      verifyLink: `${base}/verify-email?token=${verifyToken}`,
      lang: mailLang,
    }).catch(() => {});

    const token = signToken(user);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        language: user.language,
        emailVerified: user.email_verified,
        totpEnabled: false,
        tourDone: false,
      },
      business: {
        id: business.id,
        name: business.name,
        plan: business.plan,
        currency: business.currency,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Register error:", err.message); // Never log full err stack to console in prod
    return res
      .status(500)
      .json({ error: "Registration failed. Please try again." });
  } finally {
    client.release();
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // OWASP A03: Validate email before hitting DB
  if (!validator.isEmail(email)) {
    return res.status(401).json({ error: "Invalid email or password" }); // Generic response
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.password_hash,
              u.language, u.is_active, u.email_verified, u.totp_enabled,
              u.token_version, u.tour_done_at,
              b.name AS business_name, b.plan, b.currency
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()],
    );

    // OWASP A02: Run bcrypt compare even on miss to prevent timing attacks.
    // Pending invites (NULL password_hash) and deactivated users fall through
    // to the same generic error — never reveal account state.
    const DUMMY_HASH =
      "$2a$14$dummyhashtopreventtimingattacksonnonexistentusers000000";
    const passwordMatch =
      result.rows.length > 0 && result.rows[0].password_hash
        ? await bcrypt.compare(password, result.rows[0].password_hash)
        : await bcrypt.compare(password, DUMMY_HASH).then(() => false);

    if (
      result.rows.length === 0 ||
      !passwordMatch ||
      !result.rows[0].is_active
    ) {
      // OWASP A07: Generic error — never reveal whether email exists
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // 2FA: the password alone doesn't finish the login — hand back a
    // short-lived MFA token and wait for the authenticator code.
    if (user.totp_enabled) {
      return res.json({ mfaRequired: true, mfaToken: signMfaToken(user.id) });
    }

    await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [
      user.id,
    ]);

    const token = signToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        language: user.language,
        emailVerified: user.email_verified,
        totpEnabled: user.totp_enabled,
        tourDone: !!user.tour_done_at,
      },
      business: {
        id: user.business_id,
        name: user.business_name,
        plan: user.plan,
        currency: user.currency,
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────
// Public. ALWAYS answers 200 with the same body — never reveals whether an
// account exists (OWASP A07 enumeration). The reset link is only actually
// sent for active accounts that have a password (pending invites keep
// their invite link instead).
router.post("/forgot-password", async (req, res) => {
  const email = String(req.body.email || "")
    .toLowerCase()
    .trim();
  const lang = req.body.lang === "es" ? "es" : "en";
  const GENERIC = {
    ok: true,
    message: "If that account exists, a reset link is on its way.",
  };

  if (!validator.isEmail(email)) return res.json(GENERIC);

  try {
    const user = await pool.query(
      `SELECT id FROM users
       WHERE email = $1 AND is_active AND password_hash IS NOT NULL`,
      [email],
    );
    if (user.rows.length > 0) {
      const token = crypto.randomBytes(32).toString("hex");
      await pool.query(
        `UPDATE users
         SET reset_token = $2, reset_expires_at = NOW() + INTERVAL '1 hour'
         WHERE id = $1`,
        [user.rows[0].id, token],
      );
      const base = process.env.APP_URL || "http://localhost:5173";
      await sendPasswordResetEmail({
        to: email,
        resetLink: `${base}/reset-password?token=${token}`,
        lang,
      });
    }
    return res.json(GENERIC);
  } catch (err) {
    // Even on an internal error, don't leak account existence.
    console.error("Forgot password error:", err.message);
    return res.json(GENERIC);
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────
// Public: a valid, unexpired token sets a new password (same policy as
// register) and logs the user straight in.
router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;

  if (!token || typeof token !== "string" || token.length > 128) {
    return res.status(400).json({ error: "Invalid reset token" });
  }
  const policyError = passwordPolicyError(password);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.language,
              b.name AS business_name, b.plan, b.currency
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.reset_token = $1
         AND u.is_active
         AND u.reset_expires_at > NOW()`,
      [token],
    );
    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "This reset link is invalid or has expired" });
    }
    const user = result.rows[0];

    const passwordHash = await bcrypt.hash(password, 14);
    // token_version bump signs out every other device along with the reset.
    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $2, reset_token = NULL, reset_expires_at = NULL,
           email_verified = true, -- following an emailed link proves the inbox
           token_version = token_version + 1,
           last_login = NOW()
       WHERE id = $1
       RETURNING token_version`,
      [user.id, passwordHash],
    );

    const jwtToken = signToken({
      ...user,
      token_version: updated.rows[0].token_version,
    });
    return res.json({
      token: jwtToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        language: user.language,
      },
      business: {
        id: user.business_id,
        name: user.business_name,
        plan: user.plan,
        currency: user.currency,
      },
    });
  } catch (err) {
    console.error("Reset password error:", err.message);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

// ── POST /api/auth/accept-invite ──────────────────────────────
// Public: an invited user (row with NULL password_hash + a valid token)
// sets their name and password, then gets logged straight in.
router.post("/accept-invite", async (req, res) => {
  const { token, name, password } = req.body;

  if (!token || typeof token !== "string" || token.length > 128) {
    return res.status(400).json({ error: "Invalid invite token" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  // Same password policy as register.
  const policyError = passwordPolicyError(password);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.email, u.role, u.language,
              u.token_version,
              b.name AS business_name, b.plan, b.currency
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.invite_token = $1
         AND u.password_hash IS NULL
         AND u.is_active
         AND u.invite_expires_at > NOW()`,
      [token],
    );
    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "This invite link is invalid or has expired" });
    }
    const invited = result.rows[0];

    const safeName = validator.stripLow(String(name)).trim().slice(0, 120);
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `UPDATE users
       SET name = $2, password_hash = $3,
           email_verified = true, -- the invite arrived at this address
           invite_token = NULL, invite_expires_at = NULL, last_login = NOW()
       WHERE id = $1`,
      [invited.id, safeName, passwordHash],
    );

    // Tell the rest of the team their invitee arrived. Fire-and-forget.
    notify({
      businessId: invited.business_id,
      type: "invite_accepted",
      category: "team",
      title: `${safeName} joined the team`,
      body: `${invited.email} accepted their invite (${invited.role})`,
      link: "/team",
      excludeUserId: invited.id,
      email: {
        subject: `${safeName} joined your Abaco team`,
        text: `${safeName} (${invited.email}) accepted their invite to ${invited.business_name} as ${invited.role}.`,
      },
    });

    const jwtToken = signToken(invited);
    return res.json({
      token: jwtToken,
      user: {
        id: invited.id,
        name: safeName,
        email: invited.email,
        role: invited.role,
        language: invited.language,
      },
      business: {
        id: invited.business_id,
        name: invited.business_name,
        plan: invited.plan,
        currency: invited.currency,
      },
    });
  } catch (err) {
    console.error("Accept invite error:", err.message);
    return res.status(500).json({ error: "Failed to accept invite" });
  }
});

// ── POST /api/auth/verify-email ───────────────────────────────
// Public: a valid, unexpired token marks the address verified. Single-use.
router.post("/verify-email", async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== "string" || token.length > 128) {
    return res.status(400).json({ error: "Invalid verification token" });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = true, verify_token = NULL, verify_expires_at = NULL
       WHERE verify_token = $1 AND is_active AND verify_expires_at > NOW()
       RETURNING id`,
      [token],
    );
    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "This verification link is invalid or has expired" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Verify email error:", err.message);
    return res.status(500).json({ error: "Failed to verify email" });
  }
});

// ── POST /api/auth/resend-verification ────────────────────────
// Logged-in user asks for a fresh verification link (24h TTL).
router.post("/resend-verification", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT email, language, email_verified FROM users WHERE id = $1",
      [req.user.userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = result.rows[0];
    if (user.email_verified) {
      return res.json({ ok: true, verified: true });
    }

    const verifyToken = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `UPDATE users
       SET verify_token = $2, verify_expires_at = NOW() + INTERVAL '24 hours'
       WHERE id = $1`,
      [req.user.userId, verifyToken],
    );
    const base = process.env.APP_URL || "http://localhost:5173";
    await sendVerificationEmail({
      to: user.email,
      verifyLink: `${base}/verify-email?token=${verifyToken}`,
      lang: user.language === "es" ? "es" : "en",
    });
    return res.json({ ok: true, verified: false });
  } catch (err) {
    console.error("Resend verification error:", err.message);
    return res.status(500).json({ error: "Failed to send verification email" });
  }
});

// ── POST /api/auth/change-password ────────────────────────────
// Logged-in user proves the current password and sets a new one.
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword) {
    return res.status(400).json({ error: "Current password is required" });
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  try {
    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1 AND is_active",
      [req.user.userId],
    );
    if (result.rows.length === 0 || !result.rows[0].password_hash) {
      return res.status(404).json({ error: "User not found" });
    }

    const matches = await bcrypt.compare(
      currentPassword,
      result.rows[0].password_hash,
    );
    if (!matches) {
      // 400, not 401 — the session is fine; the frontend interceptor treats
      // 401 as an expired token and would log the user out mid-form.
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 14);
    // A password change invalidates any outstanding reset link AND signs out
    // every other device (token_version bump). The fresh token keeps THIS
    // session alive — the frontend swaps it in.
    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $2, reset_token = NULL, reset_expires_at = NULL,
           token_version = token_version + 1
       WHERE id = $1
       RETURNING id, business_id, role, token_version`,
      [req.user.userId, passwordHash],
    );
    return res.json({ ok: true, token: signToken(updated.rows[0]) });
  } catch (err) {
    console.error("Change password error:", err.message);
    return res.status(500).json({ error: "Failed to change password" });
  }
});

// ── POST /api/auth/2fa/setup ──────────────────────────────────
// Step 1 of enabling 2FA: prove the password, get a fresh secret to scan.
// The secret stays PENDING until a code is verified — abandoning setup
// changes nothing about how the user logs in.
router.post("/2fa/setup", requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const r = await pool.query(
      "SELECT email, password_hash, totp_enabled FROM users WHERE id = $1",
      [req.user.userId],
    );
    if (r.rows.length === 0 || !r.rows[0].password_hash) {
      return res.status(404).json({ error: "User not found" });
    }
    if (r.rows[0].totp_enabled) {
      return res
        .status(400)
        .json({ error: "Two-factor authentication is already enabled" });
    }
    const matches = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!matches) {
      return res.status(400).json({ error: "Password is incorrect" });
    }

    const secret = generateSecret();
    await pool.query(
      "UPDATE users SET totp_pending_secret = $2 WHERE id = $1",
      [req.user.userId, secret],
    );
    return res.json({
      secret,
      otpauthUrl: otpauthUrl(secret, r.rows[0].email),
    });
  } catch (err) {
    console.error("2FA setup error:", err.message);
    return res.status(500).json({ error: "Failed to start 2FA setup" });
  }
});

// ── POST /api/auth/2fa/enable ─────────────────────────────────
// Step 2: a valid code against the pending secret flips 2FA on and returns
// the backup codes — shown exactly once, only digests are stored. Other
// devices are signed out (they authenticated without 2FA).
router.post("/2fa/enable", requireAuth, async (req, res) => {
  const { code } = req.body;

  try {
    const r = await pool.query(
      "SELECT totp_pending_secret, totp_enabled FROM users WHERE id = $1",
      [req.user.userId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    if (r.rows[0].totp_enabled) {
      return res
        .status(400)
        .json({ error: "Two-factor authentication is already enabled" });
    }
    const pending = r.rows[0].totp_pending_secret;
    if (!pending) {
      return res.status(400).json({ error: "Start 2FA setup first" });
    }
    if (!verifyTotp(pending, code)) {
      return res
        .status(400)
        .json({ error: "That code didn't match — try again" });
    }

    const backupCodes = generateBackupCodes();
    const updated = await pool.query(
      `UPDATE users
       SET totp_enabled = true, totp_secret = $2, totp_pending_secret = NULL,
           backup_codes = $3, token_version = token_version + 1
       WHERE id = $1
       RETURNING id, business_id, role, token_version`,
      [
        req.user.userId,
        pending,
        JSON.stringify(backupCodes.map(hashBackupCode)),
      ],
    );
    return res.json({
      ok: true,
      backupCodes,
      token: signToken(updated.rows[0]),
    });
  } catch (err) {
    console.error("2FA enable error:", err.message);
    return res.status(500).json({ error: "Failed to enable 2FA" });
  }
});

// ── POST /api/auth/2fa/disable ────────────────────────────────
// Requires the password AND a current code (or a backup code).
router.post("/2fa/disable", requireAuth, async (req, res) => {
  const { password, code } = req.body;
  if (!password || !code) {
    return res.status(400).json({ error: "Password and code are required" });
  }

  try {
    const r = await pool.query(
      `SELECT password_hash, totp_enabled, totp_secret, backup_codes
       FROM users WHERE id = $1`,
      [req.user.userId],
    );
    if (r.rows.length === 0 || !r.rows[0].password_hash) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = r.rows[0];
    if (!user.totp_enabled) {
      return res
        .status(400)
        .json({ error: "Two-factor authentication is not enabled" });
    }
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(400).json({ error: "Password is incorrect" });
    }
    const codeOk =
      verifyTotp(user.totp_secret, code) ||
      consumeBackupCode(user.backup_codes, code) !== null;
    if (!codeOk) {
      return res
        .status(400)
        .json({ error: "That code didn't match — try again" });
    }

    const updated = await pool.query(
      `UPDATE users
       SET totp_enabled = false, totp_secret = NULL,
           totp_pending_secret = NULL, backup_codes = NULL,
           token_version = token_version + 1
       WHERE id = $1
       RETURNING id, business_id, role, token_version`,
      [req.user.userId],
    );
    return res.json({ ok: true, token: signToken(updated.rows[0]) });
  } catch (err) {
    console.error("2FA disable error:", err.message);
    return res.status(500).json({ error: "Failed to disable 2FA" });
  }
});

// ── POST /api/auth/2fa/verify-login ───────────────────────────
// Public second step of a 2FA login: the short-lived MFA token plus an
// authenticator code (or single-use backup code) completes the sign-in.
router.post("/2fa/verify-login", async (req, res) => {
  const { mfaToken, code } = req.body;
  if (!mfaToken || !code) {
    return res.status(400).json({ error: "Token and code are required" });
  }

  let decoded;
  try {
    decoded = jwt.verify(mfaToken, JWT_SECRET, { algorithms: ["HS256"] });
    if (decoded.mfa !== true) throw new Error("not an mfa token");
  } catch {
    return res
      .status(400)
      .json({ error: "Sign-in step expired — enter your password again" });
  }

  try {
    const r = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.language,
              u.email_verified, u.totp_enabled, u.totp_secret, u.backup_codes,
              u.token_version, u.tour_done_at,
              b.name AS business_name, b.plan, b.currency
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1 AND u.is_active`,
      [decoded.userId],
    );
    if (r.rows.length === 0 || !r.rows[0].totp_enabled) {
      return res.status(400).json({ error: "Invalid sign-in state" });
    }
    const user = r.rows[0];

    let verified = verifyTotp(user.totp_secret, code);
    if (!verified) {
      const remaining = consumeBackupCode(user.backup_codes, code);
      if (remaining !== null) {
        verified = true;
        await pool.query("UPDATE users SET backup_codes = $2 WHERE id = $1", [
          user.id,
          JSON.stringify(remaining),
        ]);
      }
    }
    if (!verified) {
      return res
        .status(400)
        .json({ error: "That code didn't match — try again" });
    }

    await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [
      user.id,
    ]);
    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        language: user.language,
        emailVerified: user.email_verified,
        totpEnabled: true,
        tourDone: !!user.tour_done_at,
      },
      business: {
        id: user.business_id,
        name: user.business_name,
        plan: user.plan,
        currency: user.currency,
      },
    });
  } catch (err) {
    console.error("2FA verify-login error:", err.message);
    return res.status(500).json({ error: "Failed to verify code" });
  }
});

// ── POST /api/auth/logout-all ─────────────────────────────────
// Bump token_version → every outstanding JWT (including this one) dies.
router.post("/logout-all", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
      [req.user.userId],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Logout-all error:", err.message);
    return res.status(500).json({ error: "Failed to sign out everywhere" });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.last_login, u.language,
              u.email_verified, u.totp_enabled, u.tour_done_at,
              b.name AS business_name, b.plan, b.currency, b.tax_id
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1`,
      [req.user.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        lastLogin: user.last_login,
        language: user.language,
        emailVerified: user.email_verified,
        totpEnabled: user.totp_enabled,
        tourDone: !!user.tour_done_at,
      },
      business: {
        id: user.business_id,
        name: user.business_name,
        plan: user.plan,
        currency: user.currency,
        // NOTE: taxId intentionally omitted from /me — only return it when explicitly needed
      },
    });
  } catch (err) {
    console.error("Me error:", err.message);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ── POST /api/auth/tour-done ──────────────────────────────────
// The user finished (or skipped) the first-run tour — never show it again.
router.post("/tour-done", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET tour_done_at = NOW() WHERE id = $1 AND tour_done_at IS NULL",
      [req.user.userId],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Tour done error:", err.message);
    return res.status(500).json({ error: "Failed to save tour state" });
  }
});

// ── PATCH /api/auth/language ──────────────────────────────────
// Update the current user's UI language preference
router.patch("/language", requireAuth, async (req, res) => {
  const { language } = req.body;

  // Strict allowlist — never trust client input for a CHECK-constrained column
  if (language !== "en" && language !== "es") {
    return res.status(400).json({ error: "Language must be 'en' or 'es'" });
  }

  try {
    await pool.query("UPDATE users SET language = $1 WHERE id = $2", [
      language,
      req.user.userId,
    ]);
    return res.json({ language });
  } catch (err) {
    console.error("Update language error:", err.message);
    return res.status(500).json({ error: "Failed to update language" });
  }
});

export default router;
