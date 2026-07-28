/**
 * services/businessData.js — the authoritative map of every table a business
 * owns, shared by "export all my data" and "close business" (V3 Phase 6).
 *
 * TABLES is ordered child-first so deleteBusinessData can walk it top to
 * bottom without tripping foreign keys. Entries are either:
 *   { table }                     — has a business_id column
 *   { table, parent, parentKey }  — child rows reached through parent's
 *                                   business_id (e.g. invoice_line_items)
 *
 * tests/businessData.test.mjs asserts this list matches the live schema —
 * add any new business-scoped table HERE or that test fails.
 */

// Columns stripped from the users rows in exports: secrets and tokens have
// no place in a data download.
const USER_SECRET_COLUMNS = [
  "password_hash",
  "invite_token",
  "invite_expires_at",
  "reset_token",
  "reset_expires_at",
  "verify_token",
  "verify_expires_at",
];

export const TABLES = [
  // Children without business_id — reached (and deleted) via their parent.
  { table: "invoice_line_items", parent: "invoices", parentKey: "invoice_id" },
  {
    table: "journal_entry_lines",
    parent: "journal_entries",
    parentKey: "journal_entry_id",
  },
  { table: "payslips", parent: "payroll_runs", parentKey: "payroll_run_id" },

  // business_id tables, ordered so referencing rows go before referenced ones.
  { table: "inventory_movements" }, // references products + transactions
  { table: "transactions" }, // references most operational tables
  { table: "invoices" }, // references clients, accounts, coa
  { table: "budgets" },
  { table: "categorization_rules" },
  { table: "recurring_transactions" },
  { table: "reconciliations" },
  { table: "time_entries" }, // references projects
  { table: "projects" }, // references clients
  { table: "products" },
  { table: "receipts" },
  { table: "vendors" },
  { table: "clients" },
  { table: "employees" },
  { table: "payroll_runs" },
  { table: "journal_entries" },
  { table: "accounts" }, // references chart_of_accounts
  { table: "chart_of_accounts" }, // self-referencing parent_id
  { table: "audit_log" },
  { table: "ai_conversations" },
  { table: "support_requests" },
  { table: "users" },
];

/**
 * Every business-owned row, as { tableName: rows[] }, plus the business row
 * itself. User secret columns are stripped. Read-only — safe on any role,
 * but the route restricts it to owners.
 */
export async function exportBusinessData(pool, businessId) {
  const bizResult = await pool.query(
    "SELECT * FROM businesses WHERE id = $1",
    [businessId],
  );
  if (bizResult.rows.length === 0) return null;

  const tables = {};
  for (const t of TABLES) {
    const sql = t.parent
      ? `SELECT c.* FROM ${t.table} c
         JOIN ${t.parent} p ON p.id = c.${t.parentKey}
         WHERE p.business_id = $1`
      : `SELECT * FROM ${t.table} WHERE business_id = $1`;
    const r = await pool.query(sql, [businessId]);
    tables[t.table] =
      t.table === "users"
        ? r.rows.map((row) => {
            const clean = { ...row };
            for (const col of USER_SECRET_COLUMNS) delete clean[col];
            return clean;
          })
        : r.rows;
  }

  return {
    format: "abaco-export",
    version: 1,
    exported_at: new Date().toISOString(),
    business: bizResult.rows[0],
    tables,
  };
}

/**
 * Remove every row the business owns, then the business itself.
 * MUST be called with a client inside an open transaction — the caller
 * owns BEGIN/COMMIT/ROLLBACK.
 */
export async function deleteBusinessData(client, businessId) {
  const counts = {};
  for (const t of TABLES) {
    const sql = t.parent
      ? `DELETE FROM ${t.table} c USING ${t.parent} p
         WHERE p.id = c.${t.parentKey} AND p.business_id = $1`
      : `DELETE FROM ${t.table} WHERE business_id = $1`;
    const r = await client.query(sql, [businessId]);
    counts[t.table] = r.rowCount;
  }
  const biz = await client.query("DELETE FROM businesses WHERE id = $1", [
    businessId,
  ]);
  counts.businesses = biz.rowCount;
  return counts;
}
