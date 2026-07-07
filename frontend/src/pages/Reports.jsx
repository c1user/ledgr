import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabNav } from "../components/ui";

// Combined "Reports" hub. P&L, balance sheet, tax summary and the Hacienda
// 480.6SP filing are all generated financial statements, so they live behind a
// single nav item as tab routes. P&L is the index tab, hence `end` (its path
// /reports is a prefix of the others).
const TABS = [
  { to: "/reports", end: true, labelKey: "reports.profitLoss" },
  { to: "/reports/balance-sheet", labelKey: "balanceSheet.title" },
  { to: "/reports/tax-summary", labelKey: "tax.title" },
  { to: "/reports/hacienda", labelKey: "hacienda.title" },
];

export default function Reports() {
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
