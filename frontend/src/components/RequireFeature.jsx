import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useEntitlements from "../lib/useEntitlements";
import { Button, Card, EmptyState } from "./ui";

// Route-level plan gate: renders children when the business plan includes
// `feature`, an upsell prompt otherwise. The backend enforces the real gate
// (403 UPGRADE_REQUIRED) — this is the friendly face of the same rule.
export default function RequireFeature({ feature, children }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasFeature, featureMinPlan, isLoading } = useEntitlements();

  if (isLoading) return null;
  if (hasFeature(feature)) return children;

  const requiredPlan = featureMinPlan[feature] || "premium";

  return (
    <div className="max-w-[560px] mx-auto mt-10 fade-in">
      <Card>
        <EmptyState
          icon="ti-lock"
          title={t("upgrade.title", {
            plan: t(`upgrade.plan_${requiredPlan}`),
          })}
          message={t("upgrade.message")}
          action={
            <Button
              variant="primary"
              icon="ti-crown"
              onClick={() => navigate("/plans")}
            >
              {t("upgrade.viewPlans")}
            </Button>
          }
        />
      </Card>
    </div>
  );
}
