import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { coaToCategories, resolveCatName } from "../lib/coaCategories";
import cx from "../lib/cx";
import { Button, Card, Input } from "../components/ui";

function currentYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function prevYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function ProgressBar({ actual, budget, type }) {
  const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
  const over = actual > budget && budget > 0;
  const barCls = over
    ? "bg-danger"
    : type === "income"
      ? "bg-income"
      : "bg-brand";
  return (
    <div className="h-1.5 bg-line rounded-sm overflow-hidden flex-1">
      <div
        className={cx("h-full rounded-sm transition-all duration-300", barCls)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MonthNav({ month, setMonth }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={() => setMonth(prevYM(month))}
        aria-label="Previous month"
      >
        ‹
      </Button>
      <span className="text-sm font-semibold min-w-[140px] text-center text-ink">
        {formatYM(month)}
      </span>
      <Button
        size="sm"
        onClick={() => setMonth(nextYM(month))}
        aria-label="Next month"
      >
        ›
      </Button>
    </div>
  );
}

// Uppercase section label used by the budget cards.
function SectionLabel({ children }) {
  return (
    <div className="py-3 text-[11px] font-semibold text-muted uppercase tracking-[0.5px]">
      {children}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────
function OverviewTab({ month }) {
  const { t } = useTranslation();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["budget-summary", month],
    queryFn: () => api.get(`/budgets/summary?month=${month}`).then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="p-10 text-center text-muted text-sm">Loading…</div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-14 text-center">
        <div className="text-[32px] mb-3">📊</div>
        <div className="text-[15px] font-medium text-ink mb-1.5">
          {t("budget.noBudget")}
        </div>
        <div className="text-md text-muted">{t("budget.noBudgetHint")}</div>
      </div>
    );
  }

  const totalBudget = rows.reduce((s, r) => s + parseFloat(r.budget_amount), 0);
  const totalActual = rows.reduce((s, r) => s + parseFloat(r.actual_amount), 0);
  const totalRemaining = totalBudget - totalActual;

  const expenseRows = rows.filter((r) => r.type === "expense");
  const incomeRows = rows.filter((r) => r.type === "income");

  const CategoryRow = ({ row }) => {
    const actual = parseFloat(row.actual_amount);
    const budget = parseFloat(row.budget_amount);
    const over = actual > budget;
    const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;

    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-line">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: row.color || "var(--brand)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-md font-medium text-ink">
              {resolveCatName(row.name_key, row.name, t)}
            </span>
            <span
              className={cx(
                "text-[10px] px-1.5 py-px rounded-sm",
                over ? "bg-danger-bg text-danger" : "bg-income-bg text-income",
              )}
            >
              {over ? t("budget.overBudget") : t("budget.underBudget")} ({pct}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ProgressBar actual={actual} budget={budget} type={row.type} />
            <span className="text-xs text-muted whitespace-nowrap">
              {fmt(actual)} / {fmt(budget)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* KPI summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          {
            label: t("budget.totalBudgeted"),
            value: fmt(totalBudget),
            cls: "text-brand",
          },
          {
            label: t("budget.totalSpent"),
            value: fmt(totalActual),
            cls: totalActual > totalBudget ? "text-danger" : "text-ink",
          },
          {
            label: t("budget.remaining"),
            value: fmt(totalRemaining),
            cls: totalRemaining < 0 ? "text-danger" : "text-income",
          },
        ].map((kpi) => (
          <Card key={kpi.label} padding="none" className="p-4">
            <div className="text-[11px] text-muted mb-1">{kpi.label}</div>
            <div className={cx("text-xl font-bold", kpi.cls)}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      {/* Overall progress bar */}
      <Card padding="none" className="p-4 mb-4">
        <div className="flex justify-between mb-2 text-xs text-muted">
          <span>{fmt(totalActual)} spent</span>
          <span>{fmt(totalBudget)} budgeted</span>
        </div>
        <div className="flex">
          <ProgressBar actual={totalActual} budget={totalBudget} type="expense" />
        </div>
      </Card>

      {/* Expense categories */}
      {expenseRows.length > 0 && (
        <Card padding="none" className="px-4 mb-4">
          <SectionLabel>{t("budget.expenseSection")}</SectionLabel>
          {expenseRows.map((r) => (
            <CategoryRow key={r.id} row={r} />
          ))}
        </Card>
      )}

      {/* Income categories */}
      {incomeRows.length > 0 && (
        <Card padding="none" className="px-4">
          <SectionLabel>{t("budget.incomeSection")}</SectionLabel>
          {incomeRows.map((r) => (
            <CategoryRow key={r.id} row={r} />
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Setup Tab ─────────────────────────────────────────────────
function SetupTab({ month }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [amounts, setAmounts] = useState({}); // categoryId -> { amount, rollover }
  const [saved, setSaved] = useState(false);
  const [copyMsg, setCopyMsg] = useState(null);

  const { data: coaGroups = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const categories = coaToCategories(coaGroups, t);

  const { data: existing = [] } = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => api.get(`/budgets?month=${month}`).then((r) => r.data),
    onSuccess: (rows) => {
      const map = {};
      rows.forEach((r) => {
        map[r.category_id] = {
          amount: r.amount,
          rollover: r.rollover,
        };
      });
      setAmounts(map);
    },
  });

  // Re-seed local state when existing data loads or month changes
  const existingKey = existing
    .map((r) => r.category_id + r.amount + r.rollover)
    .join("|");
  const [lastKey, setLastKey] = useState("");
  if (existingKey !== lastKey) {
    setLastKey(existingKey);
    const map = {};
    existing.forEach((r) => {
      map[r.category_id] = { amount: r.amount, rollover: r.rollover };
    });
    setAmounts(map);
  }

  const saveMutation = useMutation({
    mutationFn: ({ period, lines }) => api.put("/budgets", { period, lines }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets", month] });
      queryClient.invalidateQueries({ queryKey: ["budget-summary", month] });
      queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const copyMutation = useMutation({
    mutationFn: (targetMonth) =>
      api.post("/budgets/copy-previous", { targetMonth }),
    onSuccess: (res) => {
      if (res.data.copied === 0) {
        setCopyMsg(t("budget.copyEmpty"));
      } else {
        setCopyMsg(t("budget.copySuccess"));
        queryClient.invalidateQueries({ queryKey: ["budgets", month] });
        queryClient.invalidateQueries({ queryKey: ["budget-summary", month] });
      }
      setTimeout(() => setCopyMsg(null), 3000);
    },
    onError: (err) => {
      const msg = err.response?.data?.error;
      setCopyMsg(
        msg === "No budget found for previous month"
          ? t("budget.copyEmpty")
          : t("budget.copyEmpty"),
      );
      setTimeout(() => setCopyMsg(null), 3000);
    },
  });

  function handleSave() {
    const lines = Object.entries(amounts).map(([categoryId, v]) => ({
      categoryId,
      amount: parseFloat(v.amount) || 0,
      rollover: !!v.rollover,
    }));
    saveMutation.mutate({ period: month, lines });
  }

  function setLine(catId, field, value) {
    setSaved(false);
    setAmounts((prev) => ({
      ...prev,
      [catId]: {
        ...(prev[catId] || { amount: 0, rollover: false }),
        [field]: value,
      },
    }));
  }

  const expenseCats = categories.filter((c) => c.type === "expense");
  const incomeCats = categories.filter((c) => c.type === "income");

  const CategoryInputRow = ({ cat }) => {
    const line = amounts[cat.id] || { amount: "", rollover: false };
    return (
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-2 border-b border-line">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: cat.color || "var(--brand)" }}
          />
          <span className="text-md text-ink">{cat.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <label
            className="text-[11px] text-muted whitespace-nowrap"
            title={t("budget.rolloverHint")}
          >
            <input
              type="checkbox"
              checked={!!line.rollover}
              onChange={(e) => setLine(cat.id, "rollover", e.target.checked)}
              className="mr-1"
            />
            {t("budget.rollover")}
          </label>
        </div>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-md text-muted pointer-events-none">
            $
          </span>
          <Input
            type="number"
            min="0"
            step="1"
            value={line.amount || ""}
            placeholder="0"
            onChange={(e) => setLine(cat.id, "amount", e.target.value)}
            className="w-[110px] pl-5 text-right"
          />
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Actions row */}
      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <Button
          size="sm"
          icon="ti-copy"
          onClick={() => copyMutation.mutate(month)}
          disabled={copyMutation.isPending}
        >
          {t("budget.copyLastMonth")}
        </Button>
        {copyMsg && <span className="text-xs text-muted">{copyMsg}</span>}
      </div>

      {/* Expense section */}
      {expenseCats.length > 0 && (
        <Card padding="none" className="px-4 mb-4">
          <SectionLabel>{t("budget.expenseSection")}</SectionLabel>
          {expenseCats.map((c) => (
            <CategoryInputRow key={c.id} cat={c} />
          ))}
        </Card>
      )}

      {/* Income section */}
      {incomeCats.length > 0 && (
        <Card padding="none" className="px-4 mb-4">
          <SectionLabel>{t("budget.incomeSection")}</SectionLabel>
          {incomeCats.map((c) => (
            <CategoryInputRow key={c.id} cat={c} />
          ))}
        </Card>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3 mt-2">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : t("budget.saveBudget")}
        </Button>
        {saved && (
          <span className="text-xs text-income">
            <i className="ti ti-check mr-1" aria-hidden="true" />
            {t("budget.saveSuccess")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Budget Page ──────────────────────────────────────────
export default function Budget() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState(currentYM());

  const tabs = [
    { key: "overview", label: t("budget.overview") },
    { key: "setup", label: t("budget.setup") },
  ];

  return (
    <div className="max-w-[760px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-ink">{t("budget.title")}</h1>
        <MonthNav month={month} setMonth={setMonth} />
      </div>

      {/* Tab pills */}
      <div className="flex gap-1.5 mb-5">
        {tabs.map((tb) => (
          <Button
            key={tb.key}
            size="sm"
            variant={tab === tb.key ? "primary" : "secondary"}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
          </Button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab month={month} />}
      {tab === "setup" && <SetupTab month={month} />}
    </div>
  );
}
