/**
 * scripts/seed-payroll-rules.mjs
 *
 * Backfill the UNVERIFIED payroll-rule placeholders for every existing
 * business (new businesses get them at registration via routes/auth.js).
 * Idempotent — rule types a business already has are left untouched.
 *
 * Run after migration 029:  node scripts/seed-payroll-rules.mjs
 */

import "dotenv/config";
import pool from "../src/config/db.js";
import { seedPayrollRules } from "../src/services/payrollRulesSeed.js";

const client = await pool.connect();
try {
  const businesses = await client.query("SELECT id, name FROM businesses");
  let total = 0;
  for (const b of businesses.rows) {
    await client.query("BEGIN");
    const inserted = await seedPayrollRules(client, b.id);
    await client.query("COMMIT");
    total += inserted;
    console.log(`${b.name}: ${inserted} rules seeded`);
  }
  console.log(
    `Done — ${total} UNVERIFIED placeholder rules across ${businesses.rows.length} businesses.`,
  );
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
