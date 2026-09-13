-- 040 — per-business sidebar customization
-- Run with: psql $DATABASE_URL -f migrations/040_hidden_nav.sql
--
-- The sidebar lists every module. A business that never sells products or
-- runs payroll can now hide those sections (Business Profile → Menu). The
-- list holds top-level nav routes ("/inventory", "/payroll", …) validated
-- against src/config/nav.js; hidden pages stay reachable by URL.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS hidden_nav JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
