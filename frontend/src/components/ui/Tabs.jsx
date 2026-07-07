import cx from "../../lib/cx";

// tabs: [{ id, label, icon? }]
export default function Tabs({ tabs, active, onChange, className }) {
  return (
    <div
      className={cx("flex gap-1 border-b border-line overflow-x-auto", className)}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            "px-3.5 py-2 text-md whitespace-nowrap -mb-px border-b-2 transition-colors cursor-pointer",
            active === tab.id
              ? "text-brand border-brand font-medium"
              : "text-secondary border-transparent hover:text-ink",
          )}
        >
          {tab.icon && (
            <i className={cx("ti", tab.icon, "mr-1")} aria-hidden="true" />
          )}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
