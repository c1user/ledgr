import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";

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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          paddingLeft: 12 + depth * 22,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {node.code && (
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "var(--text-secondary)",
              minWidth: 42,
            }}
          >
            {node.code}
          </span>
        )}
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: node.color || "var(--text-secondary)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 14, color: "var(--text-primary)", flex: 1 }}>
          {resolveName(node)}
          {!node.is_active && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              (inactive)
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 14,
            fontVariantNumeric: "tabular-nums",
            color: "var(--text-primary)",
          }}
        >
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
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {t("coa.title")}
          </h1>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {t("coa.subtitle")}
          </div>
        </div>
        <button className="btn-secondary" onClick={() => window.print()}>
          <span className="ti ti-printer" style={{ marginRight: 6 }} />
          {t("coa.print")}
        </button>
      </div>

      {/* Type filter */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}
      >
        {["all", ...TYPE_ORDER].map((type) => {
          const active = filter === type;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              style={{
                fontSize: 13,
                padding: "5px 12px",
                borderRadius: 20,
                border: "1px solid var(--border)",
                cursor: "pointer",
                background: active ? "var(--brand)" : "transparent",
                color: active ? "#fff" : "var(--text-secondary)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {type === "all" ? t("coa.allTypes") : t(TYPE_LABEL[type])}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-secondary)",
          }}
        >
          {t("coa.loading")}
        </div>
      )}
      {isError && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--danger, #d33)",
          }}
        >
          {t("coa.error")}
        </div>
      )}

      {!isLoading && !isError && visibleGroups.length === 0 && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-secondary)",
          }}
        >
          {t("coa.noAccounts")}
        </div>
      )}

      {/* Sections */}
      {visibleGroups.map((group) => {
        const isCollapsed = collapsed[group.account_type];
        return (
          <div
            key={group.account_type}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
              marginBottom: 14,
              background: "var(--surface)",
            }}
          >
            <button
              onClick={() => toggle(group.account_type)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                background: "var(--surface-elevated, var(--surface))",
                border: "none",
                borderBottom: isCollapsed ? "none" : "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <span
                className={`ti ti-chevron-${isCollapsed ? "right" : "down"}`}
                style={{ color: "var(--text-secondary)" }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: "var(--text-secondary)",
                  flex: 1,
                  textAlign: "left",
                }}
              >
                {t(TYPE_LABEL[group.account_type])}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-primary)",
                }}
              >
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
