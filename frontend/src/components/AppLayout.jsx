import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useAuthStore from "../store/authStore";
import useThemeStore from "../store/themeStore";
import LanguageToggle from "../components/LanguageToggle";
import { setAppLanguage } from "../i18n";

const navItems = [
  { to: "/dashboard", icon: "ti-layout-dashboard", label: "nav.dashboard" },
  { to: "/transactions", icon: "ti-arrows-up-down", label: "nav.transactions" },
  { to: "/categories", icon: "ti-folders", label: "nav.categories" },
  { to: "/accounts", icon: "ti-building-bank", label: "nav.accounts" },
  { to: "/chart-of-accounts", icon: "ti-list-tree", label: "nav.chartOfAccounts" },
  { to: "/receipts", icon: "ti-receipt", label: "nav.receipts" },
  { to: "/payroll", icon: "ti-users", label: "nav.payroll" },
  { to: "/ai", icon: "ti-sparkles", label: "nav.aiChat" },
  { to: "/reports", icon: "ti-chart-bar", label: "nav.reports" },
  { to: "/tax-summary", icon: "ti-receipt-tax", label: "nav.taxSummary" },
];

const MOBILE_BREAKPOINT = 768;

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, business, logout } = useAuthStore();
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const location = useLocation();

  const isMobile = () => window.innerWidth < MOBILE_BREAKPOINT;

  // Sidebar open state — collapsed by default on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile());
  const [mobile, setMobile] = useState(() => isMobile());

  // Apply the user's saved language on login and on page refresh
  useEffect(() => {
    if (user?.language) setAppLanguage(user.language);
  }, [user?.language]);

  // Track window resize
  useEffect(() => {
    const handleResize = () => {
      const nowMobile = isMobile();
      setMobile(nowMobile);
      if (nowMobile) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Close sidebar on mobile when the route changes.
  // State is adjusted during render (guarded by a previous-value check)
  // instead of in an effect, per https://react.dev/learn/you-might-not-need-an-effect
  // — this also catches browser back/forward navigation, not just link clicks.
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    if (mobile) setSidebarOpen(false);
  }

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

  const sidebarWidth = sidebarOpen ? 220 : 56;

  return (
    <div className="app-layout" style={{ position: "relative" }}>
      {/* ── Mobile overlay backdrop ── */}
      {mobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 99,
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        style={{
          width: mobile ? 220 : sidebarWidth,
          background: "var(--bg-sidebar)",
          borderRight: "0.5px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          transition: "width 0.2s ease, transform 0.2s ease",
          overflow: "hidden",
          // On mobile: slide in/out from left as overlay
          ...(mobile
            ? {
                position: "fixed",
                top: 0,
                left: 0,
                height: "100vh",
                zIndex: 100,
                transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
                width: 220,
              }
            : {}),
        }}
      >
        {/* Logo + toggle */}
        <div
          style={{
            padding: sidebarOpen ? "16px 20px" : "16px 0",
            borderBottom: "0.5px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: sidebarOpen ? "space-between" : "center",
            minHeight: 60,
          }}
        >
          {sidebarOpen && (
            <div>
              <div
                style={{
                  color: "var(--brand)",
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: 3,
                }}
              >
                LEDGR
              </div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 11,
                  marginTop: 1,
                }}
              >
                {business?.name || t("nav.myBusiness")}
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={
              sidebarOpen ? t("nav.collapseSidebar") : t("nav.expandSidebar")
            }
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            <i
              className={`ti ${sidebarOpen ? "ti-layout-sidebar-left-collapse" : "ti-layout-sidebar-left-expand"}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Nav links */}
        <nav
          style={{
            flex: 1,
            padding: "10px 0",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={!sidebarOpen ? t(item.label) : undefined}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: sidebarOpen ? 10 : 0,
                padding: sidebarOpen ? "10px 20px" : "10px 0",
                justifyContent: sidebarOpen ? "flex-start" : "center",
                color: isActive ? "var(--brand)" : "var(--text-secondary)",
                background: isActive ? "var(--brand-light)" : "transparent",
                borderLeft: isActive
                  ? "2px solid var(--brand)"
                  : "2px solid transparent",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                transition: "all 0.15s",
                whiteSpace: "nowrap",
                overflow: "hidden",
              })}
            >
              <i
                className={`ti ${item.icon}`}
                style={{ fontSize: 18, flexShrink: 0 }}
                aria-hidden="true"
              />
              {sidebarOpen && <span>{t(item.label)}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: theme + user + logout */}
        <div
          style={{
            borderTop: "0.5px solid var(--border-color)",
            padding: sidebarOpen ? "12px 16px" : "12px 0",
          }}
        >
          {/* Theme toggle */}
          {sidebarOpen ? (
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
                {theme === "dark" ? t("nav.darkMode") : t("nav.lightMode")}
              </div>
              <button
                onClick={() => {
                  const next = theme === "light" ? "dark" : "light";
                  document.documentElement.setAttribute("data-theme", next);
                  localStorage.setItem(
                    "ledgr-theme",
                    JSON.stringify({ state: { theme: next }, version: 0 }),
                  );
                  useThemeStore.setState({ theme: next });
                }}
                aria-label={t("nav.toggleTheme")}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background:
                    theme === "dark" ? "var(--brand)" : "var(--border-color)",
                  border: "none",
                  cursor: "pointer",
                  position: "relative",
                  flexShrink: 0,
                  transition: "background 0.2s",
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
          ) : (
            <button
              onClick={() => {
                const next = theme === "light" ? "dark" : "light";
                document.documentElement.setAttribute("data-theme", next);
                localStorage.setItem(
                  "ledgr-theme",
                  JSON.stringify({ state: { theme: next }, version: 0 }),
                );
                useThemeStore.setState({ theme: next });
              }}
              title={t("nav.toggleTheme")}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "8px 0",
                display: "flex",
                justifyContent: "center",
                marginBottom: 8,
              }}
            >
              <i
                className={`ti ${theme === "dark" ? "ti-sun" : "ti-moon"}`}
                style={{ fontSize: 18 }}
                aria-hidden="true"
              />
            </button>
          )}

          {/* User info */}
          {sidebarOpen && (
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
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            title={!sidebarOpen ? t("nav.signOut") : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: sidebarOpen ? 6 : 0,
              justifyContent: sidebarOpen ? "flex-start" : "center",
              width: "100%",
              padding: sidebarOpen ? "7px 8px" : "7px 0",
              borderRadius: 6,
              border: sidebarOpen ? "0.5px solid var(--border-color)" : "none",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <i
              className="ti ti-logout"
              style={{ fontSize: sidebarOpen ? 14 : 18 }}
              aria-hidden="true"
            />
            {sidebarOpen && t("nav.signOut")}
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
            padding: "0 20px",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 12,
          }}
        >
          {/* Mobile menu button */}
          {mobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label={t("nav.openMenu")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-secondary)",
                fontSize: 20,
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <i className="ti ti-menu-2" aria-hidden="true" />
            </button>
          )}

          {/* Mobile logo */}
          {mobile && (
            <div
              style={{
                color: "var(--brand)",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 3,
              }}
            >
              LEDGR
            </div>
          )}

          <div
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              flex: 1,
              textAlign: mobile ? "right" : "left",
            }}
          >
            {new Date().toLocaleDateString(
              i18n.language === "es" ? "es-PR" : "en-US",
              {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              },
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <LanguageToggle />
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
