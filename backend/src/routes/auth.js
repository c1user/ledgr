import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ── Helper: generate JWT ──────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    {
      userId: user.id,
      businessId: user.business_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

// ── POST /api/auth/register ───────────────────────────────────
// Creates a new business + owner user in one transaction
router.post("/register", async (req, res) => {
  const { businessName, email, password, taxId, currency } = req.body;

  if (!businessName || !email || !password) {
    return res
      .status(400)
      .json({ error: "Business name, email, and password are required" });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check if email already exists
    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }

    // Create the business
    const businessResult = await client.query(
      `INSERT INTO businesses (name, email, tax_id, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, plan, currency`,
      [businessName, email.toLowerCase(), taxId || null, currency || "USD"],
    );
    const business = businessResult.rows[0];

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create the owner user
    const userResult = await client.query(
      `INSERT INTO users (business_id, name, email, role, password_hash)
       VALUES ($1, $2, $3, 'owner', $4)
       RETURNING id, business_id, name, email, role`,
      [business.id, businessName, email.toLowerCase(), passwordHash],
    );
    const user = userResult.rows[0];

    // Seed default categories for the new business
    const defaultCategories = [
      { name: "Revenue", type: "income", color: "#00C896" },
      { name: "Consulting", type: "income", color: "#5DCAA5" },
      { name: "Other Income", type: "income", color: "#9FE1CB" },
      { name: "Payroll", type: "expense", color: "#4F8EF7" },
      { name: "Utilities", type: "expense", color: "#A259FF" },
      { name: "Rent", type: "expense", color: "#F7934C" },
      { name: "Supplies", type: "expense", color: "#F7C948" },
      { name: "Marketing", type: "expense", color: "#E24B4A" },
      { name: "Other Expense", type: "expense", color: "#888780" },
    ];

    for (const cat of defaultCategories) {
      await client.query(
        `INSERT INTO categories (business_id, name, type, color, is_system)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [business.id, cat.name, cat.type, cat.color],
      );
    }

    await client.query("COMMIT");

    const token = signToken(user);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
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
    console.error("Register error:", err);
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

  try {
    // Get user + business in one query
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.password_hash,
              b.name AS business_name, b.plan, b.currency
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.email = $1`,
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Update last login
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
      },
      business: {
        id: user.business_id,
        name: user.business_name,
        plan: user.plan,
        currency: user.currency,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
// Returns the currently logged in user (requires token)
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.business_id, u.name, u.email, u.role, u.last_login,
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
      },
      business: {
        id: user.business_id,
        name: user.business_name,
        plan: user.plan,
        currency: user.currency,
        taxId: user.tax_id,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
