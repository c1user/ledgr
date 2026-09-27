import cx from "./cx.js";

// Small pill switch (36x20) used for boolean form options.
export default function Toggle({ checked, onChange, className, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cx(
        "relative w-9 h-5 rounded-full cursor-pointer shrink-0 transition-colors",
        "after:absolute after:-inset-2 after:content-['']",
        checked ? "bg-brand" : "bg-line",
        className,
      )}
      {...rest}
    >
      <div
        className={cx(
          "absolute top-[3px] w-3.5 h-3.5 bg-white rounded-full transition-all",
          checked ? "left-[18px]" : "left-[3px]",
        )}
      />
    </button>
  );
}
