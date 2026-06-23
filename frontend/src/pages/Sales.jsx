import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "0.5px solid var(--border-color)",
        }}
      >
        {TABS.map(({ to, labelKey }) => (
          <NavLink
            key={to}
            to={to}
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
