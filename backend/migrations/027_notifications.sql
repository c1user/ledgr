-- V3 Phase 8: in-app notifications + per-user email preferences.
--
-- notify_prefs: JSONB of {category: bool}; a MISSING key means enabled, so
-- new categories default on without a backfill. Categories live in
-- services/notifications.js.
-- unsubscribe_token: long-lived per-user token embedded in every
-- preference-gated email's unsubscribe link.

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE users
  ADD COLUMN notify_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN unsubscribe_token TEXT UNIQUE;

-- Every existing user gets an unsubscribe token now; register/invite set it
-- for new users.
UPDATE users
SET unsubscribe_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
