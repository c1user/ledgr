import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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

const ACCOUNT_TYPE_ICONS = {
  current: "ti-building-bank",
  bank: "ti-building-bank",
  savings: "ti-piggy-bank",
  credit: "ti-credit-card",
  cash: "ti-cash",
  loan: "ti-receipt",
};

const ASSET_TYPES = ["bank", "cash", "current", "savings"];
const LIABILITY_TYPES = ["credit", "loan"];

// ── Section header ────────────────────────────────────────────
function SectionHeader({ title }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1.5,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        padding: "12px 0 8px",
        borderBottom: "1.5px solid var(--border-color)",
        marginBottom: 0,
      }}
    >
      {title}
    </div>
  );
}

// ── Subtotal row ──────────────────────────────────────────────
function SubtotalRow({ label, value, fmt, currency }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "10px 0 6px",
        fontWeight: 700,
        fontSize: 14,
        color: "var(--text-primary)",
        borderTop: "0.5px solid var(--border-color)",
        marginTop: 2,
      }}
    >
      <span>{label}</span>
      <span>{fmt(value, currency)}</span>
    </div>
  );
}

// ── Account row (assets / liabilities) ───────────────────────
function AccountRow({ account, fmt, currency }) {
  const icon = ACCOUNT_TYPE_ICONS[account.type] || "ti-building-bank";
  const balance = parseFloat(account.current_balance);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 0 9px 4px",
        borderBottom: "0.5px solid var(--border-color)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <i
          className={`ti ${icon}`}
          style={{ fontSize: 15, color: "var(--text-muted)", width: 18, textAlign: "center" }}
          aria-hidden="true"
        />
        <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{account.name}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            background: "var(--bg-secondary)",
            borderRadius: 4,
            padding: "1px 6px",
            textTransform: "capitalize",
          }}
        >
          {account.type}
        </span>
      </div>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: balance < 0 ? "var(--expense, #ef4444)" : "var(--text-primary)",
        }}
      >
        {fmt(balance, currency)}
      </span>
    </div>
  );
}

// ── Category row (revenue / expenses) ────────────────────────
function CategoryRow({ category, fmt, currency }) {
  const total = parseFloat(category.total);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 0 9px 4px",
        borderBottom: "0.5px solid var(--border-color)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: category.category_color || "#888888",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 14, color: "var(--text-primary)" }}>
          {category.category_name}
        </span>
      </div>
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
        {fmt(total, currency)}
      </span>
    </div>
  );
}

