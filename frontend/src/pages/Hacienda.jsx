import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { Badge, Button, Card, EmptyState, Select } from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

function SummaryCard({ label, value }) {
  return (
    <Card padding="none" className="p-3.5">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className="text-lg font-bold text-ink">{value}</div>
    </Card>
  );
}

// Form 480.6SP — Services Rendered (Servicios Prestados). Annual informative
// return prep for vendor service payments, split by §1062.03 withholding.
// PR threshold $500. Prep data for the accountant to file via SURI — not a
// filed return.
export default function Hacienda() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const currency = business?.currency || "USD";
  const fmt = makeFmt(i18n.language);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [exportError, setExportError] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-480-6sp", year],
    queryFn: () => api.get(`/reports/480-6sp?year=${year}`).then((r) => r.data),
  });

  const fieldLabel = (f) => t(`vendors.field_${f}`);

  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/reports/480-6sp/export?year=${year}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `480-6sp-${year}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => setExportError(""),
    onError: () => setExportError(t("hacienda.exportBlocked")),
  });

  const payerComplete = data?.payer?.complete;
  const flaggedCount = data?.flagged_count || 0;
  const incompleteCount = data?.incomplete_count || 0;
  const canExport = flaggedCount > 0 && incompleteCount === 0 && payerComplete;

  return (
    <div className="fade-in max-w-[880px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-1.5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">{t("hacienda.title")}</h1>
          <div className="text-md text-muted mt-1">{t("hacienda.subtitle")}</div>
        </div>
        <div className="flex gap-2 items-center">
          <Select
            className="w-[100px]"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            icon="ti-download"
            onClick={() => exportCsv.mutate()}
            disabled={!canExport || exportCsv.isPending}
            title={
              canExport
                ? t("hacienda.exportCsv")
                : t("hacienda.exportDisabledHint")
            }
          >
            {t("hacienda.exportCsv")}
          </Button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="text-xs text-muted bg-canvas rounded-lg px-3.5 py-2.5 mt-3 mb-4">
        <i className="ti ti-info-circle mr-1.5" aria-hidden="true" />
        {t("hacienda.disclaimer")}
      </div>

      {isLoading && (
        <div className="p-10 text-center text-muted">{t("common.loading")}</div>
      )}
      {isError && (
        <div className="p-4 text-center text-expense">{t("common.error")}</div>
      )}

      {data && (
        <>
          {/* Payer completeness banner */}
          {!payerComplete && (
            <div className="flex items-center justify-between gap-2.5 flex-wrap bg-expense-bg text-expense border border-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
              <span>
                <i className="ti ti-alert-triangle mr-1.5" aria-hidden="true" />
                {t("hacienda.payerIncomplete")}
              </span>
              <Link
                to="/settings"
                className="inline-flex items-center px-2.5 py-1.5 text-xs rounded-md bg-canvas text-ink border border-line hover:bg-sunken"
              >
                {t("hacienda.completeProfile")}
              </Link>
            </div>
          )}

          {/* Incomplete-vendor blocker */}
          {incompleteCount > 0 && (
            <div className="bg-expense-bg text-expense border border-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
              <i className="ti ti-alert-triangle mr-1.5" aria-hidden="true" />
              {t("hacienda.incompleteWarning", { count: incompleteCount })}
            </div>
          )}

          {exportError && (
            <div className="bg-expense-bg text-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
              {exportError}
            </div>
          )}

          {/* Reconciliation summary (480.6SP.2 totals) */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mb-5">
            <SummaryCard label={t("hacienda.recipients")} value={flaggedCount} />
            <SummaryCard
              label={t("hacienda.totalPaid")}
              value={fmt(data.totals.gross, currency)}
            />
            <SummaryCard
              label={t("hacienda.totalSubject")}
              value={fmt(data.totals.subject, currency)}
            />
            <SummaryCard
              label={t("hacienda.totalWithheld")}
              value={fmt(data.totals.withheld, currency)}
            />
            <SummaryCard
              label={t("hacienda.totalNotSubject")}
              value={fmt(data.totals.not_subject, currency)}
            />
          </div>

          {/* Per-vendor table */}
          {data.vendors.length === 0 ? (
            <Card>
              <EmptyState
                icon="ti-file-invoice"
                title={t("hacienda.noEligible")}
                message={t("hacienda.noEligibleHint")}
              />
            </Card>
          ) : (
            <Card padding="none" className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[1fr_110px_110px_110px_150px] px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]">
                  <div>{t("hacienda.colVendor")}</div>
                  <div className="text-right">{t("hacienda.colGross")}</div>
                  <div className="text-right">{t("hacienda.colSubject")}</div>
                  <div className="text-right">{t("hacienda.colWithheld")}</div>
                  <div className="text-right">{t("hacienda.colStatus")}</div>
                </div>

                {data.vendors.map((v) => {
                  const incomplete = v.flagged && v.missing_fields?.length > 0;
                  return (
                    <div
                      key={v.id}
                      className="grid grid-cols-[1fr_110px_110px_110px_150px] px-4 py-3 border-b border-line items-center"
                    >
                      <div>
                        <div className="text-md font-medium text-ink">
                          {v.name}
                        </div>
                        {v.waiver_certificate_no && (
                          <div className="text-[11px] text-muted mt-px">
                            {t("hacienda.waiver")}: {v.waiver_certificate_no}
                          </div>
                        )}
                      </div>
                      <div className="text-md text-right text-ink">
                        {fmt(v.gross_paid, currency)}
                      </div>
                      <div className="text-md text-right text-secondary">
                        {fmt(v.subject, currency)}
                      </div>
                      <div className="text-md text-right text-secondary">
                        {fmt(v.withheld, currency)}
                      </div>
                      <div className="text-right">
                        {!v.flagged ? (
                          <span className="text-[11px] text-muted">
                            {t("hacienda.belowThreshold")}
                          </span>
                        ) : incomplete ? (
                          <Badge
                            tone="expense"
                            title={v.missing_fields.map(fieldLabel).join(", ")}
                          >
                            {t("hacienda.statusMissing", {
                              fields: v.missing_fields.map(fieldLabel).join(", "),
                            })}
                          </Badge>
                        ) : (
                          <Badge tone="income">
                            {t("hacienda.statusReady")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
