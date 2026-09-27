import cx from "@abaco/ui/cx";

// Horizontal chip row (All · Pending · Reviewed · Linked). Each chip is a
// 44px-tall button (thumb target) drawing a smaller pill inside; the row
// scrolls sideways on narrow phones without a visible scrollbar.
const PILL = {
  active: "bg-brand text-on-brand border-brand",
  idle: "bg-surface text-secondary border-line",
};

export default function StatusChips({
  options = [],
  value,
  onChange,
  label,
  className,
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(opt.value)}
            className="flex min-h-[44px] shrink-0 items-center"
          >
            <span
              className={cx(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                active ? PILL.active : PILL.idle,
              )}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
