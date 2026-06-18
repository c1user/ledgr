/**
 * server.js (SECURITY-HARDENED)
 *
 * Fixes applied:
 * - OWASP A05: CORS origin from environment variable (not hardcoded localhost)
 * - OWASP A04: Rate limiters applied at the route level
 * - OWASP A05: Helmet configured with stricter CSP
 * - OWASP A09: Request logging for security auditing
 * - General: ENV validation at startup — crash fast rather than silently fail
 *
 * Install new deps: npm install express-rate-limit validator
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import transactionRoutes from "./routes/transactions.js";
import categoryRoutes from "./routes/categories.js";
import accountRoutes from "./routes/accounts.js";
import receiptRoutes from "./routes/receipts.js";
import employeeRoutes from "./routes/employees.js";
import payrollRoutes from "./routes/payroll.js";
import aiRoutes from "./routes/ai.js";
import reportRoutes from "./routes/reports.js";
import rulesRoutes from "./routes/rules.js";
import { generalLimiter, authLimiter } from "./middleware/rateLimiter.js";

dotenv.config();

// ── OWASP A05: Validate critical env vars at startup ─────────
const REQUIRED_ENV = [
  "PORT",
  "JWT_SECRET",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_BUCKET_NAME",
  "AWS_REGION",
  "CORS_ORIGIN", // NEW — must be set in production
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET must be at least 32 characters");
  process.exit(1);
}

const app = express();

// ── OWASP A05: Helmet with CSP ────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://*.amazonaws.com"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    // Prevent clickjacking
    frameguard: { action: "deny" },
    // Force HTTPS
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// ── OWASP A05: CORS from environment variable ─────────────────
// Never hardcode localhost — use CORS_ORIGIN=http://localhost:5173 in dev .env
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" })); // Prevent JSON body DoS

// ── OWASP A04: General rate limit on all routes ───────────────
app.use(generalLimiter);

// ── OWASP A09: Basic security audit logging ───────────────────
// In production, replace with a proper logger (winston, pino)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (res.statusCode >= 400) {
      console.warn(
        `[${new Date().toISOString()}] ${res.statusCode} ${req.method} ${req.path} ${duration}ms ip=${req.ip}`,
      );
    }
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────
// authLimiter applied specifically to login/register to stop brute force
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/payroll", payrollRoutes);
// aiChatLimiter is applied inside ai.js on the /chat route only
app.use("/api/ai", aiRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/rules", rulesRoutes);

// ── Health check — no sensitive info ─────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" }); // Don't expose app name/version in production
});

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────
// OWASP A05: Never expose stack traces in production
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(process.env.PORT, () => {
  console.log(
    `Ledgr API running on port ${process.env.PORT} [${process.env.NODE_ENV || "development"}]`,
  );
});
