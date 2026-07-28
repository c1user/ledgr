-- V3 Phase 5: email verification + signup consent.
--
-- verify_token is its own column (like reset_token vs invite_token) so a
-- verification link can never clobber a pending invite or password reset.

ALTER TABLE users
  ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN verify_token TEXT UNIQUE,
  ADD COLUMN verify_expires_at TIMESTAMPTZ,
  ADD COLUMN consented_at TIMESTAMPTZ;

-- Accounts created before verification existed are grandfathered in:
-- they've been receiving mail at these addresses all along, and nagging
-- established users would be pure noise.
UPDATE users SET email_verified = true;
