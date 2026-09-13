import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast } from "../store/feedbackStore";
import { hideableNavGroups } from "../config/nav";
import { Card, PageHeader, Toggle } from "../components/ui";

// Settings → Menu: which sidebar sections this business uses. Each toggle
// saves at once — optimistic so the sidebar reacts immediately, reverted
// with a toast if the server rejects it. Owners/admins can change it;
// everyone else sees the current state read-only.
export default function MenuSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const hiddenNav = useAuthStore((s) => s.business?.hiddenNav) || [];
  const setBusiness = useAuthStore((s) => s.setBusiness);
  const canEdit = user?.role === "owner" || user?.role === "admin";

  const saveNav = useMutation({
    mutationFn: (next) =>
      api.put("/business/nav", { hiddenNav: next }).then((r) => r.data),
    onMutate: (next) => {
      const prev = hiddenNav;
      setBusiness({ hiddenNav: next });
      return { prev };
    },
    onSuccess: (d) => {
      setBusiness({ hiddenNav: d.hiddenNav });
      queryClient.invalidateQueries({ queryKey: ["business"] });
    },
    onError: (err, _next, ctx) => {
      setBusiness({ hiddenNav: ctx?.prev || [] });
      toast.error(err.response?.data?.error || t("business.menuSaveFailed"));
    },
  });
  const toggleNav = (to, visible) =>
    saveNav.mutate(
      visible ? hiddenNav.filter((h) => h !== to) : [...hiddenNav, to],
    );

  return (
    <div className="fade-in max-w-[620px] mx-auto">
      <PageHeader
        title={t("business.menuTitle")}
        subtitle={t("business.menuHint")}
      />

      {!canEdit && (
        <div className="bg-canvas border border-line rounded-lg px-3.5 py-2.5 text-md text-secondary mb-4">
          <i className="ti ti-lock mr-1.5" aria-hidden="true" />
          {t("settings.menuViewerHint")}
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-4">
          {hideableNavGroups.map((group, gi) => (
            <div key={group.label || `group-${gi}`}>
              {group.label && (
                <div className="text-[10px] font-semibold tracking-[0.8px] uppercase text-muted mb-1">
                  {t(group.label)}
                </div>
              )}
              {group.items.map((item) => {
                const visible = !hiddenNav.includes(item.to);
                return (
                  <label
                    key={item.to}
                    className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-b-0 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5 text-md text-ink min-w-0">
                      <i
                        className={`ti ${item.icon} text-lg text-secondary shrink-0`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{t(item.label)}</span>
                    </span>
                    <Toggle
                      checked={visible}
                      onChange={() => toggleNav(item.to, !visible)}
                      disabled={!canEdit || saveNav.isPending}
                      aria-label={t(item.label)}
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-3">
          {t("business.menuAlwaysOn", {
            items: [
              t("nav.dashboard"),
              t("nav.transactions"),
              t("nav.settings"),
            ].join(", "),
          })}
        </p>
      </Card>
    </div>
  );
}
