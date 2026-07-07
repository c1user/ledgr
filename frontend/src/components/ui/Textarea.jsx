import { forwardRef } from "react";
import cx from "../../lib/cx";
import { controlClass } from "./Input";

const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(controlClass, "min-h-[80px] resize-y", className)}
      {...rest}
    />
  );
});

export default Textarea;
