import { forwardRef } from "react";
import cx from "../../lib/cx";
import { controlClass } from "./Input";

const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx(controlClass, "cursor-pointer", className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export default Select;
