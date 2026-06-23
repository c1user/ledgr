import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
