import { useTranslation } from "react-i18next";
import { Card } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import useScanMeter from "./useScanMeter.js";

/**
 * Starter meter: "N of M scans used this month" with a bar, or "Unlimited
 * scans". Nothing rendered until entitlements have loaded. Informational
 * text only — no plan names with prices, no purchase links.
 */
export default function MeterCard({ className }) {
  const { t } = useTranslation();
  const { ready, metered, limit, used, limitReached } = useScanMeter();

  if (!ready) return null;

  if (!metered) {
    return (
      <Card
        padding="sm"
        className={cx("flex items-center gap-3", className)}
        role="status"
      >
        <i
          className="ti ti-infinity text-brand text-lg shrink-0"
          aria-hidden="true"
        />
        <span className="text-md text-ink">
          {t("mobile.scan.meterUnlimited")}
        </span>
      </Card>
    );
  }

  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  return (
    <Card
      padding="sm"
      className={cx("flex flex-col gap-2", className)}
      role="status"
    >
      <div className="flex items-center gap-3">
        <i
          className={cx(
            "ti ti-sparkles text-lg shrink-0",
            limitReached ? "text-danger" : "text-brand",
          )}
          aria-hidden="true"
        />
        <span className="flex-1 text-md text-ink">
          {t("mobile.scan.meterUsed", { used, limit })}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
        aria-hidden="true"
      >
        <div
          className={cx(
            "h-full rounded-full transition-[width] duration-300",
            limitReached ? "bg-danger" : "bg-brand",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {limitReached && (
        <div className="text-xs font-medium text-danger">
          {t("mobile.scan.limitReached")}
        </div>
      )}
    </Card>
  );
}
