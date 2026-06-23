import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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

function SummaryCard({ label, value }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
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
    <div className="fade-in" style={{ maxWidth: 880, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {t("hacienda.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            {t("hacienda.subtitle")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="input"
            style={{ width: 100 }}
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => exportCsv.mutate()}
            disabled={!canExport || exportCsv.isPending}
            title={canExport ? t("hacienda.exportCsv") : t("hacienda.exportDisabledHint")}
          >
            <i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden="true" />
            {t("hacienda.exportCsv")}
          </button>
        </div>
      </div>

      {/* Disclaimer */}
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          background: "var(--bg-secondary)",
          borderRadius: 8,
          padding: "10px 14px",
          margin: "12px 0 16px",
        }}
      >
        <i className="ti ti-info-circle" style={{ marginRight: 6 }} aria-hidden="true" />
        {t("hacienda.disclaimer")}
      </div>

      {isLoading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {t("common.loading")}
        </div>
      )}
      {isError && (
        <div style={{ padding: 16, textAlign: "center", color: "var(--expense)" }}>
          {t("common.error")}
        </div>
      )}

      {data && (
        <>
          {/* Payer completeness banner */}
          {!payerComplete && (
            <div
              style={{
                background: "var(--expense-bg)",
                color: "var(--expense)",
                border: "0.5px solid var(--expense)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span>
                <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} aria-hidden="true" />
                {t("hacienda.payerIncomplete")}
              </span>
              <Link to="/settings" className="btn btn-sm btn-secondary">
                {t("hacienda.completeProfile")}
              </Link>
            </div>
          )}

          {/* Incomplete-vendor blocker */}
          {incompleteCount > 0 && (
            <div
              style={{
                background: "var(--expense-bg)",
                color: "var(--expense)",
                border: "0.5px solid var(--expense)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} aria-hidden="true" />
              {t("hacienda.incompleteWarning", { count: incompleteCount })}
            </div>
          )}

          {exportError && (
            <div
              style={{
                background: "var(--expense-bg)",
                color: "var(--expense)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {exportError}
            </div>
          )}

          {/* Reconciliation summary (480.6SP.2 totals) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <SummaryCard label={t("hacienda.recipients")} value={flaggedCount} />
            <SummaryCard label={t("hacienda.totalPaid")} value={fmt(data.totals.gross, currency)} />
            <SummaryCard label={t("hacienda.totalSubject")} value={fmt(data.totals.subject, currency)} />
            <SummaryCard label={t("hacienda.totalWithheld")} value={fmt(data.totals.withheld, currency)} />
            <SummaryCard label={t("hacienda.totalNotSubject")} value={fmt(data.totals.not_subject, currency)} />
          </div>

          {/* Per-vendor table */}
          {data.vendors.length === 0 ? (
            <div className="card" style={{ padding: 48, textAlign: "center" }}>
              <i className="ti ti-file-invoice" style={{ fontSize: 40, color: "var(--text-muted)" }} aria-hidden="true" />
              <div style={{ fontSize: 15, fontWeight: 600, margin: "12px 0 6px" }}>
                {t("hacienda.noEligible")}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t("hacienda.noEligibleHint")}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 110px 110px 110px 150px",
                  padding: "10px 16px",
                  borderBottom: "0.5px solid var(--border-color)",
                  background: "var(--bg-secondary)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  letterSpacing: 0.5,
                }}
              >
                <div>{t("hacienda.colVendor")}</div>
                <div style={{ textAlign: "right" }}>{t("hacienda.colGross")}</div>
                <div style={{ textAlign: "right" }}>{t("hacienda.colSubject")}</div>
                <div style={{ textAlign: "right" }}>{t("hacienda.colWithheld")}</div>
                <div style={{ textAlign: "right" }}>{t("hacienda.colStatus")}</div>
              </div>

              {data.vendors.map((v) => {
                const incomplete = v.flagged && v.missing_fields?.length > 0;
                return (
                  <div
                    key={v.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 110px 110px 110px 150px",
                      padding: "12px 16px",
                      borderBottom: "0.5px solid var(--border-color)",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                        {v.name}
                      </div>
                      {v.waiver_certificate_no && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          {t("hacienda.waiver")}: {v.waiver_certificate_no}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 13, textAlign: "right", color: "var(--text-primary)" }}>
                      {fmt(v.gross_paid, currency)}
                    </div>
                    <div style={{ fontSize: 13, textAlign: "right", color: "var(--text-secondary)" }}>
                      {fmt(v.subject, currency)}
                    </div>
                    <div style={{ fontSize: 13, textAlign: "right", color: "var(--text-secondary)" }}>
                      {fmt(v.withheld, currency)}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {!v.flagged ? (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {t("hacienda.belowThreshold")}
                        </span>
                      ) : incomplete ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "var(--expense-bg)",
                            color: "var(--expense)",
                          }}
                          title={v.missing_fields.map(fieldLabel).join(", ")}
                        >
                          {t("hacienda.statusMissing", {
                            fields: v.missing_fields.map(fieldLabel).join(", "),
                          })}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "var(--income-bg)",
                            color: "var(--income)",
                            letterSpacing: 0.5,
                          }}
                        >
                          {t("hacienda.statusReady")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
