-- V3 Phase 7: TOTP two-factor auth + session versioning.
--
-- totp_pending_secret holds the secret between "scan this QR" and the first
-- verified code, so an abandoned setup never half-enables 2FA.
-- backup_codes stores SHA-256 digests (JSONB array), never the codes.
-- token_version is embedded in every JWT; bumping it invalidates all
-- outstanding tokens ("sign out of all devices", password changes).

ALTER TABLE users
  ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN totp_secret TEXT,
  ADD COLUMN totp_pending_secret TEXT,
  ADD COLUMN backup_codes JSONB,
  ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
