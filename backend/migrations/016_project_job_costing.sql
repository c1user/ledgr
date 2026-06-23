-- ============================================================
--  016 — Project / job costing (#8)
--  Run with: psql $DATABASE_URL -f migrations/016_project_job_costing.sql
--
--  Promotes `projects` from a time-tracking label into a real job/cost center:
--  a client, a lifecycle status, a budget, and dates. Transactions can be
--  tagged to a project so income/expense roll up into a per-job P&L.
--
--  `is_active` is kept (the time-entry picker + idx_projects_business use it)
--  and is maintained by the route as (status = 'active').
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_chk;
ALTER TABLE projects ADD CONSTRAINT projects_status_chk
  CHECK (status IN ('active', 'completed', 'archived'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE;

CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

-- ── Tag transactions to a project ────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
