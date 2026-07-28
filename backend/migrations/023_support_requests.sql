-- 023_support_requests.sql
-- Roadmap v3 · Phase 2: contact support / report a problem.
-- Every submission is persisted (the trail) AND emailed to the support
-- address; user_email is denormalized so the record stays useful even if
-- the user row is later removed.

BEGIN;

CREATE TABLE support_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  category TEXT NOT NULL
    CHECK (category IN ('bug', 'billing', 'question', 'feedback')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  -- page, plan, app mode, user agent — auto-attached by the client
  context JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_business ON support_requests (business_id, created_at DESC);

COMMIT;
