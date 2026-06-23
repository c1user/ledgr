import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "0.5px solid var(--border-color)",
          flexWrap: "wrap",
        }}
      >
        {TABS.map(({ to, end, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            style={({ isActive }) => ({
              padding: "8px 20px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              textDecoration: "none",
              color: isActive ? "var(--brand)" : "var(--text-muted)",
              borderBottom: isActive
                ? "2px solid var(--brand)"
                : "2px solid transparent",
              fontWeight: isActive ? 500 : 400,
            })}
          >
            {t(labelKey)}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
