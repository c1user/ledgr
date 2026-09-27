import cx from "@abaco/ui/cx";

/**
 * One row inside a Settings <Card padding="none" className="divide-y ...">.
 *
 *   <SettingRow icon="ti-user" label="Name" value="Ana" />
 *   <SettingRow label="Reminders" hint="..." control={<Toggle .../>} />
 *   <SettingRow label="Appearance" stacked>{<Segmented .../>}</SettingRow>
 *   <SettingRow label="Terms" onPress={...} />          → full-width button
 *
 * Every row is at least 52px tall (44px thumb target + breathing room).
 */
export default function SettingRow({
  icon,
  label,
  hint,
  value,
  control,
  children,
  onPress,
  trailingIcon = "ti-chevron-right",
  htmlFor,
  stacked = false,
  className,
}) {
  const text = (
    <div className="min-w-0 flex-1">
      {label &&
        (htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="block text-md font-medium text-ink"
          >
            {label}
          </label>
        ) : (
          <div className="text-md font-medium text-ink">{label}</div>
        ))}
      {hint && <div className="text-xs text-muted leading-snug">{hint}</div>}
    </div>
  );

  const leading = icon ? (
    <i
      className={cx("ti text-xl text-muted shrink-0 leading-none", icon)}
      aria-hidden="true"
    />
  ) : null;

  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        className={cx(
          "flex w-full min-h-[52px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas active:bg-sunken",
          className,
        )}
      >
        {leading}
        {text}
        {value != null && (
          <span className="text-md text-secondary truncate max-w-[45%]">
            {value}
          </span>
        )}
        <i
          className={cx("ti text-lg text-muted shrink-0", trailingIcon)}
          aria-hidden="true"
        />
      </button>
    );
  }

  if (stacked) {
    return (
      <div className={cx("px-4 py-3", className)}>
        <div className="mb-2 flex items-center gap-3">
          {leading}
          {text}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "flex min-h-[52px] items-center gap-3 px-4 py-2.5",
        className,
      )}
    >
      {leading}
      {text}
      {value != null && (
        <span className="text-md text-secondary truncate max-w-[55%] text-right">
          {value}
        </span>
      )}
      {control && <div className="shrink-0">{control}</div>}
      {children}
    </div>
  );
}
