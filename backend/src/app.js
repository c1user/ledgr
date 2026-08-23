/**
 * app.js — the configured Express application, without listening.
 *
 * Split from server.js (§1.5) so the HTTP test harness can boot the real
 * middleware/route stack on an ephemeral port. server.js remains the boot
 * entry: env validation, listen, and the compliance notifier live there.
 *
 * Security posture (see the original server.js header): helmet with CSP,
 * CORS origin from env, rate limiting, request logging, audit trail.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import transactionRoutes from "./routes/transactions.js";
import accountRoutes from "./routes/accounts.js";
import receiptRoutes from "./routes/receipts.js";
import employeeRoutes from "./routes/employees.js";
import payrollRulesRoutes from "./routes/payrollRules.js";
import payrollProfileRoutes from "./routes/payrollProfile.js";
import payrollV2Routes from "./routes/payrollV2.js";
import payrollTimeRoutes from "./routes/payrollTime.js";
import payrollFilingsRoutes from "./routes/payrollFilings.js";
import aiRoutes from "./routes/ai.js";
import reportRoutes from "./routes/reports.js";
import rulesRoutes from "./routes/rules.js";
import vendorRoutes from "./routes/vendors.js";
import clientRoutes from "./routes/clients.js";
import invoiceRoutes from "./routes/invoices.js";
import budgetRoutes from "./routes/budgets.js";
import fxRoutes from "./routes/fx.js";
import projectRoutes from "./routes/projects.js";
import timeEntryRoutes from "./routes/timeEntries.js";
import productRoutes from "./routes/products.js";
import inventoryRoutes from "./routes/inventory.js";
import recurringRoutes from "./routes/recurring.js";
import businessRoutes from "./routes/business.js";
import { generalLimiter, authLimiter } from "./middleware/rateLimiter.js";
import { requireAuth } from "./middleware/auth.js";
import { requireFeature } from "./middleware/entitlements.js";
import chartOfAccountsRoutes from "./routes/chartOfAccounts.js";
import ledgerRoutes from "./routes/ledger.js";
import searchRoutes from "./routes/search.js";
import reconciliationRoutes from "./routes/reconciliations.js";
import auditLogRoutes from "./routes/auditLog.js";
import teamRoutes from "./routes/team.js";
import supportRoutes from "./routes/support.js";
import notificationRoutes from "./routes/notifications.js";
import { auditLogger } from "./middleware/auditLog.js";

dotenv.config();

const app = express();

// Behind a reverse proxy (any real deployment), Express must trust the
// X-Forwarded-For chain or express-rate-limit keys every client on the
// proxy's IP. TRUST_PROXY = number of proxy hops (usually 1). Unset in
// dev, where the app is hit directly.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

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
    // Download filenames + payroll export warnings must reach the client.
    exposedHeaders: [
      "Content-Disposition",
      "X-W2PR-Warnings",
      "X-Stub-Warnings",
    ],
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
// authLimiter applied specifically to login/register to stop brute force.
// Professional/Premium routers are plan-gated at the mount: requireAuth
// populates req.user, then requireFeature checks the business plan against
// config/entitlements.js (finer-grained gates live inside reports.js etc.).
const gate = (feature) => [requireAuth, requireFeature(feature)];

// Audit trail — mounted before the routes so every mutating endpoint
// (including future ones) is logged by default. See middleware/auditLog.js.
app.use("/api", auditLogger);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/employees", ...gate("payroll"), employeeRoutes);
app.use("/api/payroll-rules", ...gate("payroll"), payrollRulesRoutes);
app.use("/api/payroll-profile", ...gate("payroll"), payrollProfileRoutes);
app.use("/api/payroll-v2", ...gate("payroll"), payrollV2Routes);
app.use("/api/payroll-time", ...gate("payroll"), payrollTimeRoutes);
app.use("/api/payroll-filings", ...gate("payroll"), payrollFilingsRoutes);
// aiChatLimiter is applied inside ai.js on the /chat route only
app.use("/api/ai", ...gate("ai_chat"), aiRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/rules", rulesRoutes);
app.use("/api/vendors", ...gate("vendors"), vendorRoutes);
app.use("/api/clients", ...gate("invoicing"), clientRoutes);
app.use("/api/invoices", ...gate("invoicing"), invoiceRoutes);
app.use("/api/budgets", ...gate("budgets"), budgetRoutes);
app.use("/api/fx-rates", fxRoutes);
app.use("/api/projects", ...gate("projects"), projectRoutes);
app.use("/api/time-entries", ...gate("projects"), timeEntryRoutes);
app.use("/api/products", ...gate("inventory"), productRoutes);
app.use("/api/inventory", ...gate("inventory"), inventoryRoutes);
app.use("/api/recurring", ...gate("recurring"), recurringRoutes);
app.use("/api/business", businessRoutes);
app.use("/api/chart-of-accounts", chartOfAccountsRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/search", searchRoutes);
app.use(
  "/api/reconciliations",
  ...gate("reconciliation"),
  reconciliationRoutes,
);
app.use("/api/audit-log", ...gate("audit_log"), auditLogRoutes);
app.use("/api/team", ...gate("multi_user"), teamRoutes);
// No plan gate — support must be reachable on every tier.
app.use("/api/support", supportRoutes);
// No plan gate: the bell and email prefs work on every tier.
app.use("/api/notifications", notificationRoutes);

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

export default app;
