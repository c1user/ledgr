import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabNav } from "../components/ui";

// Settings hub: business (payer) profile, personal account, menu
// customization and preferences as tab routes — the same nested-route
// pattern as the Sales hub, so each tab is deep-linkable.
const TABS = [
  { to: "/settings", end: true, labelKey: "business.title" },
  { to: "/settings/account", labelKey: "account.title" },
  { to: "/settings/menu", labelKey: "settings.menuTab" },
  { to: "/settings/preferences", labelKey: "settings.preferencesTab" },
];

export default function Settings() {
  const { t } = useTranslation();

  return (
    <div className="fade-in">
      <TabNav
        tabs={TABS.map(({ to, end, labelKey }) => ({
          to,
          end,
          label: t(labelKey),
        }))}
      />
      <Outlet />
    </div>
  );
}
