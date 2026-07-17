import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast } from "../store/feedbackStore";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
} from "../components/ui";

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

  // SURI bulk-filing text file (Pub 25-03) — needs the control-number
  // range start that Hacienda assigns in SURI.
  const [showSuri, setShowSuri] = useState(false);
  const [controlStart, setControlStart] = useState("");
  const exportSuri = useMutation({
    mutationFn: async () => {
      const res = await api.get(
        `/reports/480-6sp/suri?year=${year}&controlStart=${controlStart}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `F4806SPY${String(year).slice(-2)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      setExportError("");
      setShowSuri(false);
    },
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
          <Button
            icon="ti-file-export"
            onClick={() => setShowSuri(true)}
            disabled={!canExport}
            title={
              canExport
                ? t("hacienda.suriExport")
                : t("hacienda.exportDisabledHint")
            }
          >
            {t("hacienda.suriExport")}
          </Button>
        </div>
      </div>

      {/* SURI file modal — asks for the assigned control-number range */}
      {showSuri && (
        <Modal
          open
          size="sm"
          title={t("hacienda.suriExport")}
          onClose={() => setShowSuri(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{1,9}$/.test(controlStart)) exportSuri.mutate();
            }}
            className="flex flex-col gap-3.5"
          >
            <div className="text-md text-secondary">
              {t("hacienda.suriIntro")}
            </div>
            <Field label={t("hacienda.suriControlStart")} className="mb-0">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="500001"
                value={controlStart}
                onChange={(e) =>
                  setControlStart(e.target.value.replace(/\D/g, "").slice(0, 9))
                }
                autoFocus
              />
            </Field>
            <div className="text-xs text-muted">{t("hacienda.suriNote")}</div>
            <div className="flex gap-2.5 justify-end mt-1">
              <Button onClick={() => setShowSuri(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!/^\d{1,9}$/.test(controlStart) || exportSuri.isPending}
              >
                {t("hacienda.suriDownload")}
              </Button>
            </div>
          </form>
        </Modal>
      )}

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

      {/* §1062.03 withholding remittance — quarterly view + record payment */}
      <WithholdingSection year={year} fmt={fmt} currency={currency} t={t} />
    </div>
  );
}

// ── Withholding remittance section ────────────────────────────
// Quarterly accrued vs remitted on the services-withholding liability —
// the numbers Form 480.6SP-1 asks for — plus a ledger-posted remittance.
function WithholdingSection({ year, fmt, currency, t }) {
  const qc = useQueryClient();
  const [showRemit, setShowRemit] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    fundingCoaId: "",
  });
  const [error, setError] = useState("");

  const { data } = useQuery({
    queryKey: ["withholding-summary", year],
    queryFn: () =>
      api
        .get(`/reports/withholding-summary?year=${year}`)
        .then((r) => r.data),
  });

  const { data: coaGroups } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const assetAccounts = useMemo(() => {
    if (!coaGroups) return [];
    const out = [];
    const walk = (acc) => {
      out.push({
        id: acc.id,
        name: acc.name_key ? t(acc.name_key) : acc.name,
        code: acc.code,
      });
      acc.children?.forEach(walk);
    };
    for (const g of coaGroups) {
      if (g.account_type === "asset") g.accounts.forEach(walk);
    }
    return out;
  }, [coaGroups, t]);

  const remitMutation = useMutation({
    mutationFn: () =>
      api
        .post("/reports/withholding-remit", {
          date: form.date,
          amount: parseFloat(form.amount),
          fundingCoaId: form.fundingCoaId,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["withholding-summary"] });
      qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      setShowRemit(false);
      toast.success(t("hacienda.whRemitted"));
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("hacienda.whRemitFailed")),
  });

  if (!data) return null;
  const due = data.balance_due;

  return (
    <Card padding="none" className="p-5 mt-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-md font-semibold text-ink">
            {t("hacienda.whTitle")}
          </div>
          <div className="text-xs text-muted">{t("hacienda.whSubtitle")}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] text-muted uppercase tracking-[0.5px]">
              {t("hacienda.whBalanceDue")}
            </div>
            <div
              className={cx(
                "text-lg font-bold",
                due > 0 ? "text-expense" : "text-income",
              )}
            >
              {fmt(due, currency)}
            </div>
          </div>
          <Button
            variant="primary"
            icon="ti-building-bank"
            disabled={due <= 0}
            onClick={() => {
              setForm((f) => ({ ...f, amount: String(due) }));
              setError("");
              setShowRemit(true);
            }}
          >
            {t("hacienda.whRecord")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] gap-x-6 text-xs text-muted font-semibold tracking-[0.5px] uppercase pb-1.5 border-b-[1.5px] border-line mb-1">
        <span>{t("hacienda.whQuarter")}</span>
        <span className="text-right">{t("hacienda.whWithheld")}</span>
        <span className="text-right">{t("hacienda.whRemittedCol")}</span>
      </div>
      {data.quarters.map((q) => (
        <div
          key={q.quarter}
          className="grid grid-cols-[auto_1fr_1fr] gap-x-6 items-center py-2 border-b border-line"
        >
          <span className="text-md text-ink">
            Q{q.quarter} {year}
          </span>
          <span className="text-md font-medium text-ink text-right">
            {fmt(q.withheld, currency)}
          </span>
          <span className="text-md font-medium text-ink text-right">
            {fmt(q.remitted, currency)}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-[auto_1fr_1fr] gap-x-6 items-center pt-2.5 font-bold text-md text-ink">
        <span>{t("hacienda.whTotal", { year })}</span>
        <span className="text-right">{fmt(data.total_withheld, currency)}</span>
        <span className="text-right">{fmt(data.total_remitted, currency)}</span>
      </div>

      {showRemit && (
        <Modal
          open
          size="sm"
          title={t("hacienda.whRecord")}
          onClose={() => setShowRemit(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              if (!form.fundingCoaId)
                return setError(t("transactions.errSelectAccount"));
              if (!(parseFloat(form.amount) > 0))
                return setError(t("transactions.errValidAmount"));
              remitMutation.mutate();
            }}
            className="flex flex-col gap-3.5"
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("hacienda.whDate")} className="mb-0">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </Field>
              <Field label={t("hacienda.whAmount")} className="mb-0">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) =>
                    setForm({ ...form, amount: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label={t("hacienda.whPaidFrom")} className="mb-0">
              <Select
                value={form.fundingCoaId}
                onChange={(e) =>
                  setForm({ ...form, fundingCoaId: e.target.value })
                }
              >
                <option value="">{t("transactions.selectAccount")}</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code ? `${a.code} · ${a.name}` : a.name}
                  </option>
                ))}
              </Select>
            </Field>
            {error && <div className="text-md text-expense">{error}</div>}
            <div className="flex gap-2.5 justify-end mt-1">
              <Button onClick={() => setShowRemit(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={remitMutation.isPending}
              >
                {t("hacienda.whConfirm")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}
