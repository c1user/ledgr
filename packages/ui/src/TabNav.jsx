import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import cx from "./cx.js";

// Route-based tab bar — the NavLink twin of Tabs.
// tabs: [{ to, end?, label }]
export default function TabNav({ tabs, className }) {
  const ref = useRef(null);
  const { pathname } = useLocation();

  // On phones the strip scrolls sideways; keep the active tab in view when
  // a deep link lands on one that sits past the edge.
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <div
      ref={ref}
      className={cx(
        "flex gap-1 mb-5 border-b border-line overflow-x-auto scrollbar-none",
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
