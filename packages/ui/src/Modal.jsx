import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import cx from "./cx.js";
import Button from "./Button";

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  // Phone-only full-height sheet (mobile companion); a wide dialog on sm+.
  full: "sm:max-w-2xl",
};

// Bottom sheet on mobile, centered dialog on sm+ screens.
export default function Modal({
  open,
  onClose,
  title,
  size = "md",
  footer,
  children,
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cx(
          "relative w-full flex flex-col fade-in",
          size === "full"
            ? "h-[100dvh] max-h-none sm:h-auto sm:max-h-[85vh] rounded-t-none"
            : "max-h-[92dvh] sm:max-h-[85vh] rounded-t-card",
          "bg-surface border border-line shadow-card sm:rounded-card",
          // Clear the iOS home indicator / Android gesture bar inside a
          // native shell (0 on desktop). Capacitor 8 injects the CSS var.
          "pb-[max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))]",
          SIZES[size],
        )}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            icon="ti-x"
            onClick={onClose}
            aria-label={t("common.close")}
          />
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-line shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
