/**
 * middleware/entitlements.js
 *
 * Phase 4 — the real gate. requireFeature() runs AFTER requireAuth and
 * checks the business's plan against config/entitlements.js. The plan is
 * read from the DB per request (not the JWT) so plan changes take effect
 * immediately without re-login; it's a single indexed primary-key lookup.
 *
 * Blocked requests get 403 with code "UPGRADE_REQUIRED" so the frontend
 * can render an upsell instead of a generic error.
 */

import pool from "../config/db.js";
import {
  hasFeature,
  normalizePlan,
  FEATURE_MIN_PLAN,
} from "../config/entitlements.js";

export async function getPlan(businessId) {
  const r = await pool.query("SELECT plan FROM businesses WHERE id = $1", [
    businessId,
  ]);
  return normalizePlan(r.rows[0]?.plan);
}

export const requireFeature = (feature) => async (req, res, next) => {
  try {
    const plan = await getPlan(req.user.businessId);
    if (!hasFeature(plan, feature)) {
      return res.status(403).json({
        error: "This feature is not included in your plan",
        code: "UPGRADE_REQUIRED",
        feature,
        plan,
        requiredPlan: FEATURE_MIN_PLAN[feature] || "premium",
      });
    }
    req.user.plan = plan; // downstream handlers (e.g. metering) reuse it
    next();
  } catch (err) {
    console.error("Entitlement check error:", err);
    return res.status(500).json({ error: "Failed to verify plan" });
  }
};
