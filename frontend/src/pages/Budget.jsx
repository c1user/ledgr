import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { coaToCategories, resolveCatName } from "../lib/coaCategories";

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
  const color = over
    ? "var(--error, #e53e3e)"
    : type === "income"
      ? "var(--income, #38a169)"
      : "var(--brand)";
  return (
    <div
      style={{
        height: 6,
        background: "var(--border-color)",
        borderRadius: 3,
        overflow: "hidden",
        flex: 1,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: color,
          borderRadius: 3,
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}

function MonthNav({ month, setMonth }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        className="btn btn-sm btn-secondary"
        onClick={() => setMonth(prevYM(month))}
        aria-label="Previous month"
        style={{ padding: "4px 10px" }}
      >
        ‹
      </button>
      <span style={{ fontSize: 14, fontWeight: 600, minWidth: 140, textAlign: "center" }}>
        {formatYM(month)}
      </span>
      <button
        className="btn btn-sm btn-secondary"
        onClick={() => setMonth(nextYM(month))}
        aria-label="Next month"
        style={{ padding: "4px 10px" }}
      >
        ›
      </button>
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
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6 }}>
          {t("budget.noBudget")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("budget.noBudgetHint")}
        </div>
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 0",
          borderBottom: "0.5px solid var(--border-color)",
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: row.color || "var(--brand)",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
              {resolveCatName(row.name_key, row.name, t)}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 3,
                background: over ? "var(--expense-bg, #fff5f5)" : "var(--income-bg, #f0fff4)",
                color: over ? "var(--error, #e53e3e)" : "var(--income, #38a169)",
              }}
            >
              {over ? t("budget.overBudget") : t("budget.underBudget")} ({pct}%)
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ProgressBar actual={actual} budget={budget} type={row.type} />
            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          { label: t("budget.totalBudgeted"), value: fmt(totalBudget), color: "var(--brand)" },
          { label: t("budget.totalSpent"), value: fmt(totalActual), color: totalActual > totalBudget ? "var(--error, #e53e3e)" : "var(--text-primary)" },
          { label: t("budget.remaining"), value: fmt(totalRemaining), color: totalRemaining < 0 ? "var(--error, #e53e3e)" : "var(--income, #38a169)" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="card"
            style={{ padding: 16 }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
              {kpi.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: kpi.color }}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Overall progress bar */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <span>{fmt(totalActual)} spent</span>
          <span>{fmt(totalBudget)} budgeted</span>
        </div>
        <ProgressBar actual={totalActual} budget={totalBudget} type="expense" />
      </div>

      {/* Expense categories */}
      {expenseRows.length > 0 && (
        <div className="card" style={{ padding: "0 16px", marginBottom: 16 }}>
          <div style={{ padding: "12px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t("budget.expenseSection")}
          </div>
          {expenseRows.map((r) => <CategoryRow key={r.id} row={r} />)}
        </div>
      )}

      {/* Income categories */}
      {incomeRows.length > 0 && (
        <div className="card" style={{ padding: "0 16px" }}>
          <div style={{ padding: "12px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t("budget.incomeSection")}
          </div>
          {incomeRows.map((r) => <CategoryRow key={r.id} row={r} />)}
        </div>
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
  const existingKey = existing.map((r) => r.category_id + r.amount + r.rollover).join("|");
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
    mutationFn: (targetMonth) => api.post("/budgets/copy-previous", { targetMonth }),
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
      setCopyMsg(msg === "No budget found for previous month" ? t("budget.copyEmpty") : t("budget.copyEmpty"));
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
      [catId]: { ...(prev[catId] || { amount: 0, rollover: false }), [field]: value },
    }));
  }

  const expenseCats = categories.filter((c) => c.type === "expense");
  const incomeCats = categories.filter((c) => c.type === "income");

  const CategoryInputRow = ({ cat }) => {
    const line = amounts[cat.id] || { amount: "", rollover: false };
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 12,
          alignItems: "center",
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
              background: cat.color || "var(--brand)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{cat.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }} title={t("budget.rolloverHint")}>
            <input
              type="checkbox"
              checked={!!line.rollover}
              onChange={(e) => setLine(cat.id, "rollover", e.target.checked)}
              style={{ marginRight: 4 }}
            />
            {t("budget.rollover")}
          </label>
        </div>
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 13,
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          >
            $
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={line.amount || ""}
            placeholder="0"
            onChange={(e) => setLine(cat.id, "amount", e.target.value)}
            className="input"
            style={{ width: 110, paddingLeft: 20, textAlign: "right" }}
          />
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Actions row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => copyMutation.mutate(month)}
          disabled={copyMutation.isPending}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className="ti ti-copy" style={{ fontSize: 14 }} />
          {t("budget.copyLastMonth")}
        </button>
        {copyMsg && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{copyMsg}</span>
        )}
      </div>

      {/* Expense section */}
      {expenseCats.length > 0 && (
        <div className="card" style={{ padding: "0 16px", marginBottom: 16 }}>
          <div style={{ padding: "12px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t("budget.expenseSection")}
          </div>
          {expenseCats.map((c) => <CategoryInputRow key={c.id} cat={c} />)}
        </div>
      )}

      {/* Income section */}
      {incomeCats.length > 0 && (
        <div className="card" style={{ padding: "0 16px", marginBottom: 16 }}>
          <div style={{ padding: "12px 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t("budget.incomeSection")}
          </div>
          {incomeCats.map((c) => <CategoryInputRow key={c.id} cat={c} />)}
        </div>
      )}

      {/* Save button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : t("budget.saveBudget")}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "var(--income, #38a169)" }}>
            <i className="ti ti-check" style={{ marginRight: 4 }} />
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
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {t("budget.title")}
        </h1>
        <MonthNav month={month} setMonth={setMonth} />
      </div>

      {/* Tab pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`btn btn-sm ${tab === tb.key ? "btn-primary" : "btn-secondary"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab month={month} />}
      {tab === "setup" && <SetupTab month={month} />}
    </div>
  );
}
