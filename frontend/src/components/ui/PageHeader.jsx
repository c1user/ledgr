import cx from "../../lib/cx";

export default function PageHeader({ title, subtitle, actions, className }) {
  return (
    <div
      className={cx(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5",
        className,
      )}
    >
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {subtitle && <div className="text-md text-muted">{subtitle}</div>}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </div>
  );
}
