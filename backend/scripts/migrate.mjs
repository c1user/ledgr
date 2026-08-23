/**
 * scripts/migrate.mjs — the real migration runner (PENDIENTES §4.1).
 *
 * Replaces the old one-file `psql -f migrations/001_initial.sql` script:
 * applies every migrations/NNN*.sql in filename order, records each in a
 * schema_migrations table, and skips anything already recorded — so one
 * command brings a FRESH database to the current schema, and running it
 * again is a no-op. This is also the disaster-recovery story.
 *
 * Usage (DATABASE_URL from backend/.env or the environment):
 *   node scripts/migrate.mjs               apply pending migrations
 *   node scripts/migrate.mjs --baseline    mark ALL files as applied
 *                                          WITHOUT running them (adopt an
 *                                          existing database that was
 *                                          migrated by hand — e.g. the
 *                                          original dev DB)
 *   node scripts/migrate.mjs --status      list applied/pending and exit
 *
 * Files run in lexicographic order (001, 002, …, 009, 009a, 010, …).
 * Each file manages its own BEGIN/COMMIT (the house migration style);
 * the runner records a file only after it executes without error and
 * stops at the first failure.
 */

import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

// Only numbered migration files — never seeds or strays.
const MIGRATION_PATTERN = /^\d{3}[a-z]?_.+\.sql$/;

async function main() {
  const mode = process.argv[2] || "apply";
  if (!["apply", "--baseline", "--status"].includes(mode)) {
    console.error(`Unknown argument: ${mode}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (backend/.env or environment)");
    process.exit(1);
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => MIGRATION_PATTERN.test(f))
    .sort();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const appliedRes = await client.query(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(appliedRes.rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (mode === "--status") {
      for (const f of files) {
        console.log(`${applied.has(f) ? "applied" : "PENDING"}  ${f}`);
      }
      console.log(`\n${applied.size} applied, ${pending.length} pending`);
      return;
    }

    if (mode === "--baseline") {
      for (const f of pending) {
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [f],
        );
      }
      console.log(
        `Baselined ${pending.length} migration(s) as applied (not executed).`,
      );
      return;
    }

    if (pending.length === 0) {
      console.log("Database is up to date — nothing to apply.");
      return;
    }

    for (const f of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), "utf8");
      process.stdout.write(`applying ${f} … `);
      try {
        // Files carry their own BEGIN/COMMIT; a failure mid-file leaves
        // the open transaction aborted — roll it back before surfacing.
        await client.query(sql);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.log("FAILED");
        console.error(`\n${f}: ${err.message}`);
        console.error(
          "Stopped. Fix the migration and re-run; applied files are recorded.",
        );
        process.exitCode = 1;
        return;
      }
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [f],
      );
      console.log("ok");
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
