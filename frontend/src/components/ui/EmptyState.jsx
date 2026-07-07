import cx from "../../lib/cx";

export default function EmptyState({
  icon = "ti-inbox",
  title,
  message,
  action,
  className,
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center text-center py-12 px-6",
        className,
      )}
    >
      <i
        className={cx("ti", icon, "text-3xl text-muted mb-2")}
        aria-hidden="true"
      />
      {title && <div className="text-md font-medium text-ink mb-1">{title}</div>}
      {message && (
        <div className="text-md text-muted max-w-sm mb-4">{message}</div>
      )}
      {action}
    </div>
  );
}
