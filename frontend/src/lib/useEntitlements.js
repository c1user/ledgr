import { useQuery } from "@tanstack/react-query";
import api from "./api";

// Frontend mirror of the backend entitlements (config/entitlements.js).
// The backend enforces the real gates; this only drives upsell UI.
export default function useEntitlements() {
  const { data, isLoading } = useQuery({
    queryKey: ["entitlements"],
    queryFn: () => api.get("/business/entitlements").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const features = data?.features || [];

  return {
    plan: data?.plan,
    features,
    limits: data?.limits || {},
    featureMinPlan: data?.featureMinPlan || {},
    hasFeature: (f) => features.includes(f),
    isLoading,
  };
}
