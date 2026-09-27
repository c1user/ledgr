import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import cx from "@abaco/ui/cx";

// The phone owns its navigation (ROADMAP-V6): four tabs, 44px targets,
// safe-area padding under the home indicator.
const TABS = [
  { to: "/scan", icon: "ti-scan", key: "mobile.tabs.scan" },
  { to: "/receipts", icon: "ti-receipt", key: "mobile.tabs.receipts" },
  { to: "/assistant", icon: "ti-sparkles", key: "mobile.tabs.assistant" },
  { to: "/settings", icon: "ti-settings", key: "mobile.tabs.settings" },
];

export default function TabBar({ badges = {} }) {
  const { t } = useTranslation();
  return (
    <nav
      className="shrink-0 bg-surface border-t border-line pb-[max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))]"
      aria-label={t("mobile.tabs.scan") + " · " + t("mobile.tabs.settings")}
    >
      <ul className="flex h-14 items-stretch">
        {TABS.map(({ to, icon, key }) => {
          const label = t(key);
          const badge = badges[to];
          return (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  cx(
                    "relative flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                    isActive ? "text-brand" : "text-muted hover:text-ink",
                  )
                }
              >
                <i
                  className={cx("ti text-[22px] leading-none", icon)}
                  aria-hidden="true"
                />
                <span>{label}</span>
                {badge ? (
                  <span
                    className="absolute top-1.5 left-1/2 ml-2 min-w-[16px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-on-brand"
                    aria-hidden="true"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
