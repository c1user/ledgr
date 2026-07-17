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
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import useEntitlements from "../lib/useEntitlements";
import cx from "../lib/cx";
import { downloadFile } from "../lib/download";
import PeriodSelector from "../components/PeriodSelector";
import { getDateRange } from "../lib/reportPeriods";
import { Button, Card, Select } from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// ── Comparison range (previous period / same period last year) ──
function getCompareRange(startDate, endDate, mode) {
  if (!startDate || !endDate || mode === "none")
    return { prevStart: null, prevEnd: null };
  const s = dayjs(startDate);
  const e = dayjs(endDate);
  if (mode === "prevYear") {
    return {
      prevStart: s.subtract(1, "year").format("YYYY-MM-DD"),
      prevEnd: e.subtract(1, "year").format("YYYY-MM-DD"),
    };
  }
  // previous period of equal length, ending the day before startDate
  const days = e.diff(s, "day") + 1;
  return {
    prevStart: s.subtract(days, "day").format("YYYY-MM-DD"),
    prevEnd: s.subtract(1, "day").format("YYYY-MM-DD"),
  };
}

// Change vs the comparison period. `invert` flips the good/bad coloring —
// expenses going down is the good direction.
function Delta({ current, prev, invert }) {
  if (prev === undefined || prev === null) return null;
  if (prev === 0 && current === 0) return null;
  const pct =
    prev === 0 ? null : ((current - prev) / Math.abs(prev)) * 100;
  const up = current >= prev;
  const good = invert ? !up : up;
  return (
    <span
      className={cx(
        "text-[11px] font-semibold px-1.5 py-px rounded",
        good ? "bg-income-bg text-income" : "bg-expense-bg text-expense",
      )}
    >
      {pct === null ? "new" : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
    </span>
  );
}

// ── P&L Row ───────────────────────────────────────────────────
function PLRow({ color, name, total, prev, invert, comparing, fmt, currency }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-line">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: color || "#6b6880" }}
        />
        <span className="text-sm text-ink truncate">{name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {comparing && (
          <>
            <span className="text-xs text-muted">
              {fmt(prev || 0, currency)}
            </span>
            <Delta current={total} prev={prev || 0} invert={invert} />
          </>
        )}
        <span className="text-sm font-medium text-ink">
          {fmt(total, currency)}
        </span>
      </div>
    </div>
  );
}

// ── P&L Section ───────────────────────────────────────────────
function PLSection({
  title,
  categories,
  total,
  totalLabel,
  prevTotals,
  prevTotal,
  invert,
  comparing,
  fmt,
  currency,
  t,
}) {
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
            prev={prevTotals?.[cat.category_id]}
            invert={invert}
            comparing={comparing}
            fmt={fmt}
            currency={currency}
          />
        ))
      )}
      <div className="flex justify-between items-center gap-2 pt-2.5 pb-1 font-bold text-sm text-ink">
        <span>{totalLabel}</span>
        <div className="flex items-center gap-2">
          {comparing && (
            <>
              <span className="text-xs text-muted font-normal">
                {fmt(prevTotal || 0, currency)}
              </span>
              <Delta current={total} prev={prevTotal || 0} invert={invert} />
            </>
          )}
          <span>{fmt(total, currency)}</span>
        </div>
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
function PLStatement({
  data,
  prevData,
  prevLabel,
  startDate,
  endDate,
  fmt,
  currency,
  t,
}) {
  const isProfit = data.net_income >= 0;
  const comparing = !!prevData;

  const toMap = (cats) =>
    Object.fromEntries(
      (cats || []).map((c) => [c.category_id, parseFloat(c.total)]),
    );
  const prevIncome = comparing ? toMap(prevData.income_categories) : null;
  const prevExpense = comparing ? toMap(prevData.expense_categories) : null;

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
            {comparing && prevLabel && (
              <span className="ml-1">
                · {t("reports.compareVs", { range: prevLabel })}
              </span>
            )}
          </div>
        )}
      </div>

      <PLSection
        title={t("reports.revenue")}
        categories={data.income_categories}
        total={data.total_income}
        totalLabel={t("reports.totalRevenue")}
        prevTotals={prevIncome}
        prevTotal={prevData?.total_income}
        comparing={comparing}
        fmt={fmt}
        currency={currency}
        t={t}
      />

      <PLSection
        title={t("reports.expenses")}
        categories={data.expense_categories}
        total={data.total_expenses}
        totalLabel={t("reports.totalExpenses")}
        prevTotals={prevExpense}
        prevTotal={prevData?.total_expenses}
        invert
        comparing={comparing}
        fmt={fmt}
        currency={currency}
        t={t}
      />

      {/* Net income line */}
      <div className="border-t-2 border-line pt-3 flex justify-between items-center gap-2">
        <span className="text-[15px] font-bold text-ink">
          {isProfit ? t("reports.netIncome") : t("reports.netLoss")}
        </span>
        <div className="flex items-center gap-2">
          {comparing && (
            <>
              <span className="text-xs text-muted">
                {fmt(prevData.net_income, currency)}
              </span>
              <Delta current={data.net_income} prev={prevData.net_income} />
            </>
          )}
          <span
            className={cx(
              "text-lg font-bold",
              isProfit ? "text-income" : "text-expense",
            )}
          >
            {fmt(Math.abs(data.net_income), currency)}
          </span>
        </div>
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
  const { hasFeature } = useEntitlements();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const [period, setPeriod] = useState("thisMonth");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [compare, setCompare] = useState("none"); // none | prevPeriod | prevYear

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

  // Period-over-period comparison (premium): same report, shifted range.
  const canCompare = hasFeature("advanced_reports");
  const { prevStart, prevEnd } = getCompareRange(
    startDate,
    endDate,
    canCompare ? compare : "none",
  );
  const { data: prevData } = useQuery({
    queryKey: ["pl-report", prevStart, prevEnd],
    queryFn: () =>
      api
        .get(`/reports/pl?startDate=${prevStart}&endDate=${prevEnd}`)
        .then((r) => r.data),
    enabled: !!(prevStart && prevEnd),
  });
  const comparing = !!(prevStart && prevEnd && prevData);
  const prevLabel = comparing
    ? `${dayjs(prevStart).format("MMM D, YYYY")} – ${dayjs(prevEnd).format("MMM D, YYYY")}`
    : null;

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

      {/* Period selector + comparison */}
      <div className="print-hide mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <PeriodSelector
          period={period}
          setPeriod={setPeriod}
          customStart={customStart}
          setCustomStart={setCustomStart}
          customEnd={customEnd}
          setCustomEnd={setCustomEnd}
          t={t}
        />
        {canCompare && (
          <div className="flex items-center gap-2">
            <label htmlFor="pl-compare" className="text-md text-muted">
              {t("reports.compareLabel")}
            </label>
            <Select
              id="pl-compare"
              className="w-auto px-2 py-1"
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
            >
              <option value="none">{t("reports.compare_none")}</option>
              <option value="prevPeriod">
                {t("reports.compare_prevPeriod")}
              </option>
              <option value="prevYear">{t("reports.compare_prevYear")}</option>
            </Select>
          </div>
        )}
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
                  prevData={comparing ? prevData : null}
                  prevLabel={prevLabel}
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
