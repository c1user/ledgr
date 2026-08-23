/**
 * middleware/auditLog.js — the audit trail (Roadmap v2 · item 13).
 *
 * Mounted once on /api BEFORE the routes, so every mutating endpoint —
 * including future ones — is covered by default. It hooks res "finish":
 * by then the route has run, requireAuth has set req.user, and the status
 * code tells us whether the mutation succeeded (only 2xx is logged).
 *
 * DELETEs are special: the row is gone by finish-time, so the middleware
 * snapshots it BEFORE handing off to the route. Nothing vanishes without
 * a trace.
 */

import pool from "../config/db.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// URL resource segment → table, used only for delete snapshots. The values
// are a fixed whitelist — never interpolate anything user-supplied here.
// Resources not listed still get logged, just without a delete snapshot.
const TABLES = {
  transactions: "transactions",
  accounts: "accounts",
  receipts: "receipts",
  invoices: "invoices",
  clients: "clients",
  vendors: "vendors",
  budgets: "budgets",
  projects: "projects",
  "time-entries": "time_entries",
  products: "products",
  recurring: "recurring_transactions",
  rules: "categorization_rules",
  "chart-of-accounts": "chart_of_accounts",
  employees: "employees",
  "payroll-v2": "payroll_runs_v2",
  reconciliations: "reconciliations",
  business: "businesses",
};

// Noise / sensitive resources that should not be audited.
// notifications: mark-read churn would drown real activity.
const SKIP_RESOURCES = new Set([
  "auth",
  "ai",
  "search",
  "fx-rates",
  "audit-log",
  "notifications",
]);

// "ssn" covers ssn, ssnLast4, ssn_encrypted — plaintext SSNs must never
// reach the audit trail in any form (ROADMAP-V5 §7 / spec §9).
const SENSITIVE_KEY = /password|token|secret|authorization|ssn/i;

// Exported for tests: the guarantee that no SSN (or credential) key ever
// reaches an audit snapshot is load-bearing for the payroll module.
export function sanitize(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY.test(k)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parsePath(url) {
  const parts = url.split("?")[0].split("/").filter(Boolean);
  if (parts[0] !== "api" || parts.length < 2) return null;
  const resource = parts[1];
  const entityId = parts[2] && UUID_RE.test(parts[2]) ? parts[2] : null;
  const verb = entityId
    ? parts[3] || null
    : parts[2] && !UUID_RE.test(parts[2])
      ? parts[2]
      : null;
  return { resource, entityId, verb };
}

// Best-effort human line for the list view.
function summarize(source, verb) {
  const label = [
    source?.name,
    source?.merchant,
    source?.invoice_number,
    source?.pattern,
  ].find((v) => typeof v === "string" && v.trim());
  return [verb, label].filter(Boolean).join(" · ") || null;
}

export function auditLogger(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const parsed = parsePath(req.originalUrl || req.url);
  if (!parsed || SKIP_RESOURCES.has(parsed.resource)) return next();

  // create = POST on the collection root; everything else that isn't a
  // DELETE (PUT/PATCH, or POST sub-actions like /invoices/:id/send and
  // /rules/reorder) is an update.
  const action =
    req.method === "DELETE"
      ? "delete"
      : req.method === "POST" && !parsed.entityId && !parsed.verb
        ? "create"
        : "update";

  const capture = { snapshot: null };
  const table = TABLES[parsed.resource];

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const user = req.user;
    if (!user?.businessId) return;

    // Closing the business purges every row it owns — including audit_log
    // (and the businesses row the FK points at), so an audit row for the
    // closure can neither be written nor survive. The purge summary that
    // businessData.js logs to the server console is the closure's record.
    if (action === "delete" && parsed.resource === "business") return;

    // Delete snapshots are raw DB rows — scrub them like request bodies
    // so columns such as ssn_last4/ssn_encrypted never land in the log.
    const snapshot =
      action === "delete" ? sanitize(capture.snapshot) : sanitize(req.body);
    const summary = summarize(
      action === "delete" ? capture.snapshot : req.body,
      parsed.verb,
    );

    pool
      .query(
        `INSERT INTO audit_log
           (business_id, user_id, user_name, action, entity_type, entity_id,
            summary, snapshot)
         VALUES ($1, $2, (SELECT name FROM users WHERE id = $2),
                 $3, $4, $5, $6, $7)`,
        [
          user.businessId,
          user.userId,
          action,
          parsed.resource,
          parsed.entityId,
          summary,
          snapshot ? JSON.stringify(snapshot) : null,
        ],
      )
      .catch((err) => console.error("Audit log write error:", err.message));
  });

  if (action === "delete" && table && parsed.entityId) {
    // Snapshot the row before the route removes it. Errors are non-fatal —
    // the delete itself must never be blocked by the audit trail.
    pool
      .query(`SELECT * FROM ${table} WHERE id = $1`, [parsed.entityId])
      .then((r) => {
        capture.snapshot = r.rows[0] || null;
      })
      .catch(() => {})
      .finally(next);
  } else {
    next();
  }
}
