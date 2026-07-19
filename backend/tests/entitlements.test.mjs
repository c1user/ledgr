import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  LIMITS,
  FEATURE_MIN_PLAN,
  normalizePlan,
  hasFeature,
  getEntitlements,
} from "../src/config/entitlements.js";

test("plans are the three known tiers, in order", () => {
  assert.deepEqual(PLANS, ["starter", "professional", "premium"]);
});

test("tiers are cumulative: starter ⊂ professional ⊂ premium", () => {
  const starter = new Set(getEntitlements("starter").features);
  const professional = new Set(getEntitlements("professional").features);
  const premium = new Set(getEntitlements("premium").features);
  for (const f of starter) {
    assert.ok(professional.has(f), `professional missing starter feature ${f}`);
  }
  for (const f of professional) {
    assert.ok(premium.has(f), `premium missing professional feature ${f}`);
  }
});

test("gate matrix — the features routes actually mount with", () => {
  // starter
  assert.ok(hasFeature("starter", "transactions"));
  assert.ok(hasFeature("starter", "basic_reports"));
  assert.ok(!hasFeature("starter", "invoicing"));
  assert.ok(!hasFeature("starter", "multi_user"));
  assert.ok(!hasFeature("starter", "reconciliation"));
  assert.ok(!hasFeature("starter", "audit_log"));
  // professional
  assert.ok(hasFeature("professional", "invoicing"));
  assert.ok(hasFeature("professional", "multi_user"));
  assert.ok(hasFeature("professional", "reconciliation"));
  assert.ok(hasFeature("professional", "audit_log"));
  assert.ok(hasFeature("professional", "hacienda"));
  assert.ok(!hasFeature("professional", "payroll"));
  assert.ok(!hasFeature("professional", "advanced_reports"));
  // premium
  assert.ok(hasFeature("premium", "payroll"));
  assert.ok(hasFeature("premium", "advanced_reports"));
  assert.ok(hasFeature("premium", "ai_chat"));
});

test("minimum-plan map drives upsell copy correctly", () => {
  assert.equal(FEATURE_MIN_PLAN.transactions, "starter");
  assert.equal(FEATURE_MIN_PLAN.invoicing, "professional");
  assert.equal(FEATURE_MIN_PLAN.reconciliation, "professional");
  assert.equal(FEATURE_MIN_PLAN.audit_log, "professional");
  assert.equal(FEATURE_MIN_PLAN.payroll, "premium");
  assert.equal(FEATURE_MIN_PLAN.advanced_reports, "premium");
});

test("unknown or legacy plans behave as starter", () => {
  assert.equal(normalizePlan("free"), "starter");
  assert.equal(normalizePlan("pro"), "starter");
  assert.equal(normalizePlan(null), "starter");
  assert.equal(getEntitlements("bogus").plan, "starter");
});

test("usage limits: starter metered, paid tiers unlimited", () => {
  assert.equal(LIMITS.starter.aiReceiptsPerMonth, 10);
  assert.equal(LIMITS.professional.aiReceiptsPerMonth, null);
  assert.equal(LIMITS.premium.aiReceiptsPerMonth, null);
});
