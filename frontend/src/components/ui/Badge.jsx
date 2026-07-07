import cx from "../../lib/cx";

const TONES = {
  neutral: "bg-canvas text-secondary border border-line",
  brand: "bg-brand-light text-brand",
  income: "bg-income-bg text-income",
  expense: "bg-expense-bg text-expense",
  payroll: "bg-payroll-bg text-payroll",
  danger: "bg-danger-bg text-danger",
};

export default function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...rest
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon && <i className={cx("ti", icon)} aria-hidden="true" />}
      {children}
    </span>
  );
}
