import { test } from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";
import pool from "../src/config/db.js";
import { TABLES } from "../src/services/businessData.js";

// The data map drives BOTH "export all my data" and "close business".
// These tests compare it to the live schema so adding a table without
// updating the map fails loudly instead of silently leaking rows.

// businesses is the root (deleted last, by id); fx_rate_cache is a global
// cache, not business data.
const NOT_BUSINESS_DATA = new Set(["businesses", "fx_rate_cache"]);

async function dbAvailable() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("data map covers every business_id table in the schema", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("database not reachable — skipping schema comparison");
    return;
  }
  const r = await pool.query(
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'business_id' AND table_schema = 'public'
       AND table_name IN (
         SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       )`,
  );
  const mapped = new Set(TABLES.map((x) => x.table));
  for (const { table_name } of r.rows) {
    if (NOT_BUSINESS_DATA.has(table_name)) continue;
    assert.ok(
      mapped.has(table_name),
      `table "${table_name}" has business_id but is missing from the data map`,
    );
  }
});

test("data map covers every child table reachable from a mapped parent", async (t) => {
  if (!(await dbAvailable())) {
    t.skip("database not reachable — skipping schema comparison");
    return;
  }
  // Tables WITHOUT business_id that have a FK to a mapped table hold
  // business data indirectly (e.g. invoice_line_items → invoices).
  const r = await pool.query(
    `SELECT DISTINCT tc.table_name, ccu.table_name AS ref_table
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );
  const mapped = new Set(TABLES.map((x) => x.table));
  const hasBizId = new Set(
    (
      await pool.query(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'business_id' AND table_schema = 'public'`,
      )
    ).rows.map((x) => x.table_name),
  );
  for (const { table_name, ref_table } of r.rows) {
    if (NOT_BUSINESS_DATA.has(table_name) || hasBizId.has(table_name)) continue;
    if (!mapped.has(ref_table)) continue;
    assert.ok(
      mapped.has(table_name),
      `child table "${table_name}" (references ${ref_table}) is missing from the data map`,
    );
  }
});

test("children come before their parents in the delete order", () => {
  const order = TABLES.map((x) => x.table);
  for (const t of TABLES) {
    if (!t.parent) continue;
    assert.ok(
      order.indexOf(t.table) < order.indexOf(t.parent),
      `${t.table} must be deleted before its parent ${t.parent}`,
    );
  }
});

test.after(() => pool.end());
