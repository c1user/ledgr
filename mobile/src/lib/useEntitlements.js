import { useQuery } from "@tanstack/react-query";
import api from "./api.js";

export const ENTITLEMENTS_QUERY_KEY = ["entitlements"];

/**
 * GET /api/business/entitlements →
 *   { plan, features: [...], limits: { aiReceiptsPerMonth: 10 | null },
 *     featureMinPlan: { feature: plan }, usage: { aiReceiptsThisMonth } }
 *
 * Features the phone cares about:
 *   "ai_receipts" — receipt AI extraction (Starter: metered 10/month)
 *   "ai_chat"     — the assistant (Premium only)
 *
 * Plan upsells are INFORMATIONAL TEXT ONLY on the phone (UpsellNotice); there
 * are no purchase buttons or links anywhere.
 */
export default function useEntitlements(options = {}) {
  const query = useQuery({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    queryFn: async () => (await api.get("/business/entitlements")).data,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
  const data = query.data || {};
  const features = Array.isArray(data.features) ? data.features : [];
  return {
    ...query,
    plan: data.plan ?? null,
    features,
    limits: data.limits || {},
    usage: data.usage || {},
    featureMinPlan: data.featureMinPlan || {},
    hasFeature: (feature) => features.includes(feature),
  };
}
