import cx from "../../lib/cx";

const VARIANTS = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "bg-canvas text-ink border border-line hover:bg-sunken",
  danger: "bg-danger-bg text-danger border border-danger hover:opacity-80",
  ghost: "bg-transparent text-secondary hover:bg-canvas hover:text-ink",
};

const SIZES = {
  sm: "px-2.5 py-1.5 text-xs rounded-md gap-1",
  md: "px-3.5 py-2 text-md rounded-lg gap-1.5",
};

export default function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  full = false,
  type = "button",
  disabled,
  className,
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center font-medium cursor-pointer transition-all",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        full && "w-full justify-center",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />
      ) : (
        icon && <i className={cx("ti", icon)} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
