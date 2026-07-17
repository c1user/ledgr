import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import useEntitlements from "../lib/useEntitlements";
import { confirmDialog, toast } from "../store/feedbackStore";
import cx from "../lib/cx";
import { Badge, Button, Card, PageHeader } from "../components/ui";

// Feature bullets per tier. Each entry is an i18n key under plans.*;
// higher tiers start with an "everything in X" line.
const TIERS = [
  {
    plan: "starter",
    icon: "ti-seedling",
    bullets: [
      "feat_transactions",
      "feat_accounts",
      "feat_coa",
      "feat_rules",
      "feat_basic_reports",
      "feat_scans_starter",
    ],
  },
  {
    plan: "professional",
    icon: "ti-briefcase",
    everythingIn: "starter",
    bullets: [
      "feat_invoicing",
      "feat_vendors",
      "feat_recurring",
      "feat_budgets",
      "feat_projects",
      "feat_inventory",
      "feat_hacienda",
      "feat_pdf_reports",
      "feat_team",
      "feat_reconciliation",
      "feat_activity",
      "feat_scans_unlimited",
    ],
  },
  {
    plan: "premium",
    icon: "ti-crown",
    everythingIn: "professional",
    bullets: [
      "feat_payroll",
      "feat_ai_chat",
      "feat_advanced_reports",
      "feat_bank_sync",
    ],
  },
];

export default function Plans() {
  const { t } = useTranslation();
  const { user, business, setBusiness } = useAuthStore();
  const { plan: currentPlan } = useEntitlements();
  const qc = useQueryClient();

  const isOwner = user?.role === "owner";
  const activePlan = currentPlan || business?.plan || "starter";

  const switchMutation = useMutation({
    mutationFn: (plan) =>
      api.put("/business/plan", { plan }).then((r) => r.data),
    onSuccess: (entitlements) => {
      setBusiness({ plan: entitlements.plan });
      qc.setQueryData(["entitlements"], entitlements);
      qc.invalidateQueries({ queryKey: ["entitlements"] });
      toast.success(
        t("plans.switched", { plan: t(`upgrade.plan_${entitlements.plan}`) }),
      );
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("plans.switchFailed")),
  });

  async function handleSwitch(plan) {
    if (
      await confirmDialog({
        message: t("plans.confirmSwitch", {
          plan: t(`upgrade.plan_${plan}`),
        }),
        confirmLabel: t("plans.switch"),
      })
    ) {
      switchMutation.mutate(plan);
    }
  }

  return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader title={t("plans.title")} subtitle={t("plans.subtitle")} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {TIERS.map(({ plan, icon, everythingIn, bullets }) => {
          const isCurrent = plan === activePlan;
          return (
            <Card
              key={plan}
              padding="none"
              className={cx(
                "p-5 flex flex-col",
                isCurrent && "border-brand border-2",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <i
                    className={cx("ti", icon, "text-lg text-brand")}
                    aria-hidden="true"
                  />
                  <span className="font-display text-[17px] font-bold text-ink">
                    {t(`upgrade.plan_${plan}`)}
                  </span>
                </div>
                {isCurrent && (
                  <Badge tone="brand">{t("plans.current")}</Badge>
                )}
              </div>
              <div className="text-xs text-muted mb-4">
                {t(`plans.tagline_${plan}`)}
              </div>

              <ul className="flex-1 flex flex-col gap-1.5 mb-5">
                {everythingIn && (
                  <li className="text-md font-medium text-ink">
                    {t("plans.everythingIn", {
                      plan: t(`upgrade.plan_${everythingIn}`),
                    })}
                  </li>
                )}
                {bullets.map((key) => (
                  <li
                    key={key}
                    className="flex items-start gap-2 text-md text-secondary"
                  >
                    <i
                      className="ti ti-check text-income text-sm mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    {t(`plans.${key}`)}
                  </li>
                ))}
              </ul>

              {isOwner && !isCurrent && (
                <Button
                  variant="primary"
                  full
                  disabled={switchMutation.isPending}
                  onClick={() => handleSwitch(plan)}
                >
                  {t("plans.switchTo", { plan: t(`upgrade.plan_${plan}`) })}
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <div className="text-xs text-muted text-center mt-5">
        {t("plans.billingNote")}
      </div>
    </div>
  );
}
