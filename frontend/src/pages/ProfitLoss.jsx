import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
function PeriodSelector({ period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd, t }) {
  return (
    <div className="print-hide" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {PRESETS.map((p) => (
        <button
          key={p}
          className={`btn btn-sm ${period === p ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setPeriod(p)}
        >
          {t(`reports.period_${p}`)}
        </button>
      ))}
      <button
        className={`btn btn-sm ${period === "custom" ? "btn-primary" : "btn-secondary"}`}
        onClick={() => setPeriod("custom")}
      >
        {t("reports.periodCustom")}
      </button>
      {period === "custom" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("reports.customFrom")}</label>
          <input
            type="date"
            className="form-input"
            style={{ width: "auto", padding: "4px 8px", fontSize: 13 }}
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <label style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("reports.customTo")}</label>
          <input
            type="date"
            className="form-input"
            style={{ width: "auto", padding: "4px 8px", fontSize: 13 }}
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "0.5px solid var(--border-color)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: color || "#888888",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{name}</span>
      </div>
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
        {fmt(total, currency)}
      </span>
    </div>
  );
}

// ── P&L Section ───────────────────────────────────────────────
function PLSection({ title, categories, total, totalLabel, fmt, currency }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.5,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          paddingBottom: 8,
          borderBottom: "1.5px solid var(--border-color)",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {categories.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 0" }}>—</div>
      ) : (
        categories.map((cat) => (
          <PLRow
            key={cat.category_id}
            color={cat.category_color}
            name={cat.category_name}
            total={parseFloat(cat.total)}
            fmt={fmt}
            currency={currency}
          />
        ))
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 0 4px",
          fontWeight: 700,
          fontSize: 14,
          color: "var(--text-primary)",
        }}
      >
        <span>{totalLabel}</span>
        <span>{fmt(total, currency)}</span>
      </div>
    </div>
  );
}

// ── Custom Tooltip for bar chart ──────────────────────────────
function TrendTooltip({ active, payload, label, fmt, currency, t }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--bg-primary)",
        border: "0.5px solid var(--border-color)",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "var(--card-shadow)",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
        {dayjs(label).format("MMMM YYYY")}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
            {fmt(p.value, currency)}
          </span>
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
    <div className="card" style={{ padding: "20px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>
        {t("reports.monthlyTrend")}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} barGap={4} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
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
          <Bar dataKey={incomeKey} fill="var(--income, #22c55e)" radius={[3, 3, 0, 0]} />
          <Bar dataKey={expensesKey} fill="var(--expense, #ef4444)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── P&L Statement ─────────────────────────────────────────────
function PLStatement({ data, startDate, endDate, fmt, currency, t }) {
  const isProfit = data.net_income >= 0;

  return (
    <div className="card" style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
          {t("reports.profitLoss")}
        </div>
        {startDate && endDate && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {dayjs(startDate).format("MMM D, YYYY")} – {dayjs(endDate).format("MMM D, YYYY")}
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
      />

      <PLSection
        title={t("reports.expenses")}
        categories={data.expense_categories}
        total={data.total_expenses}
        totalLabel={t("reports.totalExpenses")}
        fmt={fmt}
        currency={currency}
      />

      {/* Net income line */}
      <div
        style={{
          borderTop: "2px solid var(--border-color)",
          paddingTop: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
          {isProfit ? t("reports.netIncome") : t("reports.netLoss")}
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: isProfit ? "var(--income, #22c55e)" : "var(--expense, #ef4444)",
          }}
        >
          {fmt(Math.abs(data.net_income), currency)}
        </span>
      </div>
    </div>
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
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Page header */}
      <div
        className="print-hide"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            {t("reports.profitLoss")}
          </h1>
        </div>
        <button
          className="btn btn-secondary btn-sm print-hide"
          onClick={() => window.print()}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className="ti ti-printer" style={{ fontSize: 15 }} />
          {t("reports.print")}
        </button>
      </div>

      {/* Period selector */}
      <div style={{ marginBottom: 20 }}>
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
        <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          {t("reports.loading")}
        </div>
      )}

      {isError && (
        <div style={{ color: "var(--expense, #ef4444)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          {t("reports.error")}
        </div>
      )}

      {data && !isLoading && (
        <>
          {data.income_categories.length === 0 && data.expense_categories.length === 0 ? (
            <div
              className="card"
              style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}
            >
              {t("reports.noData")}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1.2fr)",
                gap: 16,
                alignItems: "start",
              }}
              className="pl-grid"
            >
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
          )}
        </>
      )}

      <style>{`
        @media (max-width: 768px) {
          .pl-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media print {
          .print-hide { display: none !important; }
          .sidebar, header, nav { display: none !important; }
          body { background: white !important; }
          .card {
            box-shadow: none !important;
            border: 1px solid #ddd !important;
          }
        }
      `}</style>
    </div>
  );
}
