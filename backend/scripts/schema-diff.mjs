import "dotenv/config";
import pg from "pg";

// Compare table/column structure between the dev DB and the fresh build.
const devUrl = process.env.DATABASE_URL;
const freshUrl = devUrl.replace(/\/[^/]+$/, "/ledgr_fresh_check");

const Q = `
  SELECT table_name, column_name,
         data_type || COALESCE('(' || character_maximum_length || ')', '') AS type,
         is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, column_name`;

async function snapshot(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const cols = (await c.query(Q)).rows;
  const tables = (
    await c.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    )
  ).rows.map((r) => r.table_name);
  const constraints = (
    await c.query(
      `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
       ORDER BY 1, 2`,
    )
  ).rows;
  await c.end();
  return { cols, tables, constraints };
}

const dev = await snapshot(devUrl);
const fresh = await snapshot(freshUrl);

const devTables = new Set(dev.tables);
const freshTables = new Set(fresh.tables);
console.log("TABLES only in dev:", dev.tables.filter((t) => !freshTables.has(t)));
console.log("TABLES only in fresh:", fresh.tables.filter((t) => !devTables.has(t)));

const key = (r) => `${r.table_name}.${r.column_name}`;
const devCols = new Map(dev.cols.map((r) => [key(r), r]));
const freshCols = new Map(fresh.cols.map((r) => [key(r), r]));
const onlyDev = [...devCols.keys()].filter((k) => !freshCols.has(k));
const onlyFresh = [...freshCols.keys()].filter((k) => !devCols.has(k));
console.log("COLUMNS only in dev:", onlyDev);
console.log("COLUMNS only in fresh:", onlyFresh);

for (const [k, d] of devCols) {
  const f = freshCols.get(k);
  if (f && (f.type !== d.type || f.is_nullable !== d.is_nullable)) {
    console.log(`TYPE DIFF ${k}: dev=${d.type}/${d.is_nullable} fresh=${f.type}/${f.is_nullable}`);
  }
}

const conKey = (r) => `${r.tbl}: ${r.conname}`;
const devCons = new Map(dev.constraints.map((r) => [conKey(r), r.def]));
const freshCons = new Map(fresh.constraints.map((r) => [conKey(r), r.def]));
const consOnlyDev = [...devCons.keys()].filter((k) => !freshCons.has(k) && !k.includes("schema_migrations"));
const consOnlyFresh = [...freshCons.keys()].filter((k) => !devCons.has(k) && !k.includes("schema_migrations"));
console.log("CONSTRAINTS only in dev:", consOnlyDev);
console.log("CONSTRAINTS only in fresh:", consOnlyFresh);
