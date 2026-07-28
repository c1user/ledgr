-- 024_password_reset.sql
-- Roadmap v3 · Phase 3: forgot/reset password.
-- Separate columns from the invite token: a reset request must never
-- clobber a pending invite, and the semantics/expiries differ (reset
-- links live 1 hour; invites 7 days).

BEGIN;

ALTER TABLE users
  ADD COLUMN reset_token TEXT UNIQUE,
  ADD COLUMN reset_expires_at TIMESTAMPTZ;

COMMIT;
