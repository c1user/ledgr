/**
 * server.js — boot entry: env validation, listen, background scheduler.
 *
 * The Express app itself (middleware + routes) lives in app.js so the
 * HTTP test harness can boot the identical stack on an ephemeral port
 * without env hard-exits or background timers.
 */

import dotenv from "dotenv";

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
  // SSN field encryption (payroll + individual 480.6SP payees). Checked at
  // boot so a missing key fails fast, not at the first payroll write.
  // Losing this key loses every encrypted SSN — see PAYROLL_RUNBOOK.md.
  "PAYROLL_ENC_KEY",
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

// Imported AFTER env validation so a misconfigured boot fails fast with
// the message above, not a mid-import crash.
const { BRAND_NAME } = await import("./config/brand.js");
const { startComplianceNotifier } = await import(
  "./services/complianceNotifier.js"
);
const { default: app } = await import("./app.js");

app.listen(process.env.PORT, () => {
  console.log(
    `${BRAND_NAME} API running on port ${process.env.PORT} [${process.env.NODE_ENV || "development"}]`,
  );
  // Compliance-calendar bell feed (V5 Phase 5 deferral): first sweep 15s
  // after boot, then twice a day. Timers are unref'd.
  startComplianceNotifier();
});
