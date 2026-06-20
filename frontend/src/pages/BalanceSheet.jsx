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

const todayISO = () => new Date().toISOString().slice(0, 10);

function Line({ label, value, fmt, currency, bold, muted, indent }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "7px 0",
        paddingLeft: indent ? 16 : 0,
        fontSize: 14,
        fontWeight: bold ? 700 : 400,
        color: muted ? "var(--text-secondary)" : "var(--text-primary)",
        borderTop: bold ? "1px solid var(--border)" : "none",
      }}
    >
      <span>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {fmt(value, currency)}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export default function BalanceSheet() {
  const { t, i18n } = useTranslation();
  const fmt = makeFmt(i18n.language);
  const { business } = useAuthStore();
  const currency = business?.base_currency || "USD";

  const [asOf, setAsOf] = useState(todayISO());

  const { data, isLoading, isError } = useQuery({
    queryKey: ["balance-sheet", asOf],
    queryFn: () =>
      api.get(`/ledger/balance-sheet?asOf=${asOf}`).then((r) => r.data),
  });

  const resolveName = (a) => (a.name_key ? t(a.name_key) : a.name);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
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
            {t("balanceSheet.title")}
          </h1>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {t("balanceSheet.asOf")}{" "}
            {new Date(asOf).toLocaleDateString(
              i18n.language === "es" ? "es-PR" : "en-US",
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            className="input"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            style={{ width: "auto" }}
          />
          <button className="btn-secondary" onClick={() => window.print()}>
            <span className="ti ti-printer" style={{ marginRight: 6 }} />
            {t("balanceSheet.print")}
          </button>
        </div>
      </div>

      {isLoading && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-secondary)",
          }}
        >
          {t("balanceSheet.loading")}
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
          {t("balanceSheet.error")}
        </div>
      )}

      {data && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 24,
            background: "var(--surface)",
          }}
        >
          {/* Assets */}
          <Section title={t("coa.assets")}>
            {data.assets.accounts.map((a) => (
              <Line
                key={a.id}
                label={resolveName(a)}
                value={a.balance}
                fmt={fmt}
                currency={currency}
                indent
              />
            ))}
            <Line
              label={t("coa.totalAssets")}
              value={data.assets.total}
              fmt={fmt}
              currency={currency}
              bold
            />
          </Section>

          {/* Liabilities */}
          <Section title={t("coa.liabilities")}>
            {data.liabilities.accounts.map((a) => (
              <Line
                key={a.id}
                label={resolveName(a)}
                value={a.balance}
                fmt={fmt}
                currency={currency}
                indent
              />
            ))}
            <Line
              label={t("coa.totalLiabilities")}
              value={data.liabilities.total}
              fmt={fmt}
              currency={currency}
              bold
            />
          </Section>

          {/* Equity */}
          <Section title={t("coa.equity")}>
            {data.equity.accounts.map((a) => (
              <Line
                key={a.id}
                label={resolveName(a)}
                value={a.balance}
                fmt={fmt}
                currency={currency}
                indent
              />
            ))}
            <Line
              label={t("balanceSheet.currentEarnings")}
              value={data.equity.current_period_earnings}
              fmt={fmt}
              currency={currency}
              indent
              muted
            />
            <Line
              label={t("balanceSheet.totalEquity")}
              value={data.equity.total}
              fmt={fmt}
              currency={currency}
              bold
            />
          </Section>

          {/* Total L + E */}
          <Line
            label={t("balanceSheet.totalLiabilitiesEquity")}
            value={data.total_liabilities_and_equity}
            fmt={fmt}
            currency={currency}
            bold
          />

          {/* The proof */}
          <div
            style={{
              marginTop: 20,
              padding: "12px 14px",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: data.balances
                ? "var(--success-bg, #E1F5EE)"
                : "var(--danger-bg, #FCEBEB)",
              color: data.balances
                ? "var(--success-text, #0F6E56)"
                : "var(--danger-text, #A32D2D)",
            }}
          >
            <span
              className={`ti ti-${data.balances ? "circle-check" : "alert-triangle"}`}
              style={{ fontSize: 18 }}
            />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {data.balances
                ? t("balanceSheet.balanced")
                : t("balanceSheet.notBalanced", {
                    amount: fmt(Math.abs(data.difference), currency),
                  })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
