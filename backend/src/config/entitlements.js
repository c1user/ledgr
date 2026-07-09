/**
 * config/entitlements.js
 *
 * Phase 4 — THE single source of truth for plan → features/limits.
 * The backend enforces this (requireFeature middleware, metering); the
 * frontend only mirrors it for upsell UI via GET /api/business/entitlements.
 * Never fork this mapping anywhere else.
 *
 * Tiers are cumulative: Starter ⊂ Professional ⊂ Premium.
 * The exact split is still a product decision in flux — adjust HERE only.
 */

export const PLANS = ["starter", "professional", "premium"];

const STARTER_FEATURES = [
  "transactions", // ledger transactions, CSV import/export
  "accounts", // operational bank accounts
  "chart_of_accounts", // COA + categories
  "rules", // auto-categorization
  "basic_reports", // P&L, balance sheet, tax summary (on-screen)
  "ai_receipts", // AI receipt scanning — metered, see LIMITS
];

const PROFESSIONAL_FEATURES = [
  ...STARTER_FEATURES,
  "invoicing", // clients, invoices, accounts receivable
  "vendors", // vendor management + 1099 prep
  "recurring", // recurring transactions
  "budgets",
  "projects", // job costing + time tracking
  "inventory", // products + stock
  "hacienda", // 480.6SP prep
  "pdf_reports", // server-side report PDFs
  "multi_user",
];

const PREMIUM_FEATURES = [
  ...PROFESSIONAL_FEATURES,
  "payroll", // employees + payroll runs
  "ai_chat", // AI assistant (distinct from ai_receipts)
  "plaid", // bank sync (gate reserved — feature not built yet)
  "advanced_reports",
];

const FEATURES_BY_PLAN = {
  starter: new Set(STARTER_FEATURES),
  professional: new Set(PROFESSIONAL_FEATURES),
  premium: new Set(PREMIUM_FEATURES),
};

/** Per-plan usage limits. null = unlimited. */
export const LIMITS = {
  starter: { aiReceiptsPerMonth: 10 },
  professional: { aiReceiptsPerMonth: null },
  premium: { aiReceiptsPerMonth: null },
};

/** Minimum plan that unlocks each feature (drives frontend upsell copy). */
export const FEATURE_MIN_PLAN = {};
for (const plan of PLANS) {
  for (const feature of FEATURES_BY_PLAN[plan]) {
    if (!(feature in FEATURE_MIN_PLAN)) FEATURE_MIN_PLAN[feature] = plan;
  }
}

/** Unknown/legacy plan values behave as the base tier. */
export function normalizePlan(plan) {
  return PLANS.includes(plan) ? plan : "starter";
}

export function hasFeature(plan, feature) {
  return FEATURES_BY_PLAN[normalizePlan(plan)].has(feature);
}

/** Shape served to the frontend. */
export function getEntitlements(plan) {
  const p = normalizePlan(plan);
  return {
    plan: p,
    features: [...FEATURES_BY_PLAN[p]],
    limits: LIMITS[p],
    featureMinPlan: FEATURE_MIN_PLAN,
  };
}
