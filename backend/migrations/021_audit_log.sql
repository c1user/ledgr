-- 021_audit_log.sql
-- Roadmap v2 · item 13: audit trail. Append-only log of every mutating
-- action with the acting user and a JSONB snapshot — deletes keep the full
-- removed row. Written by the auditLogger middleware (src/middleware/
-- auditLog.js); sequenced before multi-user so every action is attributed
-- from the moment additional users arrive.

BEGIN;

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalized so history survives a user row being removed.
  user_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  summary TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_business_time ON audit_log (business_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);

COMMIT;
