-- ============================================================
--  LEDGR — Migration 007: Time Tracking
--  Run with: psql $DATABASE_URL -f backend/migrations/007_time_tracking.sql
-- ============================================================

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  color       CHAR(7) NOT NULL DEFAULT '#4f8ef7',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_business ON projects(business_id, is_active);

CREATE TABLE time_entries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  date        DATE NOT NULL,
  hours       NUMERIC(6,2) NOT NULL CHECK (hours > 0),
  description TEXT,
  is_billable BOOLEAN NOT NULL DEFAULT TRUE,
  hourly_rate NUMERIC(10,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_time_entries_business_date ON time_entries(business_id, date);
CREATE INDEX idx_time_entries_user         ON time_entries(business_id, user_id);
CREATE INDEX idx_time_entries_project      ON time_entries(project_id);
