import { forwardRef } from "react";
import cx from "../../lib/cx";

// Shared look for all form controls (Input, Select, Textarea).
export const controlClass =
  "w-full px-3 py-2 rounded-lg border border-line bg-surface text-ink text-md " +
  "outline-none transition-colors focus:border-brand placeholder:text-muted " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(controlClass, className)} {...rest} />;
});

export default Input;
