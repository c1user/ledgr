import dayjs from "dayjs";
import quarterOfYear from "dayjs/plugin/quarterOfYear";

dayjs.extend(quarterOfYear);

// Preset ranges shared by the report pages (P&L, Cash Flow).
// Labels live under reports.period_* in the locale files.
export const PRESETS = [
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "lastYear",
];

export function getDateRange(period) {
  const now = dayjs();
  switch (period) {
    case "thisMonth":
      return {
        startDate: now.startOf("month").format("YYYY-MM-DD"),
        endDate: now.endOf("month").format("YYYY-MM-DD"),
      };
    case "lastMonth": {
      const l = now.subtract(1, "month");
      return {
        startDate: l.startOf("month").format("YYYY-MM-DD"),
        endDate: l.endOf("month").format("YYYY-MM-DD"),
      };
    }
    case "thisQuarter":
      return {
        startDate: now.startOf("quarter").format("YYYY-MM-DD"),
        endDate: now.endOf("quarter").format("YYYY-MM-DD"),
      };
    case "lastQuarter": {
      const l = now.subtract(1, "quarter");
      return {
        startDate: l.startOf("quarter").format("YYYY-MM-DD"),
        endDate: l.endOf("quarter").format("YYYY-MM-DD"),
      };
    }
    case "thisYear":
      return {
        startDate: now.startOf("year").format("YYYY-MM-DD"),
        endDate: now.endOf("year").format("YYYY-MM-DD"),
      };
    case "lastYear": {
      const l = now.subtract(1, "year");
      return {
        startDate: l.startOf("year").format("YYYY-MM-DD"),
        endDate: l.endOf("year").format("YYYY-MM-DD"),
      };
    }
    default:
      return { startDate: null, endDate: null };
  }
}
