import cx from "@abaco/ui/cx";

// Literal class maps (never interpolate Tailwind class names).
const TONES = {
  info: "bg-brand-light text-brand border-line",
  danger: "bg-danger-bg text-danger border-danger",
  neutral: "bg-sunken text-secondary border-line",
};

const ICONS = {
  info: "ti-clock-exclamation",
  danger: "ti-alert-circle",
  neutral: "ti-wifi-off",
};

/**
 * Inline message above a sign-in form: session expired (info), bad
 * credentials / too many attempts (danger), offline (neutral).
 * `title` is an optional bold headline; children are the body copy.
 */
export default function AuthBanner({
  tone = "info",
  icon,
  title,
  className,
  children,
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "mb-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-md fade-in",
        TONES[tone] || TONES.info,
        className,
      )}
    >
      <i
        className={cx("ti mt-0.5 shrink-0 text-base", icon || ICONS[tone])}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children &&
          (title ? (
            <div className="mt-0.5 text-xs opacity-90">{children}</div>
          ) : (
            <div>{children}</div>
          ))}
      </div>
    </div>
  );
}
