import useEntitlements from "../../lib/useEntitlements.js";

/**
 * Starter meter from GET /business/entitlements:
 *   limits.aiReceiptsPerMonth  10 (Starter) | null (unlimited)
 *   usage.aiReceiptsThisMonth  int | null
 * Plan gates on the phone are informational only — no plan names with
 * prices, no purchase links (owner decision).
 *
 * → { ready, metered, limit, used, limitReached, plan }
 */
export default function useScanMeter() {
  const ent = useEntitlements();
  const limit = ent.limits?.aiReceiptsPerMonth ?? null;
  const rawUsed = ent.usage?.aiReceiptsThisMonth;
  const used = rawUsed == null ? 0 : Number(rawUsed) || 0;
  const ready = ent.isSuccess;
  const metered = ready && limit != null;
  return {
    ready,
    metered,
    limit,
    used,
    limitReached: metered && used >= limit,
    plan: ent.plan,
  };
}
