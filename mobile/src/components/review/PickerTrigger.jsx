import { controlClass } from "@abaco/ui";
import cx from "@abaco/ui/cx";

/**
 * A control-shaped button that opens a bottom sheet (account, category).
 * Looks like Input/Select (same controlClass), 44px tall, chevron at right.
 */
export default function PickerTrigger({
  id,
  placeholder,
  empty,
  disabled,
  onClick,
  className,
  children,
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      className={cx(
        controlClass,
        "flex min-h-[44px] items-center justify-between gap-2 text-left",
        className,
      )}
    >
      <span className={cx("min-w-0 flex-1 truncate", empty && "text-muted")}>
        {empty ? placeholder : children}
      </span>
      <i
        className="ti ti-chevron-down shrink-0 text-muted"
        aria-hidden="true"
      />
    </button>
  );
}
