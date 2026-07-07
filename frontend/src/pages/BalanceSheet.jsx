import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import cx from "../lib/cx";
import { Button, Card, Input } from "../components/ui";

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
      className={cx(
        "flex justify-between py-[7px] text-sm",
        bold ? "font-bold border-t border-line" : "font-normal",
        muted ? "text-secondary" : "text-ink",
        indent && "pl-4",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{fmt(value, currency)}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-[22px]">
      <div className="text-md font-bold tracking-[0.5px] text-secondary uppercase mb-1">
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
    <div className="max-w-[720px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[22px] font-bold text-ink">
            {t("balanceSheet.title")}
          </h1>
          <div className="text-sm text-secondary">
            {t("balanceSheet.asOf")}{" "}
            {new Date(asOf).toLocaleDateString(
              i18n.language === "es" ? "es-PR" : "en-US",
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="w-auto"
          />
          <Button icon="ti-printer" onClick={() => window.print()}>
            {t("balanceSheet.print")}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="p-8 text-center text-secondary">
          {t("balanceSheet.loading")}
        </div>
      )}
      {isError && (
        <div className="p-8 text-center text-danger">
          {t("balanceSheet.error")}
        </div>
      )}

      {data && (
        <Card padding="none" className="p-6">
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
            className={cx(
              "flex items-center gap-2.5 mt-5 px-3.5 py-3 rounded-lg",
              data.balances
                ? "bg-income-bg text-income"
                : "bg-danger-bg text-danger",
            )}
          >
            <span
              className={`ti ti-${data.balances ? "circle-check" : "alert-triangle"} text-lg`}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold">
              {data.balances
                ? t("balanceSheet.balanced")
                : t("balanceSheet.notBalanced", {
                    amount: fmt(Math.abs(data.difference), currency),
                  })}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
