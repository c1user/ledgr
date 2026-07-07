import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabNav } from "../components/ui";

// Combined "Sales" hub. Clients, invoices and receivables are one workflow,
// so they live behind a single nav item as tab routes. Using nested routes
// (rather than local state) keeps deep links like ?invoice=<id> and the
// cross-navigation from Receivables -> Invoices working and bookmarkable.
const TABS = [
  { to: "/sales/clients", labelKey: "clients.title" },
  { to: "/sales/invoices", labelKey: "invoices.title" },
  { to: "/sales/receivables", labelKey: "ar.title" },
];

export default function Sales() {
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
