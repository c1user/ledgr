import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import cx from "../lib/cx";
import { Button } from "../components/ui";

// Locale-aware currency formatter (matches the rest of the app).
const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// account_type -> existing i18n label key (these keys already exist in en/es).
const TYPE_LABEL = {
  asset: "coa.assets",
  liability: "coa.liabilities",
  equity: "coa.equity",
  revenue: "coa.revenue",
  expense: "coa.expenses",
};

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

function AccountRow({ node, depth, fmt, currency, resolveName }) {
  return (
    <>
      <div
        className="flex items-center gap-2.5 py-2 px-3 border-b border-line"
        style={{ paddingLeft: 12 + depth * 22 }}
      >
        {node.code && (
          <span className="font-mono text-xs text-secondary min-w-[42px]">
            {node.code}
          </span>
        )}
        <span
          className="w-[9px] h-[9px] rounded-full shrink-0"
          style={{ background: node.color || "var(--text-secondary)" }}
        />
        <span className="text-sm text-ink flex-1">
          {resolveName(node)}
          {!node.is_active && (
            <span className="ml-2 text-xs text-secondary">(inactive)</span>
          )}
        </span>
        <span className="text-sm text-ink tabular-nums">
          {fmt(node.balance, currency)}
        </span>
      </div>
      {node.children?.map((child) => (
        <AccountRow
          key={child.id}
          node={child}
          depth={depth + 1}
          fmt={fmt}
          currency={currency}
          resolveName={resolveName}
        />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  const { t, i18n } = useTranslation();
  const fmt = makeFmt(i18n.language);
  const { business } = useAuthStore();
  const currency = business?.base_currency || "USD";

  const [filter, setFilter] = useState("all");
  const [collapsed, setCollapsed] = useState({});

  const {
    data: groups,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });

  const resolveName = (acc) => (acc.name_key ? t(acc.name_key) : acc.name);

  const toggle = (type) => setCollapsed((c) => ({ ...c, [type]: !c[type] }));

  const visibleGroups = (groups || [])
    .slice()
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.account_type) - TYPE_ORDER.indexOf(b.account_type),
    )
    .filter((g) => filter === "all" || g.account_type === filter);

  return (
    <div className="max-w-[880px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-ink">{t("coa.title")}</h1>
          <div className="text-sm text-secondary">{t("coa.subtitle")}</div>
        </div>
        <Button icon="ti-printer" onClick={() => window.print()}>
          {t("coa.print")}
        </Button>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap my-4">
        {["all", ...TYPE_ORDER].map((type) => {
          const active = filter === type;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={cx(
                "text-md px-3 py-1 rounded-full border border-line cursor-pointer transition-colors",
                active
                  ? "bg-brand text-white font-semibold"
                  : "bg-transparent text-secondary",
              )}
            >
              {type === "all" ? t("coa.allTypes") : t(TYPE_LABEL[type])}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="p-8 text-center text-secondary">{t("coa.loading")}</div>
      )}
      {isError && (
        <div className="p-8 text-center text-danger">{t("coa.error")}</div>
      )}

      {!isLoading && !isError && visibleGroups.length === 0 && (
        <div className="p-8 text-center text-secondary">
          {t("coa.noAccounts")}
        </div>
      )}

      {/* Sections */}
      {visibleGroups.map((group) => {
        const isCollapsed = collapsed[group.account_type];
        return (
          <div
            key={group.account_type}
            className="border border-line rounded-card overflow-hidden mb-3.5 bg-surface"
          >
            <button
              onClick={() => toggle(group.account_type)}
              className={cx(
                "w-full flex items-center gap-2.5 px-3.5 py-3 bg-canvas cursor-pointer",
                !isCollapsed && "border-b border-line",
              )}
            >
              <span
                className={`ti ti-chevron-${isCollapsed ? "right" : "down"} text-secondary`}
                aria-hidden="true"
              />
              <span className="text-md font-bold tracking-[0.5px] text-secondary flex-1 text-left">
                {t(TYPE_LABEL[group.account_type])}
              </span>
              <span className="text-sm font-bold tabular-nums text-ink">
                {fmt(group.total, currency)}
              </span>
            </button>

            {!isCollapsed &&
              group.accounts.map((node) => (
                <AccountRow
                  key={node.id}
                  node={node}
                  depth={0}
                  fmt={fmt}
                  currency={currency}
                  resolveName={resolveName}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
