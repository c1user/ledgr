import { Button, Input } from "./ui";
import { PRESETS } from "../lib/reportPeriods";

// Shared by the report pages (P&L, Cash Flow): preset period buttons +
// custom date range. Keys live under reports.period_* in the locale files.
export default function PeriodSelector({
  period,
  setPeriod,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
  t,
}) {
  return (
    <div className="print-hide flex flex-wrap gap-2 items-center">
      {PRESETS.map((p) => (
        <Button
          key={p}
          size="sm"
          variant={period === p ? "primary" : "secondary"}
          onClick={() => setPeriod(p)}
        >
          {t(`reports.period_${p}`)}
        </Button>
      ))}
      <Button
        size="sm"
        variant={period === "custom" ? "primary" : "secondary"}
        onClick={() => setPeriod("custom")}
      >
        {t("reports.periodCustom")}
      </Button>
      {period === "custom" && (
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-md text-muted">{t("reports.customFrom")}</label>
          <Input
            type="date"
            className="w-auto px-2 py-1"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <label className="text-md text-muted">{t("reports.customTo")}</label>
          <Input
            type="date"
            className="w-auto px-2 py-1"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
