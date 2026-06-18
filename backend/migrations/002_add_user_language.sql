-- ============================================================
--  002 — Add UI language preference to users
--  Run with: psql $DATABASE_URL -f migrations/002_add_user_language.sql
--
--  NOTE: language lives on USERS, not businesses.
--  UI language is a per-person preference (an owner may want
--  Spanish while their bookkeeper wants English).
--  Document/invoice language will be a separate per-client
--  setting when invoicing is built.
-- ============================================================

ALTER TABLE users ADD COLUMN language CHAR(2) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es'));