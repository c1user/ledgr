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

// ── Helper: generate JWT ──────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    {
      userId: user.id,
      businessId: user.business_id,
      role: user.role,
    },
    JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      algorithm: "HS256", // Explicit algorithm prevents algorithm confusion attacks
    },
  );

// ── POST /api/auth/register ───────────────────────────────────
router.post("/register", async (req, res) => {
  const { businessName, email, password, taxId, currency } = req.body;

  // OWASP A03: Input validation
  if (!businessName || !email || !password) {
    return res
      .status(400)
      .json({ error: "Business name, email, and password are required" });
  }

  // Validate email format
  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // OWASP A07: Password strength — minimum viable for financial data
  if (password.length < 12) {
    return res
      .status(400)
      .json({ error: "Password must be at least 12 characters" });
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasUpper || !hasLower || !hasDigit) {
    return res.status(400).json({
      error: "Password must contain uppercase, lowercase, and a number",
    });
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

    const userResult = await client.query(
      `INSERT INTO users (business_id, name, email, role, password_hash)
       VALUES ($1, $2, $3, 'owner', $4)
       RETURNING id, business_id, name, email, role, language`,
      [business.id, safeName, email.toLowerCase().trim(), passwordHash],
    );
    const user = userResult.rows[0];

    // Seed the standard chart of accounts (i18n keys, not English strings)
    await seedChartOfAccounts(client, business.id);

    await client.query("COMMIT");

    const token = signToken(user);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        language: user.language,
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
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.password_hash, u.language,
              b.name AS business_name, b.plan, b.currency
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()],
    );

    // OWASP A02: Run bcrypt compare even on miss to prevent timing attacks
    const DUMMY_HASH =
      "$2a$14$dummyhashtopreventtimingattacksonnonexistentusers000000";
    const passwordMatch =
      result.rows.length > 0
        ? await bcrypt.compare(password, result.rows[0].password_hash)
        : await bcrypt.compare(password, DUMMY_HASH).then(() => false);

    if (result.rows.length === 0 || !passwordMatch) {
      // OWASP A07: Generic error — never reveal whether email exists
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

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

// ── GET /api/auth/me ──────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.last_login, u.language,
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
