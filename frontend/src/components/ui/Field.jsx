import cx from "../../lib/cx";

// Label + control wrapper. Pass the control as children:
//   <Field label="Email" htmlFor="email"><Input id="email" ... /></Field>
export default function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}) {
  return (
    <div className={cx("mb-4", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium text-secondary mb-1"
        >
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <div className="text-[11px] text-muted mt-1">{hint}</div>
      )}
      {error && <div className="text-[11px] text-danger mt-1">{error}</div>}
    </div>
  );
}
