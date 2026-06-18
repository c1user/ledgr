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
import api from "../lib/api";
import useAuthStore from "../store/authStore";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

// ── Category row ──────────────────────────────────────────────
function CategoryRow({ color, name, total, fmt, currency }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 0",
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

// ── Category section ──────────────────────────────────────────
function CategorySection({ title, categories, total, totalLabel, fmt, currency }) {
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
          <CategoryRow
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

// ── Payroll tax row ───────────────────────────────────────────
function TaxRow({ label, value, fmt, currency, muted }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 0",
        borderBottom: "0.5px solid var(--border-color)",
      }}
    >
      <span style={{ fontSize: 14, color: muted ? "var(--text-muted)" : "var(--text-primary)" }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: muted ? 400 : 500, color: "var(--text-primary)" }}>
        {fmt(value, currency)}
      </span>
    </div>
  );
}

// ── Quarterly chart tooltip ───────────────────────────────────
function QuarterTooltip({ active, payload, label, fmt, currency, t }) {
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
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
        {label}
      </div>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13 }}
        >
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
            {fmt(p.value, currency)}
          </span>
        </div>
      ))}
      {payload.length === 2 && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "0.5px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>{t("tax.net")}</span>
          <span
            style={{
              fontWeight: 600,
              color:
                payload[0].value - payload[1].value >= 0
                  ? "var(--income, #22c55e)"
                  : "var(--expense, #ef4444)",
            }}
          >
            {fmt(payload[0].value - payload[1].value, currency)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Quarterly chart ───────────────────────────────────────────
function QuarterlyChart({ data, fmt, currency, t }) {
  const incomeKey = t("tax.income");
  const expensesKey = t("tax.expenses");

  const chartData = data.map((d) => ({
    quarter: d.quarter,
    [incomeKey]: d.income,
    [expensesKey]: d.expenses,
  }));

  return (
    <div className="card" style={{ padding: "20px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>
        {t("tax.quarterlyBreakdown")}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} barGap={4} barCategoryGap="35%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
          <XAxis
            dataKey="quarter"
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            content={<QuarterTooltip fmt={fmt} currency={currency} t={t} />}
            cursor={{ fill: "var(--bg-secondary)", opacity: 0.5 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey={incomeKey} fill="var(--income, #22c55e)" radius={[3, 3, 0, 0]} />
          <Bar dataKey={expensesKey} fill="var(--expense, #ef4444)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function TaxSummary() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const [year, setYear] = useState(CURRENT_YEAR);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tax-summary", year],
    queryFn: () => api.get(`/reports/tax?year=${year}`).then((r) => r.data),
  });

  const payroll = data?.payroll;
  const isProfit = (data?.net_income || 0) >= 0;
  const totalPayrollTaxes = payroll
    ? parseFloat(payroll.total_federal_tax) +
      parseFloat(payroll.total_social_security) +
      parseFloat(payroll.total_medicare) +
      parseFloat(payroll.total_pr_state_tax) +
      parseFloat(payroll.total_other_deductions)
    : 0;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
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
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          {t("tax.title")}
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Year selector */}
          <div style={{ display: "flex", gap: 6 }}>
            {YEARS.map((y) => (
              <button
                key={y}
                className={`btn btn-sm ${year === y ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
          <button
            className="btn btn-secondary btn-sm print-hide"
            onClick={() => window.print()}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <i className="ti ti-printer" style={{ fontSize: 15 }} />
            {t("tax.print")}
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          {t("tax.loading")}
        </div>
      )}

      {isError && (
        <div style={{ color: "var(--expense, #ef4444)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          {t("tax.error")}
        </div>
      )}

      {data && !isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Top row: income + expenses */}
          <div
            className="tax-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Income summary */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <div
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}
              >
                {t("tax.fiscalYear", { year })}
              </div>
              <CategorySection
                title={t("tax.revenue")}
                categories={data.income_categories}
                total={data.total_income}
                totalLabel={t("tax.totalRevenue")}
                fmt={fmt}
                currency={currency}
              />
              <CategorySection
                title={t("tax.expenses")}
                categories={data.expense_categories}
                total={data.total_expenses}
                totalLabel={t("tax.totalExpenses")}
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
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                  {isProfit ? t("tax.netIncome") : t("tax.netLoss")}
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

            {/* Payroll taxes */}
            <div className="card" style={{ padding: "20px 24px" }}>
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
                {t("tax.payrollTaxes")}
              </div>

              {!payroll || parseFloat(payroll.run_count) === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "20px 0" }}>
                  {t("tax.noPayroll")}
                </div>
              ) : (
                <>
                  <TaxRow label={t("tax.grossPayroll")} value={parseFloat(payroll.total_gross)} fmt={fmt} currency={currency} />
                  <TaxRow label={t("tax.federalIncomeTax")} value={parseFloat(payroll.total_federal_tax)} fmt={fmt} currency={currency} muted />
                  <TaxRow label={t("tax.socialSecurity")} value={parseFloat(payroll.total_social_security)} fmt={fmt} currency={currency} muted />
                  <TaxRow label={t("tax.medicare")} value={parseFloat(payroll.total_medicare)} fmt={fmt} currency={currency} muted />
                  <TaxRow label={t("tax.prStateTax")} value={parseFloat(payroll.total_pr_state_tax)} fmt={fmt} currency={currency} muted />
                  {parseFloat(payroll.total_other_deductions) > 0 && (
                    <TaxRow label={t("tax.otherDeductions")} value={parseFloat(payroll.total_other_deductions)} fmt={fmt} currency={currency} muted />
                  )}
                  <div
                    style={{
                      borderTop: "2px solid var(--border-color)",
                      paddingTop: 12,
                      marginTop: 4,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                      {t("tax.totalTaxesWithheld")}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "var(--expense, #ef4444)" }}>
                      {fmt(totalPayrollTaxes, currency)}
                    </span>
                  </div>
                  <div style={{ marginTop: 16, padding: "12px", background: "var(--bg-secondary)", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                      <span>{t("tax.payrollRuns")}</span>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{payroll.run_count}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)" }}>
                      <span>{t("tax.employeesPaid")}</span>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{payroll.employee_count}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Quarterly chart */}
          <QuarterlyChart data={data.quarterly} fmt={fmt} currency={currency} t={t} />
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .tax-grid {
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
