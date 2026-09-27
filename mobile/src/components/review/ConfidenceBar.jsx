import { useTranslation } from "react-i18next";
import cx from "@abaco/ui/cx";
import { confidenceLevel, parseAmount } from "../../lib/booking.js";

// Same thresholds as the web (≥0.7 high, ≥0.4 medium). Literal class names so
// the Tailwind content scanner sees them — never interpolate.
const CLASSES = {
  high: { text: "text-income", bar: "bg-income" },
  medium: { text: "text-payroll", bar: "bg-payroll" },
  low: { text: "text-expense", bar: "bg-expense" },
};

export default function ConfidenceBar({ value, className }) {
  const { t } = useTranslation();
  const raw = parseAmount(value);
  const pct = Number.isFinite(raw)
    ? Math.round(Math.min(1, Math.max(0, raw)) * 100)
    : 0;
  const cls = CLASSES[confidenceLevel(raw)];

  return (
    <div
      className={cx("px-3.5 py-2.5 bg-canvas rounded-lg", className)}
      role="meter"
      aria-label={t("mobile.review.confidence")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="flex justify-between mb-1.5">
        <span className="text-xs text-secondary">
          {t("mobile.review.confidence")}
        </span>
        <span className={cx("text-xs font-medium", cls.text)}>{pct}%</span>
      </div>
      <div className="h-1 bg-line rounded-sm">
        <div
          className={cx(
            "h-full rounded-sm transition-all duration-300",
            cls.bar,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
