import cx from "../../lib/cx";

const PADDING = {
  none: "",
  sm: "p-3",
  md: "p-4 sm:p-5",
  lg: "p-6 sm:p-8",
};

export default function Card({ padding = "md", className, children, ...rest }) {
  return (
    <div
      className={cx(
        "bg-surface border border-line rounded-card shadow-card",
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
