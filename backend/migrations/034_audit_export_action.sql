-- ============================================================
--  034 — Audit 'export' action (ROADMAP-V5 · Phase 6.4)
--  Run with: psql $DATABASE_URL -f migrations/034_audit_export_action.sql
--
--  Filing exports (DTRH wage report, W-2PR electronic file) decrypt
--  employee SSNs directly into the downloaded file. That access must be
--  attributable: the filing routes now write an audit_log row with
--  action 'export' recording who generated which filing and how many
--  SSNs it carried (never the SSNs themselves — the scrub in
--  middleware/auditLog.js stays authoritative for snapshots).
-- ============================================================

BEGIN;

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN ('create', 'update', 'delete', 'export'));

COMMIT;
