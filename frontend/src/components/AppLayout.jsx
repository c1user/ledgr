import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useAuthStore from "../store/authStore";
import useThemeStore from "../store/themeStore";
import useInventoryStore from "../store/inventoryStore";
import LanguageToggle from "../components/LanguageToggle";
import { setAppLanguage } from "../i18n";
import BRAND from "../config/brand";
import BrandMark from "./BrandMark";
import CommandPalette from "./CommandPalette";
import QuickAdd from "./QuickAdd";
import { navGroups } from "../config/nav";
import cx from "../lib/cx";
import useEntitlements from "../lib/useEntitlements";
import { Toggle } from "./ui";

const MOBILE_BREAKPOINT = 768;

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, business, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { plan, hasFeature, isLoading: entLoading } = useEntitlements();
  const reorderCount = useInventoryStore((s) => s.reorderCount);
  const navigate = useNavigate();
  const location = useLocation();

  const isMobile = () => window.innerWidth < MOBILE_BREAKPOINT;

  // Sidebar open state — collapsed by default on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile());
  const [mobile, setMobile] = useState(() => isMobile());
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Ctrl+K / Cmd+K toggles the command palette
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  return (
    <div className="relative flex h-screen overflow-hidden print:h-auto print:overflow-visible">
      {/* ── Mobile overlay backdrop ── */}
      {mobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/40 z-[99]"
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={cx(
          "flex flex-col shrink-0 overflow-hidden bg-sidebar border-r border-line print:hidden",
          "transition-[width,transform] duration-200 ease-in-out",
          mobile
            ? cx(
                "fixed top-0 left-0 h-screen z-[100] w-[220px]",
                sidebarOpen ? "translate-x-0" : "-translate-x-full",
              )
            : sidebarOpen
              ? "w-[220px]"
              : "w-14",
        )}
      >
        {/* Logo + toggle */}
        <div
          className={cx(
            "flex items-center border-b border-line min-h-[60px] py-4",
            sidebarOpen ? "justify-between px-5" : "justify-center px-0",
          )}
        >
          {sidebarOpen && (
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandMark size={28} className="shrink-0" />
              <div className="min-w-0">
                <div className="font-display text-brand text-[15px] font-bold tracking-[3px] uppercase">
                  {BRAND.name}
                </div>
                <div className="text-muted text-[11px] mt-px truncate">
                  {business?.name || t("nav.myBusiness")}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={
              sidebarOpen ? t("nav.collapseSidebar") : t("nav.expandSidebar")
            }
            className="flex items-center justify-center p-1 rounded-md text-lg text-muted cursor-pointer shrink-0"
          >
            <i
              className={`ti ${sidebarOpen ? "ti-layout-sidebar-left-collapse" : "ti-layout-sidebar-left-expand"}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-2.5 overflow-y-auto overflow-x-hidden">
          {navGroups.map((group, groupIndex) => (
            <div key={group.label || `group-${groupIndex}`}>
              {/* Section header (expanded) or a divider (collapsed) */}
              {group.label &&
                (sidebarOpen ? (
                  <div className="px-5 pt-3.5 pb-1 text-[10px] font-semibold tracking-[0.8px] uppercase text-muted">
                    {t(group.label)}
                  </div>
                ) : (
                  <div className="h-px bg-line mx-3 my-2" />
                ))}

              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={!sidebarOpen ? t(item.label) : undefined}
                  className={({ isActive }) =>
                    cx(
                      "flex items-center text-md whitespace-nowrap overflow-hidden",
                      "border-l-2 transition-all",
                      sidebarOpen
                        ? "gap-2.5 px-5 py-2.5 justify-start"
                        : "px-0 py-2.5 justify-center",
                      isActive
                        ? "text-brand bg-brand-light border-brand font-medium"
                        : "text-secondary bg-transparent border-transparent",
                    )
                  }
                >
                  <i
                    className={`ti ${item.icon} text-lg shrink-0`}
                    aria-hidden="true"
                  />
                  {sidebarOpen && <span>{t(item.label)}</span>}
                  {sidebarOpen &&
                    item.feature &&
                    !entLoading &&
                    !hasFeature(item.feature) && (
                      <i
                        className="ti ti-lock ml-auto text-muted text-sm shrink-0"
                        title={t("upgrade.locked")}
                        aria-hidden="true"
                      />
                    )}
                  {sidebarOpen &&
                    item.to === "/inventory" &&
                    reorderCount > 0 &&
                    (!item.feature || hasFeature(item.feature)) && (
                      <span className="ml-auto bg-danger text-white text-[10px] font-bold px-1.5 rounded-lg leading-4">
                        {reorderCount}
                      </span>
                    )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom: theme + user + logout */}
        <div
          className={cx(
            "border-t border-line py-3",
            sidebarOpen ? "px-4" : "px-0",
          )}
        >
          {/* Theme toggle */}
          {sidebarOpen ? (
            <div className="flex items-center justify-between mb-3 px-1 py-1.5">
              <div className="flex items-center gap-2 text-secondary text-xs">
                <i
                  className={`ti ${theme === "dark" ? "ti-moon" : "ti-sun"} text-[15px]`}
                  aria-hidden="true"
                />
                {theme === "dark" ? t("nav.darkMode") : t("nav.lightMode")}
              </div>
              <Toggle
                checked={theme === "dark"}
                onChange={toggleTheme}
                aria-label={t("nav.toggleTheme")}
              />
            </div>
          ) : (
            <button
              onClick={toggleTheme}
              title={t("nav.toggleTheme")}
              className="flex justify-center w-full py-2 mb-2 text-lg text-muted cursor-pointer"
            >
              <i
                className={`ti ${theme === "dark" ? "ti-sun" : "ti-moon"}`}
                aria-hidden="true"
              />
            </button>
          )}

          {/* User info */}
          {sidebarOpen && (
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center w-[30px] h-[30px] rounded-full bg-brand-light text-brand text-[11px] font-semibold shrink-0">
                {initials || "??"}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-ink truncate">
                  {user?.name || "User"}
                </div>
                <div className="text-[11px] text-muted truncate">
                  {user?.role}
                </div>
              </div>
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            title={!sidebarOpen ? t("nav.signOut") : undefined}
            className={cx(
              "flex items-center w-full rounded-md bg-transparent text-secondary text-xs cursor-pointer transition-all",
              sidebarOpen
                ? "gap-1.5 justify-start px-2 py-1.5 border border-line"
                : "justify-center px-0 py-1.5",
            )}
          >
            <i
              className={cx("ti ti-logout", sidebarOpen ? "text-sm" : "text-lg")}
              aria-hidden="true"
            />
            {sidebarOpen && t("nav.signOut")}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-3 h-[52px] px-5 bg-surface border-b border-line shrink-0 print:hidden">
          {/* Mobile menu button */}
          {mobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label={t("nav.openMenu")}
              className="flex items-center text-xl text-secondary cursor-pointer shrink-0"
            >
              <i className="ti ti-menu-2" aria-hidden="true" />
            </button>
          )}

          {/* Mobile logo */}
          {mobile && (
            <div className="font-display text-brand text-sm font-bold tracking-[3px] uppercase">
              {BRAND.name}
            </div>
          )}

          <div
            className={cx(
              "flex-1 text-md text-muted",
              mobile ? "text-right" : "text-left",
            )}
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

          <div className="flex items-center gap-2 shrink-0">
            <QuickAdd />
            <button
              onClick={() => setPaletteOpen(true)}
              title={t("palette.placeholder")}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-secondary hover:text-ink hover:bg-canvas cursor-pointer"
            >
              <i className="ti ti-search" aria-hidden="true" />
              {!mobile && (
                <kbd className="text-[10px] text-muted border border-line rounded px-1 py-px">
                  Ctrl K
                </kbd>
              )}
            </button>
            <LanguageToggle />
            <span className="text-[11px] px-2 py-[3px] rounded bg-brand-light text-brand font-medium">
              {(plan || business?.plan || "starter").toUpperCase()}
            </span>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 print:overflow-visible">
          <Outlet />
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
