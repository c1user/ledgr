import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import useInventoryStore from "../store/inventoryStore";
import useEntitlements from "../lib/useEntitlements";
import dayjs from "dayjs";
import cx from "../lib/cx";
import { Button, Card, EmptyState } from "../components/ui";

// Locale-aware currency formatter. Falls back to en-US number grouping;
// es-PR uses the same currency symbols so $ stays correct for PR.
const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// ── KPI Card ─────────────────────────────────────────────────
const KPI_TONES = {
  income: { text: "text-income", box: "bg-income-bg" },
  expense: { text: "text-expense", box: "bg-expense-bg" },
  payroll: { text: "text-payroll", box: "bg-payroll-bg" },
};

function KpiCard({ label, value, tone, icon }) {
  const t = KPI_TONES[tone];
  return (
    <Card padding="none" className="px-5 py-4">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[11px] text-muted tracking-[1px] uppercase mb-2">
            {label}
          </div>
          <div className={cx("text-2xl font-semibold", t.text)}>{value}</div>
        </div>
        <div
          className={cx(
            "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
            t.box,
          )}
        >
          <i className={cx("ti", icon, "text-lg", t.text)} aria-hidden="true" />
        </div>
      </div>
    </Card>
  );
}

// ── Custom Tooltip for donut chart ────────────────────────────
function CustomTooltip({ active, payload, currency, fmt, t }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-surface border border-line rounded-lg px-3.5 py-2.5 shadow-card">
      <div className="flex items-center gap-1.5 mb-1">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: d.color }}
        />
        <span className="text-md font-medium text-ink">{d.name}</span>
      </div>
      <div className="text-md font-semibold text-expense">
        {fmt(d.value, currency)}
      </div>
      <div className="text-[11px] text-muted">
        {t("dashboard.pctOfExpenses", { pct: d.pct })}
      </div>
    </div>
  );
}

// The category of a transaction now lives in its ledger-derived `splits`
// array (each line carries a `name_key` that needs i18n resolution, like the
// Transactions page) — there is no flat `category_name` field anymore.
function txCategoryName(tx, t) {
  const s = tx.splits?.[0];
  if (!s) return null;
  return s.name_key ? t(s.name_key) : s.name;
}

