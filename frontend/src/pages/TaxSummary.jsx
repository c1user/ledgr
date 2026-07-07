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
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import cx from "../lib/cx";
import { downloadFile } from "../lib/download";
import { Button, Card } from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

// Uppercase section heading used across the tax cards.
const SECTION_HEADING =
  "text-[11px] font-bold tracking-[1.5px] text-muted uppercase";

// ── Category row ──────────────────────────────────────────────
function CategoryRow({ color, name, total, fmt, currency }) {
  return (
    <div className="flex items-center justify-between py-[7px] border-b border-line">
      <div className="flex items-center gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: color || "#888888" }}
        />
        <span className="text-sm text-ink">{name}</span>
      </div>
      <span className="text-sm font-medium text-ink">
        {fmt(total, currency)}
      </span>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────
function CategorySection({ title, categories, total, totalLabel, fmt, currency, t }) {
  return (
    <div className="mb-4">
      <div className={cx(SECTION_HEADING, "pb-2 border-b-[1.5px] border-line mb-1")}>
        {title}
      </div>
      {categories.length === 0 ? (
        <div className="text-md text-muted py-2.5">—</div>
      ) : (
        categories.map((cat) => (
          <CategoryRow
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

// ── Payroll tax row ───────────────────────────────────────────
function TaxRow({ label, value, fmt, currency, muted }) {
  return (
    <div className="flex justify-between items-center py-[7px] border-b border-line">
      <span className={cx("text-sm", muted ? "text-muted" : "text-ink")}>
        {label}
      </span>
      <span className={cx("text-sm text-ink", muted ? "font-normal" : "font-medium")}>
        {fmt(value, currency)}
      </span>
    </div>
  );
}

// ── Quarterly chart tooltip ───────────────────────────────────
function QuarterTooltip({ active, payload, label, fmt, currency, t }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-line rounded-lg px-3.5 py-2.5 shadow-card min-w-[140px]">
      <div className="text-xs text-muted mb-1.5 font-semibold">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 text-md">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold text-ink">{fmt(p.value, currency)}</span>
        </div>
      ))}
      {payload.length === 2 && (
        <div className="mt-1.5 pt-1.5 border-t border-line flex justify-between text-xs text-muted">
          <span>{t("tax.net")}</span>
          <span
            className={cx(
              "font-semibold",
              payload[0].value - payload[1].value >= 0
                ? "text-income"
                : "text-expense",
            )}
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
    <Card padding="none" className="p-5">
      <div className="text-md font-semibold text-ink mb-4">
        {t("tax.quarterlyBreakdown")}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} barGap={4} barCategoryGap="35%">
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-color)"
            vertical={false}
          />
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
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="print-hide flex justify-between items-center mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-ink">{t("tax.title")}</h1>
        <div className="flex gap-2 items-center">
          {/* Year selector */}
          <div className="flex gap-1.5">
            {YEARS.map((y) => (
              <Button
                key={y}
                size="sm"
                variant={year === y ? "primary" : "secondary"}
                onClick={() => setYear(y)}
              >
                {y}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            icon="ti-file-type-pdf"
            className="print-hide"
            onClick={() =>
              downloadFile(
                `/reports/tax/pdf?year=${year}&lang=${i18n.language === "es" ? "es" : "en"}`,
                `tax-summary-${year}.pdf`,
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
            {t("tax.print")}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("tax.loading")}
        </div>
      )}

      {isError && (
        <div className="text-expense text-sm py-10 text-center">
          {t("tax.error")}
        </div>
      )}

      {data && !isLoading && (
        <div className="flex flex-col gap-4">
          {/* Top row: income + expenses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {/* Income summary */}
            <Card padding="none" className="px-6 py-5">
              <div className={cx(SECTION_HEADING, "mb-1")}>
                {t("tax.fiscalYear", { year })}
              </div>
              <CategorySection
                title={t("tax.revenue")}
                categories={data.income_categories}
                total={data.total_income}
                totalLabel={t("tax.totalRevenue")}
                fmt={fmt}
                currency={currency}
                t={t}
              />
              <CategorySection
                title={t("tax.expenses")}
                categories={data.expense_categories}
                total={data.total_expenses}
                totalLabel={t("tax.totalExpenses")}
                fmt={fmt}
                currency={currency}
                t={t}
              />
              {/* Net income line */}
              <div className="border-t-2 border-line pt-3 flex justify-between items-center">
                <span className="text-sm font-bold text-ink">
                  {isProfit ? t("tax.netIncome") : t("tax.netLoss")}
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

            {/* Payroll taxes */}
            <Card padding="none" className="px-6 py-5">
              <div
                className={cx(
                  SECTION_HEADING,
                  "pb-2 border-b-[1.5px] border-line mb-1",
                )}
              >
                {t("tax.payrollTaxes")}
              </div>

              {!payroll || parseFloat(payroll.run_count) === 0 ? (
                <div className="text-md text-muted py-5">
                  {t("tax.noPayroll")}
                </div>
              ) : (
                <>
                  <TaxRow
                    label={t("tax.grossPayroll")}
                    value={parseFloat(payroll.total_gross)}
                    fmt={fmt}
                    currency={currency}
                  />
                  <TaxRow
                    label={t("tax.federalIncomeTax")}
                    value={parseFloat(payroll.total_federal_tax)}
                    fmt={fmt}
                    currency={currency}
                    muted
                  />
                  <TaxRow
                    label={t("tax.socialSecurity")}
                    value={parseFloat(payroll.total_social_security)}
                    fmt={fmt}
                    currency={currency}
                    muted
                  />
                  <TaxRow
                    label={t("tax.medicare")}
                    value={parseFloat(payroll.total_medicare)}
                    fmt={fmt}
                    currency={currency}
                    muted
                  />
                  <TaxRow
                    label={t("tax.prStateTax")}
                    value={parseFloat(payroll.total_pr_state_tax)}
                    fmt={fmt}
                    currency={currency}
                    muted
                  />
                  {parseFloat(payroll.total_other_deductions) > 0 && (
                    <TaxRow
                      label={t("tax.otherDeductions")}
                      value={parseFloat(payroll.total_other_deductions)}
                      fmt={fmt}
                      currency={currency}
                      muted
                    />
                  )}
                  <div className="border-t-2 border-line pt-3 mt-1 flex justify-between">
                    <span className="text-sm font-bold text-ink">
                      {t("tax.totalTaxesWithheld")}
                    </span>
                    <span className="text-base font-bold text-expense">
                      {fmt(totalPayrollTaxes, currency)}
                    </span>
                  </div>
                  <div className="mt-4 p-3 bg-canvas rounded-lg">
                    <div className="flex justify-between text-xs text-muted mb-1">
                      <span>{t("tax.payrollRuns")}</span>
                      <span className="font-semibold text-ink">
                        {payroll.run_count}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-muted">
                      <span>{t("tax.employeesPaid")}</span>
                      <span className="font-semibold text-ink">
                        {payroll.employee_count}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Quarterly chart */}
          <QuarterlyChart data={data.quarterly} fmt={fmt} currency={currency} t={t} />
        </div>
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
