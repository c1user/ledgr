import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Combined "Projects" hub. Projects and time tracking are linked through job
// costing (time entries roll up to projects), so they live behind a single nav
// item as tab routes. Projects is the index tab, hence `end` (its path
// /projects is a prefix of /projects/time).
const TABS = [
  { to: "/projects", end: true, labelKey: "projects.title" },
  { to: "/projects/time", labelKey: "time.title" },
];

export default function ProjectsHub() {
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
