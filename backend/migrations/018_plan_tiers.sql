-- 018_plan_tiers.sql
-- Phase 4 (monetization) groundwork: align businesses.plan with the three
-- product tiers (Starter ⊂ Professional ⊂ Premium). Legacy values are
-- remapped: 'free' → 'starter', 'pro' → 'professional'.
--
-- The feature set granted by each plan lives in ONE place:
--   backend/src/config/entitlements.js

BEGIN;

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_plan_check;

UPDATE businesses SET plan = 'starter'      WHERE plan = 'free';
UPDATE businesses SET plan = 'professional' WHERE plan = 'pro';

ALTER TABLE businesses ALTER COLUMN plan SET DEFAULT 'starter';
ALTER TABLE businesses
  ADD CONSTRAINT businesses_plan_check
  CHECK (plan IN ('starter', 'professional', 'premium'));

COMMIT;
