import cx from "@abaco/ui/cx";

/**
 * Segmented control (radiogroup) for 2–3 exclusive choices: appearance and
 * language on the Settings screen. Each segment is a 44px tap target.
 *
 *   <Segmented value="dark" onChange={setTheme} ariaLabel="Appearance"
 *              options={[{ value: "light", label: "Light", icon: "ti-sun" }]} />
 */
export default function Segmented({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("flex w-full rounded-lg bg-sunken p-0.5", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              "flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-md font-medium transition-colors",
              active
                ? "bg-surface text-brand shadow-card"
                : "text-secondary hover:text-ink",
            )}
          >
            {opt.icon && (
              <i
                className={cx("ti text-base leading-none", opt.icon)}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
