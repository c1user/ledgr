import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TabNav } from "../components/ui";

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
