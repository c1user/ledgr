import { Outlet, NavLink, useNavigate } from "react-router-dom";
import useAuthStore from "../store/authStore";
import useThemeStore from "../store/themeStore";

const navItems = [
  { to: "/dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
  { to: "/transactions", icon: "ti-arrows-up-down", label: "Transactions" },
  { to: "/receipts", icon: "ti-receipt", label: "Receipts" },
  { to: "/payroll", icon: "ti-users", label: "Payroll" },
  { to: "/ai", icon: "ti-sparkles", label: "AI Chat" },
];

export default function AppLayout() {
  const { user, business, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const initials = business?.name
    ?.split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: 220,
          background: "var(--bg-sidebar)",
          borderRight: "0.5px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "0.5px solid var(--border-color)",
          }}
        >
          <div
            style={{
              color: "var(--brand)",
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 3,
            }}
          >
            LEDGR
          </div>
          <div
            style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}
          >
            {business?.name || "My Business"}
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: "12px 0" }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                color: isActive ? "var(--brand)" : "var(--text-secondary)",
                background: isActive ? "var(--brand-light)" : "transparent",
                borderLeft: isActive
                  ? "2px solid var(--brand)"
                  : "2px solid transparent",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                transition: "all 0.15s",
              })}
            >
              <i
                className={`ti ${item.icon}`}
                style={{ fontSize: 16 }}
                aria-hidden="true"
              />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: theme toggle + user + logout */}
        <div
          style={{
            borderTop: "0.5px solid var(--border-color)",
            padding: "12px 16px",
          }}
        >
          {/* Theme toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
              padding: "6px 4px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-secondary)",
                fontSize: 12,
              }}
            >
              <i
                className={`ti ${theme === "dark" ? "ti-moon" : "ti-sun"}`}
                style={{ fontSize: 15 }}
                aria-hidden="true"
              />
              {theme === "dark" ? "Dark mode" : "Light mode"}
            </div>
            {/* Toggle switch */}
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background:
                  theme === "dark" ? "var(--brand)" : "var(--border-color)",
                border: "none",
                cursor: "pointer",
                position: "relative",
                transition: "background 0.2s",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 3,
                  left: theme === "dark" ? 18 : 3,
                  width: 14,
                  height: 14,
                  background: "#fff",
                  borderRadius: "50%",
                  transition: "left 0.2s",
                }}
              />
            </button>
          </div>

          {/* User info */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "var(--brand-light)",
                color: "var(--brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initials || "??"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user?.name || "User"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user?.role}
              </div>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              padding: "7px 8px",
              borderRadius: 6,
              border: "0.5px solid var(--border-color)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <i
              className="ti ti-logout"
              style={{ fontSize: 14 }}
              aria-hidden="true"
            />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="main-content">
        {/* Top bar */}
        <header
          style={{
            height: 52,
            background: "var(--bg-primary)",
            borderBottom: "0.5px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                background: "var(--brand-light)",
                color: "var(--brand)",
                fontWeight: 500,
              }}
            >
              {business?.plan?.toUpperCase() || "FREE"}
            </span>
          </div>
        </header>

        {/* Page content */}
        <div className="page-body">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
