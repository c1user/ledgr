import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { resolveCatName } from "../lib/coaCategories";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import quarterOfYear from "dayjs/plugin/quarterOfYear";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import cx from "../lib/cx";
import { downloadFile } from "../lib/download";
import { Button, Card, Input } from "../components/ui";

dayjs.extend(quarterOfYear);

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const PRESETS = [
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "lastYear",
];

function getDateRange(period) {
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

// ── Period Selector ───────────────────────────────────────────
function PeriodSelector({
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

// ── P&L Row ───────────────────────────────────────────────────
function PLRow({ color, name, total, fmt, currency }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-line">
      <div className="flex items-center gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: color || "#6b6880" }}
        />
        <span className="text-sm text-ink">{name}</span>
      </div>
      <span className="text-sm font-medium text-ink">
        {fmt(total, currency)}
      </span>
    </div>
  );
}

// ── P&L Section ───────────────────────────────────────────────
function PLSection({ title, categories, total, totalLabel, fmt, currency, t }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold tracking-[1.5px] text-muted uppercase pb-2 border-b-[1.5px] border-line mb-1">
        {title}
      </div>
      {categories.length === 0 ? (
        <div className="text-md text-muted py-2.5">—</div>
      ) : (
        categories.map((cat) => (
          <PLRow
            key={cat.category_id}
            color={cat.category_color}
            name={resolveCatName(cat.category_name_key, cat.category_name, t)}
            total={parseFloat(cat.total)}
            fmt={fmt}
            currency={currency}
          />
        ))
      )}
      <div className="flex justify-between pt-2.5 pb-1 font-bold text-sm text-ink">
        <span>{totalLabel}</span>
        <span>{fmt(total, currency)}</span>
      </div>
    </div>
  );
}

// ── Custom Tooltip for bar chart ──────────────────────────────
function TrendTooltip({ active, payload, label, fmt, currency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-line rounded-lg px-3.5 py-2.5 shadow-card min-w-[140px]">
      <div className="text-xs text-muted mb-1.5">
        {dayjs(label).format("MMMM YYYY")}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 text-md">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold text-ink">{fmt(p.value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Trend Chart ───────────────────────────────────────────────
function TrendChart({ data, fmt, currency, t }) {
  if (!data || data.length === 0) return null;

  const chartData = data.map((d) => ({
    month: d.month,
    [t("reports.trendIncome")]: parseFloat(d.income),
    [t("reports.trendExpenses")]: parseFloat(d.expenses),
  }));

  const incomeKey = t("reports.trendIncome");
  const expensesKey = t("reports.trendExpenses");

  return (
    <Card padding="none" className="p-5">
      <div className="text-md font-semibold text-ink mb-4">
        {t("reports.monthlyTrend")}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} barGap={4} barCategoryGap="30%">
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-color)"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tickFormatter={(v) => dayjs(v).format("MMM")}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => {
              if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
              return v;
            }}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            content={<TrendTooltip fmt={fmt} currency={currency} t={t} />}
            cursor={{ fill: "var(--bg-secondary)", opacity: 0.5 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
          <Bar dataKey={incomeKey} fill="var(--income)" radius={[3, 3, 0, 0]} />
          <Bar
            dataKey={expensesKey}
            fill="var(--expense)"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── P&L Statement ─────────────────────────────────────────────
function PLStatement({ data, startDate, endDate, fmt, currency, t }) {
  const isProfit = data.net_income >= 0;

  return (
    <Card padding="none" className="p-6">
      {/* Header */}
      <div className="mb-5">
        <div className="text-[17px] font-bold text-ink">
          {t("reports.profitLoss")}
        </div>
        {startDate && endDate && (
          <div className="text-xs text-muted mt-1">
            {dayjs(startDate).format("MMM D, YYYY")} –{" "}
            {dayjs(endDate).format("MMM D, YYYY")}
          </div>
        )}
      </div>

      <PLSection
        title={t("reports.revenue")}
        categories={data.income_categories}
        total={data.total_income}
        totalLabel={t("reports.totalRevenue")}
        fmt={fmt}
        currency={currency}
        t={t}
      />

      <PLSection
        title={t("reports.expenses")}
        categories={data.expense_categories}
        total={data.total_expenses}
        totalLabel={t("reports.totalExpenses")}
        fmt={fmt}
        currency={currency}
        t={t}
      />

      {/* Net income line */}
      <div className="border-t-2 border-line pt-3 flex justify-between items-center">
        <span className="text-[15px] font-bold text-ink">
          {isProfit ? t("reports.netIncome") : t("reports.netLoss")}
        </span>
        <span
          className={cx(
            "text-lg font-bold",
            isProfit ? "text-income" : "text-expense",
          )}
        >
          {fmt(Math.abs(data.net_income), currency)}
        </span>
      </div>
    </Card>
  );
}

// ── FX Currency Summary ───────────────────────────────────────
function FXSummary({ currencies, baseCurrency, fmt, t }) {
  if (!currencies || currencies.length === 0) return null;
  return (
    <Card padding="none" className="p-5 mt-4">
      <div className="flex items-center gap-2 text-md font-semibold text-ink mb-3">
        <i className="ti ti-currency-dollar text-base" aria-hidden="true" />
        {t("fx.fxSectionTitle")}
      </div>
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 items-center text-xs text-muted font-semibold tracking-[0.5px] uppercase pb-1.5 border-b-[1.5px] border-line mb-1">
        <span>{t("fx.fxCurrencyCol")}</span>
        <span />
        <span className="text-right">{t("fx.fxOriginalCol")}</span>
        <span className="text-right">
          {t("fx.fxConvertedCol", { base: baseCurrency })}
        </span>
      </div>
      {currencies.map((row) => (
        <div
          key={row.currency}
          className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 items-center py-2 border-b border-line"
        >
          <span className="text-xs font-bold bg-brand-light text-brand px-2 py-0.5 rounded">
            {row.currency}
          </span>
          <span className="text-xs text-muted">
            {row.count} {t("fx.fxTransactions")}
          </span>
          <span className="text-md font-medium text-ink text-right">
            {fmt(parseFloat(row.original_total), row.currency)}
          </span>
          <span className="text-md font-medium text-ink text-right">
            {fmt(parseFloat(row.converted_total), baseCurrency)}
          </span>
        </div>
      ))}
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ProfitLoss() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const [period, setPeriod] = useState("thisMonth");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { startDate, endDate } =
    period === "custom"
      ? { startDate: customStart, endDate: customEnd }
      : getDateRange(period);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pl-report", startDate, endDate],
    queryFn: () =>
      api
        .get(`/reports/pl?startDate=${startDate}&endDate=${endDate}`)
        .then((r) => r.data),
    enabled: !!(startDate && endDate),
  });

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Page header */}
      <div className="print-hide flex justify-between items-center mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-ink">{t("reports.profitLoss")}</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            icon="ti-file-type-pdf"
            className="print-hide"
            disabled={!startDate || !endDate}
            onClick={() =>
              downloadFile(
                `/reports/pl/pdf?startDate=${startDate}&endDate=${endDate}&lang=${i18n.language === "es" ? "es" : "en"}`,
                `profit-loss-${startDate}-to-${endDate}.pdf`,
              )
            }
          >
            {t("common.downloadPdf")}
          </Button>
          <Button
            size="sm"
            icon="ti-printer"
            className="print-hide"
            onClick={() => window.print()}
          >
            {t("reports.print")}
          </Button>
        </div>
      </div>

      {/* Period selector */}
      <div className="mb-5">
        <PeriodSelector
          period={period}
          setPeriod={setPeriod}
          customStart={customStart}
          setCustomStart={setCustomStart}
          customEnd={customEnd}
          setCustomEnd={setCustomEnd}
          t={t}
        />
      </div>

      {/* Content */}
      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("reports.loading")}
        </div>
      )}

      {isError && (
        <div className="text-expense text-sm py-10 text-center">
          {t("reports.error")}
        </div>
      )}

      {data && !isLoading && (
        <>
          {data.income_categories.length === 0 &&
          data.expense_categories.length === 0 ? (
            <Card className="text-center text-muted text-sm">
              {t("reports.noData")}
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(280px,1fr)_minmax(280px,1.2fr)] gap-4 items-start">
                <PLStatement
                  data={data}
                  startDate={startDate}
                  endDate={endDate}
                  fmt={fmt}
                  currency={currency}
                  t={t}
                />
                <TrendChart
                  data={data.monthly_trend}
                  fmt={fmt}
                  currency={currency}
                  t={t}
                />
              </div>
              <FXSummary
                currencies={data.fx_currencies}
                baseCurrency={currency}
                fmt={fmt}
                t={t}
              />
            </>
          )}
        </>
      )}

      <style>{`
        @media print {
          .print-hide { display: none !important; }
          .sidebar, header, nav { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