// ── Spending by category chart ────────────────────────────────
function SpendingChart({ transactions, currency, navigate, fmt, t }) {
  const [activeIndex, setActiveIndex] = useState(null);

  // Aggregate spending by category. Categories come from the ledger-derived
  // splits (name_key → i18n), covering both single-category and split txs.
  const categoryMap = {};
  for (const tx of transactions || []) {
    if (tx.type !== "expense") continue;
    const splits = tx.splits?.length ? tx.splits : null;
    if (splits) {
      for (const split of splits) {
        const key =
          (split.name_key ? t(split.name_key) : split.name) ||
          t("dashboard.uncategorized");
        const color = split.color || "#6b6880";
        if (!categoryMap[key])
          categoryMap[key] = { name: key, value: 0, color };
        categoryMap[key].value += parseFloat(split.amount || 0);
      }
    } else {
      // No ledger lines (shouldn't normally happen) — keep the chart total honest.
      const key = t("dashboard.uncategorized");
      if (!categoryMap[key])
        categoryMap[key] = { name: key, value: 0, color: "#6b6880" };
      categoryMap[key].value += parseFloat(tx.total_amount || 0);
    }
  }

  const total = Object.values(categoryMap).reduce((s, c) => s + c.value, 0);
  const data = Object.values(categoryMap)
    .map((c) => ({
      ...c,
      pct: total > 0 ? ((c.value / total) * 100).toFixed(1) : "0.0",
    }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <EmptyState
        icon="ti-chart-donut"
        message={t("dashboard.noExpenseData")}
        action={
          <Button variant="primary" onClick={() => navigate("/transactions")}>
            {t("dashboard.addTransaction")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="pb-2">
      {/* Donut chart */}
      <div className="relative h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={2}
              dataKey="value"
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                  opacity={
                    activeIndex === null || activeIndex === index ? 1 : 0.5
                  }
                  stroke="none"
                />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip currency={currency} fmt={fmt} t={t} />}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
          <div className="text-[11px] text-muted mb-0.5">
            {t("dashboard.total")}
          </div>
          <div className="text-base font-bold text-expense">
            {fmt(total, currency)}
          </div>
        </div>
      </div>

      {/* Category ranked list */}
      <div className="px-[18px]">
        {data.map((cat, i) => (
          <div
            key={cat.name}
            className={cx(
              "flex items-center gap-2.5 py-2",
              i < data.length - 1 && "border-b border-line",
            )}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {/* Color dot */}
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: cat.color }}
            />

            {/* Category name + bar */}
            <div className="flex-1 min-w-0">
              <div className="flex justify-between mb-1">
                <span className="text-xs font-medium text-ink truncate">
                  {cat.name}
                </span>
                <span className="text-xs text-muted shrink-0 ml-2">
                  {cat.pct}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1 bg-line rounded-sm">
                <div
                  className="h-full rounded-sm transition-all duration-300"
                  style={{ width: `${cat.pct}%`, background: cat.color }}
                />
              </div>
            </div>

            {/* Amount */}
            <div className="text-md font-semibold text-expense shrink-0 min-w-[70px] text-right">
              {fmt(cat.value, currency)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Card section header, shared by the dashboard panels.
function PanelHeader({ title, sub, action }) {
  return (
    <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-line">
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

// ── Needs-attention chips ────────────────────────────────────
const CHIP_TONES = {
  danger: "bg-danger-bg text-danger border-danger",
  expense: "bg-expense-bg text-expense border-expense",
  payroll: "bg-payroll-bg text-payroll border-payroll",
  income: "bg-income-bg text-income border-income",
};

function AttentionChips({ items, navigate }) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {items.map(({ key, icon, tone, label, to }) => (
        <button
          key={key}
          onClick={() => navigate(to)}
          className={cx(
            "flex items-center gap-2 px-3 py-2 rounded-lg border text-md font-medium cursor-pointer hover:opacity-80 transition-opacity",
            CHIP_TONES[tone],
          )}
        >
          <i className={cx("ti", icon)} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Getting-started checklist (empty businesses) ─────────────
function GettingStarted({ steps, navigate, t }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card padding="none" className="mb-6 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-[18px] py-3 border-b border-line">
        <div className="text-sm font-semibold text-ink">
          <i className="ti ti-flag text-brand mr-1.5" aria-hidden="true" />
          {t("dashboard.gettingStarted")}
        </div>
        <div className="text-xs text-muted shrink-0">
          {t("dashboard.checklistProgress", { done, total: steps.length })}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 px-2 py-1.5">
        {steps.map((step) => (
          <button
            key={step.key}
            onClick={() => navigate(step.to)}
            disabled={step.done}
            className={cx(
              "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-md text-left",
              step.done
                ? "text-muted cursor-default"
                : "text-ink hover:bg-canvas cursor-pointer",
            )}
          >
            <i
              className={cx(
                "ti",
                step.done ? "ti-circle-check text-income" : "ti-circle text-muted",
              )}
              aria-hidden="true"
            />
            <span className={cx("flex-1", step.done && "line-through")}>
              {t(step.label)}
            </span>
            {!step.done && (
              <i className="ti ti-chevron-right text-muted text-xs" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const navigate = useNavigate();
  const currency = business?.currency || "USD";
  const fmt = makeFmt(i18n.language);

  const now = dayjs();
  const startOfMonth = now.startOf("month").format("YYYY-MM-DD");
  const endOfMonth = now.endOf("month").format("YYYY-MM-DD");

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["summary", startOfMonth, endOfMonth],
    queryFn: () =>
      api
        .get(
          `/transactions/summary/totals?startDate=${startOfMonth}&endDate=${endOfMonth}`,
        )
        .then((r) => r.data),
  });

  // Current-month transactions — feeds the month-labeled spending chart.
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ["transactions", "month", startOfMonth],
    queryFn: () =>
      api
        .get(
          `/transactions?limit=100&startDate=${startOfMonth}&endDate=${endOfMonth}`,
        )
        .then((r) => r.data),
  });

  // Latest transactions regardless of month — the "Recent transactions"
  // panel must not go blank at the start of a new month.
  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ["transactions", "recent"],
    queryFn: () => api.get(`/transactions?limit=8`).then((r) => r.data),
  });

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ["balances"],
    queryFn: () => api.get("/accounts/summary/balances").then((r) => r.data),
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const currentMonth = `${now.year()}-${String(now.month() + 1).padStart(2, "0")}`;
  const { data: budgetSummary = [] } = useQuery({
    queryKey: ["budget-summary", currentMonth],
    queryFn: () =>
      api.get(`/budgets/summary?month=${currentMonth}`).then((r) => r.data),
  });

  // ── Home-base data: action items + getting-started checklist ──
  const { hasFeature } = useEntitlements();
  const reorderCount = useInventoryStore((s) => s.reorderCount);

  const { data: invoicesList = [] } = useQuery({
    queryKey: ["invoices", "all", ""],
    queryFn: () => api.get("/invoices").then((r) => r.data),
    enabled: hasFeature("invoicing"),
  });
  const { data: clientsList = [] } = useQuery({
    queryKey: ["clients", "", "active"],
    queryFn: () => api.get("/clients?active=true").then((r) => r.data),
    enabled: hasFeature("invoicing"),
  });
  const { data: recurringList = [] } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get("/recurring").then((r) => r.data),
    enabled: hasFeature("recurring"),
  });
  const { data: receiptsList = [] } = useQuery({
    queryKey: ["receipts", "all"],
    queryFn: () => api.get("/receipts").then((r) => r.data),
  });

  const overdueInvoices = invoicesList.filter(
    (i) => i.is_overdue || i.status === "overdue",
  );
  const overdueTotal = overdueInvoices.reduce(
    (s, i) => s + Number(i.total || 0),
    0,
  );
  const weekAhead = now.add(7, "day");
  const recurringDue = recurringList.filter(
    (r) => r.is_active && r.next_due && !dayjs(r.next_due).isAfter(weekAhead),
  );
  const pendingReceipts = receiptsList.filter((r) => r.status === "pending");

  const attention = [
    overdueInvoices.length > 0 && {
      key: "overdue",
      icon: "ti-alert-triangle",
      tone: "danger",
      label: t("dashboard.overdueInvoices", {
        count: overdueInvoices.length,
        total: fmt(overdueTotal, currency),
      }),
      to: "/sales/invoices",
    },
    recurringDue.length > 0 && {
      key: "recurring",
      icon: "ti-repeat",
      tone: "payroll",
      label: t("dashboard.recurringDue", { count: recurringDue.length }),
      to: "/transactions/recurring",
    },
    pendingReceipts.length > 0 && {
      key: "receipts",
      icon: "ti-receipt",
      tone: "expense",
      label: t("dashboard.receiptsToReview", { count: pendingReceipts.length }),
      to: "/receipts",
    },
    hasFeature("inventory") &&
      reorderCount > 0 && {
        key: "stock",
        icon: "ti-box",
        tone: "expense",
        label: t("dashboard.lowStock", { count: reorderCount }),
        to: "/inventory",
      },
  ].filter(Boolean);

  const checklistSteps = [
    {
      key: "account",
      done: (accounts?.length || 0) > 0,
      label: "dashboard.stepAccount",
      to: "/accounts",
    },
    {
      key: "transaction",
      done: (recentData?.transactions?.length || 0) > 0,
      label: "dashboard.stepTransaction",
      to: "/transactions",
    },
    ...(hasFeature("invoicing")
      ? [
          {
            key: "client",
            done: clientsList.length > 0,
            label: "dashboard.stepClient",
            to: "/sales/clients",
          },
          {
            key: "invoice",
            done: invoicesList.length > 0,
            label: "dashboard.stepInvoice",
            to: "/sales/invoices",
          },
        ]
      : []),
    {
      key: "receipt",
      done: receiptsList.length > 0,
      label: "dashboard.stepReceipt",
      to: "/receipts",
    },
  ];
  const showChecklist = checklistSteps.some((s) => !s.done);

  const income = parseFloat(summary?.total_income || 0);
  const expenses = parseFloat(summary?.total_expenses || 0);
  const net = income - expenses;

  // Localized "Month YYYY" — dayjs locale is set globally by setAppLanguage
  const monthLabel = now.format("MMMM YYYY");

  const loadingText = (
    <div className="p-6 text-center text-muted text-md">
      {t("common.loading")}
    </div>
  );

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink mb-1">
          {t("dashboard.title")}
        </h1>
        <div className="text-md text-muted">
          {t("dashboard.overview", { month: monthLabel })}
        </div>
      </div>

      {/* Getting-started checklist — only while steps remain */}
      {showChecklist && (
        <GettingStarted steps={checklistSteps} navigate={navigate} t={t} />
      )}

      {/* Action items */}
      {attention.length > 0 && (
        <AttentionChips items={attention} navigate={navigate} />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 mb-6">
        <KpiCard
          label={t("dashboard.revenue")}
          value={summaryLoading ? "..." : fmt(income, currency)}
          tone="income"
          icon="ti-trending-up"
        />
        <KpiCard
          label={t("common.expenses")}
          value={summaryLoading ? "..." : fmt(expenses, currency)}
          tone="expense"
          icon="ti-trending-down"
        />
        <KpiCard
          label={t("common.netProfit")}
          value={summaryLoading ? "..." : fmt(net, currency)}
          tone={net >= 0 ? "income" : "expense"}
          icon="ti-report-money"
        />
        <KpiCard
          label={t("dashboard.totalBalance")}
          value={
            balancesLoading ? "..." : fmt(balances?.total_balance, currency)
          }
          tone="payroll"
          icon="ti-building-bank"
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4">
        {/* Left — spending chart + recent transactions */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Spending by category */}
          <Card padding="none" className="overflow-hidden">
            <PanelHeader
              title={t("dashboard.spendingByCategory")}
              sub={t("dashboard.monthExpenses", { month: monthLabel })}
            />
            {txLoading ? (
              loadingText
            ) : (
              <SpendingChart
                transactions={txData?.transactions}
                currency={currency}
                navigate={navigate}
                fmt={fmt}
                t={t}
              />
            )}
          </Card>

          {/* Recent transactions */}
          <Card padding="none" className="overflow-hidden">
            <PanelHeader
              title={t("dashboard.recentTransactions")}
              action={
                <Button size="sm" onClick={() => navigate("/transactions")}>
                  {t("dashboard.viewAll")}
                </Button>
              }
            />
            {recentLoading ? (
              loadingText
            ) : recentData?.transactions?.length === 0 ? (
              <EmptyState
                icon="ti-receipt-off"
                message={t("dashboard.noTransactions")}
                action={
                  <Button
                    variant="primary"
                    onClick={() => navigate("/transactions")}
                  >
                    {t("dashboard.addFirstTransaction")}
                  </Button>
                }
              />
            ) : (
              <div>
                {recentData?.transactions?.slice(0, 8).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-3 px-[18px] py-[var(--row-y)] border-b border-line cursor-pointer transition-colors hover:bg-canvas"
                    onClick={() => navigate("/transactions")}
                  >
                    <div
                      className={cx(
                        "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
                        tx.type === "income" ? "bg-income-bg" : "bg-expense-bg",
                      )}
                    >
                      <i
                        className={cx(
                          "ti text-base",
                          tx.type === "income"
                            ? "ti-arrow-down-left text-income"
                            : "ti-arrow-up-right text-expense",
                        )}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-md font-medium text-ink truncate">
                        {tx.merchant || t("dashboard.noMerchant")}
                        {tx.is_split && (
                          <span className="text-[10px] bg-payroll-bg text-payroll px-1.5 rounded-sm ml-1.5">
                            {t("dashboard.split")}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {dayjs(tx.date).format("MMM D, YYYY")} ·{" "}
                        {tx.account_name_key
                          ? t(tx.account_name_key)
                          : tx.account_name}
                        {txCategoryName(tx, t) && ` · ${txCategoryName(tx, t)}`}
                      </div>
                    </div>
                    <div
                      className={cx(
                        "text-sm font-semibold shrink-0",
                        tx.type === "income" ? "text-income" : "text-expense",
                      )}
                    >
                      {tx.type === "income" ? "+" : "-"}
                      {fmt(tx.total_amount, currency)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Account balances */}
          <Card padding="none" className="overflow-hidden">
            <PanelHeader title={t("dashboard.accounts")} />
            {balancesLoading ? (
              loadingText
            ) : accounts?.length === 0 ? (
              <div className="p-4 text-muted text-md">
                {t("dashboard.noAccounts")}
              </div>
            ) : (
              <div>
                {accounts?.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between px-[18px] py-2.5 border-b border-line"
                  >
                    <div>
                      <div className="text-md text-ink">{acc.name}</div>
                      <div className="text-[11px] text-muted capitalize">
                        {t(`accountTypes.${acc.type}`, acc.type)}
                      </div>
                    </div>
                    <div
                      className={cx(
                        "text-md font-semibold",
                        parseFloat(acc.current_balance) >= 0
                          ? "text-income"
                          : "text-expense",
                      )}
                    >
                      {fmt(acc.current_balance, currency)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Budget overview widget */}
          {budgetSummary.length > 0 &&
            (() => {
              const totalBudget = budgetSummary.reduce(
                (s, r) => s + parseFloat(r.budget_amount),
                0,
              );
              const totalActual = budgetSummary.reduce(
                (s, r) => s + parseFloat(r.actual_amount),
                0,
              );
              const pct =
                totalBudget > 0
                  ? Math.min((totalActual / totalBudget) * 100, 100)
                  : 0;
              const over = totalActual > totalBudget;
              return (
                <Card padding="none" className="overflow-hidden">
                  <PanelHeader
                    title={t("budget.title")}
                    action={
                      <span
                        onClick={() => navigate("/budget")}
                        className="text-[11px] text-brand cursor-pointer"
                      >
                        {t("budget.viewAll")} →
                      </span>
                    }
                  />
                  <div className="px-[18px] py-3">
                    {/* Total bar */}
                    <div className="flex justify-between text-[11px] text-muted mb-1.5">
                      <span>
                        {fmt(totalActual, currency)}{" "}
                        {t("budget.totalSpent").toLowerCase()}
                      </span>
                      <span>{fmt(totalBudget, currency)}</span>
                    </div>
                    <div className="h-1.5 bg-line rounded-sm mb-3 overflow-hidden">
                      <div
                        className={cx(
                          "h-full rounded-sm transition-all duration-300",
                          over ? "bg-danger" : "bg-brand",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {/* Top categories */}
                    {budgetSummary.slice(0, 4).map((r) => {
                      const a = parseFloat(r.actual_amount);
                      const b = parseFloat(r.budget_amount);
                      const p = b > 0 ? Math.min((a / b) * 100, 100) : 0;
                      const o = a > b;
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 mb-1.5"
                        >
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: r.color || "var(--brand)" }}
                          />
                          <span className="text-xs text-secondary min-w-[80px] truncate">
                            {r.name}
                          </span>
                          <div className="flex-1 h-1 bg-line rounded-sm overflow-hidden">
                            <div
                              className={cx(
                                "h-full rounded-sm",
                                o ? "bg-danger" : "bg-brand",
                              )}
                              style={{ width: `${p}%` }}
                            />
                          </div>
                          <span
                            className={cx(
                              "text-[11px] whitespace-nowrap",
                              o ? "text-danger" : "text-muted",
                            )}
                          >
                            {Math.round(p)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })()}

          {/* AI prompt bar */}
          <Card
            padding="none"
            onClick={() => navigate("/ai")}
            className="px-4 py-3.5 cursor-pointer transition-all hover:border-brand"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-light shrink-0">
                <i
                  className="ti ti-sparkles text-base text-brand"
                  aria-hidden="true"
                />
              </div>
              <div>
                <div className="text-md font-medium text-ink">
                  {t("dashboard.askAi")}
                </div>
                <div className="text-[11px] text-muted mt-px">
                  {t("dashboard.askAiExample")}
                </div>
              </div>
              <i
                className="ti ti-arrow-right ml-auto text-base text-muted"
                aria-hidden="true"
              />
            </div>
          </Card>

          {/* Quick actions */}
          <Card padding="none" className="px-[18px] py-3.5">
            <div className="text-sm font-medium text-ink mb-3">
              {t("dashboard.quickActions")}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                icon="ti-plus"
                onClick={() => navigate("/transactions")}
                className="justify-start"
              >
                {t("dashboard.addTransaction")}
              </Button>
              <Button
                icon="ti-camera"
                onClick={() => navigate("/receipts")}
                className="justify-start"
              >
                {t("dashboard.scanReceipt")}
              </Button>
              <Button
                icon="ti-report-money"
                onClick={() => navigate("/payroll")}
                className="justify-start"
              >
                {t("dashboard.runPayroll")}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
