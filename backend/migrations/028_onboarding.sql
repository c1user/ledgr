-- V3 Phase 9: first-run product tour.
-- NULL = the user hasn't finished (or skipped) the welcome tour yet.
-- Deliberately NOT backfilled: existing users see the tour once too — it's
-- five short steps and introduces features (palette, bell) added since
-- they signed up.

ALTER TABLE users
  ADD COLUMN tour_done_at TIMESTAMPTZ;
