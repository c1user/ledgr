-- 022_multi_user.sql
-- Roadmap v2 · item 14: multi-user invites + user management.
-- Invited users exist as user rows with a NULL password_hash and an invite
-- token; accepting the invite (POST /api/auth/accept-invite) sets the
-- password and clears the token. Deactivation is soft (is_active) so the
-- audit trail and created_by references stay intact.

BEGIN;

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN invite_token TEXT UNIQUE,
  ADD COLUMN invite_expires_at TIMESTAMPTZ;

COMMIT;