// ── Equity / net income summary line ─────────────────────────
function SummaryLine({ label, value, fmt, currency, size = 15 }) {
  const positive = value >= 0;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 0",
      }}
    >
      <span style={{ fontSize: size, fontWeight: 700, color: "var(--text-primary)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: size + 2,
          fontWeight: 700,
          color: positive ? "var(--income, #22c55e)" : "var(--expense, #ef4444)",
        }}
      >
        {fmt(Math.abs(value), currency)}
        {!positive && (
          <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, color: "var(--expense, #ef4444)" }}>
            loss
          </span>
        )}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function ChartOfAccounts() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const [year, setYear] = useState(CURRENT_YEAR);

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const { data: plData, isLoading: plLoading } = useQuery({
    queryKey: ["pl-report", `${year}-01-01`, `${year}-12-31`],
    queryFn: () =>
      api
        .get(`/reports/pl?startDate=${year}-01-01&endDate=${year}-12-31`)
        .then((r) => r.data),
  });

  const isLoading = accountsLoading || plLoading;

  // Classify accounts (GET /api/accounts returns a plain array)
  const accounts = accountsData || [];
  const assets = accounts.filter((a) => ASSET_TYPES.includes(a.type) && a.is_active);
  const liabilities = accounts.filter((a) => LIABILITY_TYPES.includes(a.type) && a.is_active);

  const totalAssets = assets.reduce((s, a) => s + parseFloat(a.current_balance), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + parseFloat(a.current_balance), 0);
  const equity = totalAssets - totalLiabilities;

  const incomeCategories = plData?.income_categories || [];
  const expenseCategories = plData?.expense_categories || [];
  const totalIncome = plData?.total_income || 0;
  const totalExpenses = plData?.total_expenses || 0;
  const netIncome = plData?.net_income || 0;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
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
          {t("coa.title")}
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="print-hide" style={{ display: "flex", gap: 6 }}>
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
            {t("coa.print")}
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          {t("coa.loading")}
        </div>
      )}

      {!isLoading && (
        <div className="card" style={{ padding: "24px 28px" }}>
          {/* Print title */}
          <div
            className="print-only"
            style={{ display: "none", textAlign: "center", marginBottom: 20 }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>{business?.name}</div>
            <div style={{ fontSize: 14, color: "#666" }}>{t("coa.title")} — {year}</div>
          </div>

          {/* ── BALANCE SHEET ── */}
          <div style={{ marginBottom: 4 }}>
            {/* Assets */}
            <SectionHeader title={t("coa.assets")} />
            {assets.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 0" }}>
                {t("coa.noAccounts")}
              </div>
            ) : (
              assets.map((a) => (
                <AccountRow key={a.id} account={a} fmt={fmt} currency={currency} />
              ))
            )}
            <SubtotalRow label={t("coa.totalAssets")} value={totalAssets} fmt={fmt} currency={currency} />

            {/* Liabilities */}
            <div style={{ marginTop: 8 }}>
              <SectionHeader title={t("coa.liabilities")} />
            </div>
            {liabilities.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 0" }}>—</div>
            ) : (
              liabilities.map((a) => (
                <AccountRow key={a.id} account={a} fmt={fmt} currency={currency} />
              ))
            )}
            <SubtotalRow label={t("coa.totalLiabilities")} value={totalLiabilities} fmt={fmt} currency={currency} />

            {/* Equity */}
            <div
              style={{
                borderTop: "2px solid var(--border-color)",
                marginTop: 8,
                paddingTop: 4,
              }}
            >
              <SummaryLine
                label={t("coa.netEquity")}
                value={equity}
                fmt={fmt}
                currency={currency}
              />
            </div>
          </div>

          {/* Divider */}
          <div
            style={{
              borderTop: "2px dashed var(--border-color)",
              margin: "16px 0",
            }}
          />

          {/* ── INCOME STATEMENT ── */}
          <div style={{ marginBottom: 4 }}>
            {/* Revenue */}
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 6,
                letterSpacing: 0.5,
              }}
            >
              {t("coa.ytdSuffix", { year })}
            </div>
            <SectionHeader title={t("coa.revenue")} />
            {incomeCategories.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 0" }}>—</div>
            ) : (
              incomeCategories.map((c) => (
                <CategoryRow key={c.category_id} category={c} fmt={fmt} currency={currency} />
              ))
            )}
            <SubtotalRow label={t("coa.totalRevenue")} value={totalIncome} fmt={fmt} currency={currency} />

            {/* Expenses */}
            <div style={{ marginTop: 8 }}>
              <SectionHeader title={t("coa.expenses")} />
            </div>
            {expenseCategories.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 0" }}>—</div>
            ) : (
              expenseCategories.map((c) => (
                <CategoryRow key={c.category_id} category={c} fmt={fmt} currency={currency} />
              ))
            )}
            <SubtotalRow label={t("coa.totalExpenses")} value={totalExpenses} fmt={fmt} currency={currency} />

            {/* Net income */}
            <div style={{ borderTop: "2px solid var(--border-color)", marginTop: 8, paddingTop: 4 }}>
              <SummaryLine
                label={netIncome >= 0 ? t("coa.netIncome") : t("coa.netLoss")}
                value={netIncome}
                fmt={fmt}
                currency={currency}
                size={16}
              />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .print-hide { display: none !important; }
          .print-only { display: block !important; }
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
