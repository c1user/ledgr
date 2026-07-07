import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabNav } from "../components/ui";

// Combined "Transactions" hub. The ledger, recurring schedules and
// categorization rules are all transaction management/automation, so they live
// behind a single nav item as tab routes. The ledger is the index tab, hence
// `end` (its path /transactions is a prefix of the others).
const TABS = [
  { to: "/transactions", end: true, labelKey: "transactions.title" },
  { to: "/transactions/recurring", labelKey: "recurring.title" },
  { to: "/transactions/rules", labelKey: "nav.rules" },
];

export default function TransactionsHub() {
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
