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
const YEARS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const STATUS_TONE = {
  done: "income",
  late: "danger",
  ready: "payroll",
  upcoming: "neutral",
};

function SummaryCard({ label, value }) {
  return (
    <Card padding="none" className="p-3.5">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className="text-lg font-bold text-ink">{value}</div>
    </Card>
  );
}

// IVU mensual (SC 2915) — monthly PR sales & use tax prep for SURI.
// Accrual-basis figures from IVU invoices (state 10.5% / municipal 1% split,
// 4% designated services state-only), remittances + balance from the
// "IVU por pagar" ledger account, and the 20th-of-month filing calendar.
export default function IvuReport() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const fmt = makeFmt(lang);
  const currency = useAuthStore((s) => s.business)?.currency || "USD";
  const role = useAuthStore((s) => s.user)?.role;
  const canAct = role === "owner" || role === "admin";

  const [year, setYear] = useState(CURRENT_YEAR);
  const [showRemit, setShowRemit] = useState(false);
  const [remitForm, setRemitForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    fundingCoaId: "",
  });
  const [remitError, setRemitError] = useState("");
  const [exportError, setExportError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["ivu-summary", year],
    queryFn: () => api.get(`/reports/ivu-summary?year=${year}`).then((r) => r.data),
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
        .post("/reports/ivu-remit", {
          date: remitForm.date,
          amount: parseFloat(remitForm.amount),
          fundingCoaId: remitForm.fundingCoaId,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ivu-summary"] });
      qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      setShowRemit(false);
      toast.success(t("ivu.remitted"));
    },
    onError: (err) =>
      setRemitError(err.response?.data?.error || t("ivu.remitFailed")),
  });

  const markDone = useMutation({
    mutationFn: ({ id, done }) =>
      api.put(`/reports/ivu-calendar/${id}/status`, { done }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ivu-summary"] }),
    onError: () => toast.error(t("ivu.statusFailed")),
  });

  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/reports/ivu-summary/export?year=${year}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ivu-${year}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => setExportError(""),
    onError: () => setExportError(t("ivu.exportBlocked")),
  });

  const monthName = (m) =>
    new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
      month: "long",
    }).format(new Date(Date.UTC(2000, m - 1, 15)));

  // Obligation per period month ("YYYY-MM-01" period_start).
  const obligationByMonth = useMemo(() => {
    const map = {};
    for (const o of data?.obligations || []) {
      const m = parseInt(String(o.period_start).slice(5, 7), 10);
      if (m) map[m] = o;
    }
    return map;
  }, [data]);

  if (isLoading || !data) {
    return <div className="p-10 text-center text-muted">{t("common.loading")}</div>;
  }

  const due = data.balance_due;
  const hasActivity = data.months.some(
    (m) => m.tax_total > 0 || m.exempt_sales > 0 || m.remitted > 0,
  );

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h1 className="text-lg font-bold text-ink">{t("ivu.title")}</h1>
          <p className="text-xs text-muted">{t("ivu.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Button
            icon="ti-download"
            disabled={!hasActivity}
            title={!hasActivity ? t("ivu.exportDisabledHint") : undefined}
            loading={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            {t("ivu.exportCsv")}
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted bg-canvas rounded-lg px-3.5 py-2.5 mb-4">
        <i className="ti ti-info-circle mr-1.5" aria-hidden="true" />
        {t("ivu.disclaimer")}
      </div>

      {!data.payer.complete && (
        <div className="flex items-center gap-2.5 flex-wrap bg-expense-bg text-expense border border-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span className="flex-1">{t("ivu.merchantRegMissing")}</span>
          <Link
            to="/settings"
            className="font-semibold underline underline-offset-2"
          >
            {t("hacienda.completeProfile")}
          </Link>
        </div>
      )}
      {exportError && (
        <div className="bg-expense-bg text-expense border border-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
          {exportError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          label={t("ivu.cardTaxable")}
          value={fmt(data.totals.taxable_sales + data.totals.reduced_sales, currency)}
        />
        <SummaryCard
          label={t("ivu.cardState")}
          value={fmt(data.totals.state_tax, currency)}
        />
        <SummaryCard
          label={t("ivu.cardMuni")}
          value={fmt(data.totals.muni_tax, currency)}
        />
        <Card padding="none" className="p-3.5">
          <div className="text-[11px] text-muted mb-1">{t("ivu.cardBalance")}</div>
          <div
            className={cx(
              "text-lg font-bold",
              due > 0 ? "text-expense" : "text-income",
            )}
          >
            {fmt(due, currency)}
          </div>
        </Card>
      </div>

      <Card padding="none" className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="text-md font-semibold text-ink">
              {t("ivu.tableTitle", { year })}
            </div>
            <div className="text-xs text-muted">{t("ivu.tableSubtitle")}</div>
          </div>
          <Button
            variant="primary"
            icon="ti-building-bank"
            disabled={due <= 0}
            onClick={() => {
              setRemitForm((f) => ({ ...f, amount: String(due) }));
              setRemitError("");
              setShowRemit(true);
            }}
          >
            {t("ivu.recordPayment")}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[110px_1fr_1fr_1fr_1fr_1fr_1fr_130px] gap-x-4 text-xs text-muted font-semibold tracking-[0.5px] uppercase pb-1.5 border-b-[1.5px] border-line mb-1">
              <span>{t("ivu.colMonth")}</span>
              <span className="text-right">{t("ivu.colTaxable")}</span>
              <span className="text-right">{t("ivu.colReduced")}</span>
              <span className="text-right">{t("ivu.colExempt")}</span>
              <span className="text-right">{t("ivu.colState")}</span>
              <span className="text-right">{t("ivu.colMuni")}</span>
              <span className="text-right">{t("ivu.colPaid")}</span>
              <span className="text-right">{t("ivu.colStatus")}</span>
            </div>
            {data.months.map((m) => {
              const o = obligationByMonth[m.month];
              const status = o?.display_status;
              return (
                <div
                  key={m.month}
                  className="grid grid-cols-[110px_1fr_1fr_1fr_1fr_1fr_1fr_130px] gap-x-4 items-center py-2 border-b border-line"
                >
                  <span className="text-md text-ink capitalize">
                    {monthName(m.month)}
                  </span>
                  <span className="text-md text-ink text-right">
                    {fmt(m.taxable_sales, currency)}
                  </span>
                  <span className="text-md text-ink text-right">
                    {fmt(m.reduced_sales, currency)}
                  </span>
                  <span className="text-md text-ink text-right">
                    {fmt(m.exempt_sales, currency)}
                  </span>
                  <span className="text-md font-medium text-ink text-right">
                    {fmt(m.state_tax, currency)}
                  </span>
                  <span className="text-md font-medium text-ink text-right">
                    {fmt(m.muni_tax, currency)}
                  </span>
                  <span className="text-md text-ink text-right">
                    {fmt(m.remitted, currency)}
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    {status && (
                      <Badge tone={STATUS_TONE[status] || "neutral"}>
                        {t(`ivu.status_${status}`)}
                      </Badge>
                    )}
                    {canAct && o && (
                      <button
                        type="button"
                        onClick={() =>
                          markDone.mutate({ id: o.id, done: status !== "done" })
                        }
                        className="flex items-center justify-center w-[26px] h-[26px] rounded-md text-muted hover:text-brand hover:bg-canvas cursor-pointer"
                        title={
                          status === "done"
                            ? t("ivu.markNotFiled")
                            : t("ivu.markFiled")
                        }
                      >
                        <i
                          className={cx(
                            "ti text-xs",
                            status === "done" ? "ti-rotate" : "ti-check",
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            <div className="grid grid-cols-[110px_1fr_1fr_1fr_1fr_1fr_1fr_130px] gap-x-4 items-center pt-2.5 font-bold text-md text-ink">
              <span>{t("ivu.rowTotal")}</span>
              <span className="text-right">{fmt(data.totals.taxable_sales, currency)}</span>
              <span className="text-right">{fmt(data.totals.reduced_sales, currency)}</span>
              <span className="text-right">{fmt(data.totals.exempt_sales, currency)}</span>
              <span className="text-right">{fmt(data.totals.state_tax, currency)}</span>
              <span className="text-right">{fmt(data.totals.muni_tax, currency)}</span>
              <span className="text-right">{fmt(data.totals.remitted, currency)}</span>
              <span />
            </div>
          </div>
        </div>

        <div className="text-xs text-muted mt-3">
          <i className="ti ti-calendar-due mr-1.5" aria-hidden="true" />
          {t("ivu.dueNote")}
        </div>
      </Card>

      {showRemit && (
        <Modal
          open
          size="sm"
          title={t("ivu.recordPayment")}
          onClose={() => setShowRemit(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRemitError("");
              if (!remitForm.fundingCoaId)
                return setRemitError(t("transactions.errSelectAccount"));
              if (!(parseFloat(remitForm.amount) > 0))
                return setRemitError(t("transactions.errValidAmount"));
              remitMutation.mutate();
            }}
            className="flex flex-col gap-3.5"
          >
            <p className="text-xs text-muted">{t("ivu.remitHint")}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("ivu.remitDate")} className="mb-0">
                <Input
                  type="date"
                  value={remitForm.date}
                  onChange={(e) =>
                    setRemitForm({ ...remitForm, date: e.target.value })
                  }
                />
              </Field>
              <Field label={t("ivu.remitAmount")} className="mb-0">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={remitForm.amount}
                  onChange={(e) =>
                    setRemitForm({ ...remitForm, amount: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label={t("ivu.remitPaidFrom")} className="mb-0">
              <Select
                value={remitForm.fundingCoaId}
                onChange={(e) =>
                  setRemitForm({ ...remitForm, fundingCoaId: e.target.value })
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
            {remitError && (
              <div className="text-md text-expense">{remitError}</div>
            )}
            <div className="flex gap-2.5 justify-end mt-1">
              <Button onClick={() => setShowRemit(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={remitMutation.isPending}
              >
                {t("ivu.remitConfirm")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
