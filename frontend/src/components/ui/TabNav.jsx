import { NavLink } from "react-router-dom";
import cx from "../../lib/cx";

// Route-based tab bar — the NavLink twin of Tabs.
// tabs: [{ to, end?, label }]
export default function TabNav({ tabs, className }) {
  return (
    <div
      className={cx(
        "flex gap-1 mb-5 border-b border-line overflow-x-auto",
        className,
      )}
    >
      {tabs.map(({ to, end, label }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cx(
              "px-5 py-2 text-md whitespace-nowrap -mb-px border-b-2 transition-colors",
              isActive
                ? "text-brand border-brand font-medium"
                : "text-secondary border-transparent hover:text-ink",
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}
