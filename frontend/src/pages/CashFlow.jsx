import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { resolveCatName } from "../lib/coaCategories";
import cx from "../lib/cx";
import { downloadFile } from "../lib/download";
import PeriodSelector from "../components/PeriodSelector";
import { getDateRange } from "../lib/reportPeriods";
import { Button, Card } from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// ── One flow line ─────────────────────────────────────────────
function FlowRow({ color, name, amount, fmt, currency }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-line">
      <div className="flex items-center gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: color || "#6b6880" }}
        />
        <span className="text-sm text-ink">{name}</span>
      </div>
      <span
        className={cx(
          "text-sm font-medium",
          amount >= 0 ? "text-income" : "text-expense",
        )}
      >
        {fmt(amount, currency)}
      </span>
    </div>
  );
}

// ── Activity section (operating / investing / financing) ─────
function FlowSection({ title, rows, total, totalLabel, fmt, currency, t }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold tracking-[1.5px] text-muted uppercase pb-2 border-b-[1.5px] border-line mb-1">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-md text-muted py-2.5">—</div>
      ) : (
        rows.map((row) => (
          <FlowRow
            key={row.account_id}
            color={row.account_color}
            name={resolveCatName(row.account_name_key, row.account_name, t)}
            amount={parseFloat(row.cash_effect)}
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

// ── Main page ─────────────────────────────────────────────────
export default function CashFlow() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const [period, setPeriod] = useState("thisMonth");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { startDate, endDate } =
    period === "custom"
      ? { startDate: customStart, endDate: customEnd }
      : getDateRange(period);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["cash-flow-report", startDate, endDate],
    queryFn: () =>
      api
        .get(`/reports/cash-flow?startDate=${startDate}&endDate=${endDate}`)
        .then((r) => r.data),
    enabled: !!(startDate && endDate),
  });

  const hasActivity =
    data &&
    (data.operating.rows.length > 0 ||
      data.investing.rows.length > 0 ||
      data.financing.rows.length > 0);

  return (
    <div className="max-w-[760px] mx-auto">
      {/* Page header */}
      <div className="print-hide flex justify-between items-center mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-ink">{t("cashflow.title")}</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            icon="ti-file-type-pdf"
            className="print-hide"
            disabled={!startDate || !endDate}
            onClick={() =>
              downloadFile(
                `/reports/cash-flow/pdf?startDate=${startDate}&endDate=${endDate}&lang=${i18n.language === "es" ? "es" : "en"}`,
                `cash-flow-${startDate}-to-${endDate}.pdf`,
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
            {t("reports.print")}
          </Button>
        </div>
      </div>

      {/* Period selector */}
      <div className="mb-5">
        <PeriodSelector
          period={period}
          setPeriod={setPeriod}
          customStart={customStart}
          setCustomStart={setCustomStart}
          customEnd={customEnd}
          setCustomEnd={setCustomEnd}
          t={t}
        />
      </div>

      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("reports.loading")}
        </div>
      )}
      {isError && (
        <div className="text-expense text-sm py-10 text-center">
          {t("reports.error")}
        </div>
      )}

      {data && !isLoading && (
        <Card padding="none" className="p-6">
          {/* Statement header */}
          <div className="mb-5">
            <div className="text-[17px] font-bold text-ink">
              {t("cashflow.title")}
            </div>
            {startDate && endDate && (
              <div className="text-xs text-muted mt-1">
                {dayjs(startDate).format("MMM D, YYYY")} –{" "}
                {dayjs(endDate).format("MMM D, YYYY")}
              </div>
            )}
          </div>

          {/* Beginning cash */}
          <div className="flex justify-between pb-3 mb-4 border-b-[1.5px] border-line font-semibold text-sm text-ink">
            <span>{t("cashflow.beginningCash")}</span>
            <span>{fmt(data.beginning_cash, currency)}</span>
          </div>

          {!hasActivity ? (
            <div className="text-center text-muted text-sm py-8">
              {t("reports.noData")}
            </div>
          ) : (
            <>
              <FlowSection
                title={t("cashflow.operating")}
                rows={data.operating.rows}
                total={data.operating.total}
                totalLabel={t("cashflow.total_operating")}
                fmt={fmt}
                currency={currency}
                t={t}
              />
              {data.investing.rows.length > 0 && (
                <FlowSection
                  title={t("cashflow.investing")}
                  rows={data.investing.rows}
                  total={data.investing.total}
                  totalLabel={t("cashflow.total_investing")}
                  fmt={fmt}
                  currency={currency}
                  t={t}
                />
              )}
              {data.financing.rows.length > 0 && (
                <FlowSection
                  title={t("cashflow.financing")}
                  rows={data.financing.rows}
                  total={data.financing.total}
                  totalLabel={t("cashflow.total_financing")}
                  fmt={fmt}
                  currency={currency}
                  t={t}
                />
              )}
            </>
          )}

          {/* Net change + ending cash */}
          <div className="border-t-2 border-line pt-3 flex justify-between items-center">
            <span className="text-[15px] font-bold text-ink">
              {t("cashflow.netChange")}
            </span>
            <span
              className={cx(
                "text-lg font-bold",
                data.net_change >= 0 ? "text-income" : "text-expense",
              )}
            >
              {fmt(data.net_change, currency)}
            </span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-[15px] font-bold text-ink">
              {t("cashflow.endingCash")}
            </span>
            <span className="text-lg font-bold text-ink">
              {fmt(data.ending_cash, currency)}
            </span>
          </div>
        </Card>
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
