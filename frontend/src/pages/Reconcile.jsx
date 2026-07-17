import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import Papa from "papaparse";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { confirmDialog, toast } from "../store/feedbackStore";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const fundingLabel = (r, t) =>
  r.account_name || (r.coa_name_key ? t(r.coa_name_key) : r.coa_name) || "—";

// ── Statement CSV → {date, amount} lines ─────────────────────
// Best-effort column detection; a miss just means no auto-matches.
function parseStatementRows(results) {
  const fields = results.meta?.fields || [];
  const dateKey = fields.find((f) => /date|fecha/i.test(f));
  const amountKey = fields.find((f) => /amount|monto|importe/i.test(f));
  if (!dateKey || !amountKey) return null;
  return results.data
    .map((row) => ({
      date: dayjs(row[dateKey]),
      amount: parseFloat(String(row[amountKey]).replace(/[$,\s]/g, "")),
    }))
    .filter((l) => l.date.isValid() && !Number.isNaN(l.amount) && l.amount !== 0);
}

// ── New reconciliation modal ──────────────────────────────────
function NewReconModal({ onClose, onCreated, accounts, ledgerAccounts, t }) {
  const [form, setForm] = useState({
    fundingId: "", // "acct:<id>" | "coa:<id>"
    startDate: dayjs().startOf("month").format("YYYY-MM-DD"),
    endDate: dayjs().endOf("month").format("YYYY-MM-DD"),
    statementStartBalance: "",
    statementEndBalance: "",
  });
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const isLedger = form.fundingId.startsWith("coa:");
      const fundingId = form.fundingId.replace(/^(coa|acct):/, "");
      return api
        .post("/reconciliations", {
          ...(isLedger ? { fundingCoaId: fundingId } : { accountId: fundingId }),
          startDate: form.startDate,
          endDate: form.endDate,
          statementStartBalance: parseFloat(form.statementStartBalance || 0),
          statementEndBalance: parseFloat(form.statementEndBalance),
        })
        .then((r) => r.data);
    },
    onSuccess: (recon) => onCreated(recon),
    onError: (err) =>
      setError(err.response?.data?.error || t("recon.createFailed")),
  });

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.fundingId) return setError(t("transactions.errSelectAccount"));
    if (form.statementEndBalance === "")
      return setError(t("recon.errEndBalance"));
    createMutation.mutate();
  }

  return (
    <Modal open onClose={onClose} title={t("recon.newRecon")} size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <Field label={t("common.account")} className="mb-0">
          <Select
            value={form.fundingId}
            onChange={(e) => setForm({ ...form, fundingId: e.target.value })}
          >
            <option value="">{t("transactions.selectAccount")}</option>
            {accounts?.length > 0 && (
              <optgroup label={t("transactions.bankAccounts")}>
                {accounts.map((a) => (
                  <option key={a.id} value={`acct:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {ledgerAccounts?.length > 0 && (
              <optgroup label={t("transactions.ledgerAccounts")}>
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={`coa:${a.id}`}>
                    {a.code ? `${a.code} · ${a.name}` : a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("reports.customFrom")} className="mb-0">
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label={t("reports.customTo")} className="mb-0">
            <Input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("recon.statementStartBalance")} className="mb-0">
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={form.statementStartBalance}
              onChange={(e) =>
                setForm({ ...form, statementStartBalance: e.target.value })
              }
            />
          </Field>
          <Field label={t("recon.statementEndBalance")} className="mb-0">
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={form.statementEndBalance}
              onChange={(e) =>
                setForm({ ...form, statementEndBalance: e.target.value })
              }
            />
          </Field>
        </div>

        {error && <div className="text-md text-expense">{error}</div>}

        <div className="flex gap-2.5 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={createMutation.isPending}
          >
            {t("recon.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Match workspace (one reconciliation) ──────────────────────
function ReconDetail({ reconId, onBack, fmt, currency, t }) {
  const qc = useQueryClient();
  const fileRef = useRef(null);

  const { data: recon } = useQuery({
    queryKey: ["recon", reconId],
    queryFn: () => api.get(`/reconciliations/${reconId}`).then((r) => r.data),
  });
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["recon-candidates", reconId],
    queryFn: () =>
      api.get(`/reconciliations/${reconId}/transactions`).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["recon", reconId] });
    qc.invalidateQueries({ queryKey: ["recon-candidates", reconId] });
    qc.invalidateQueries({ queryKey: ["reconciliations"] });
  };

  const clearMutation = useMutation({
    mutationFn: (body) =>
      api.put(`/reconciliations/${reconId}/transactions`, body),
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(err.response?.data?.error || t("recon.updateFailed")),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.post(`/reconciliations/${reconId}/complete`),
    onSuccess: () => {
      invalidate();
      toast.success(t("recon.completedToast"));
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("recon.completeFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/reconciliations/${reconId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reconciliations"] });
      onBack();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("recon.updateFailed")),
  });

  // Cleared math, live from the candidate list
  const cleared = useMemo(
    () => candidates.filter((c) => c.cleared),
    [candidates],
  );
  const clearedDelta = useMemo(
    () =>
      cleared.reduce(
        (s, c) =>
          s +
          (c.type === "income"
            ? parseFloat(c.cash_amount)
            : -parseFloat(c.cash_amount)),
        0,
      ),
    [cleared],
  );

  if (!recon) return null;
  const inProgress = recon.status === "in_progress";
  const startBal = parseFloat(recon.statement_start_balance);
  const endBal = parseFloat(recon.statement_end_balance);
  const computedEnd = startBal + clearedDelta;
  const difference = parseFloat((endBal - computedEnd).toFixed(2));
  const balanced = Math.abs(difference) < 0.005;

  // CSV auto-match: same absolute amount, matching sign, date within 3 days
  function handleCsv(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const lines = parseStatementRows(results);
        if (!lines) return toast.error(t("recon.csvNoColumns"));
        const free = candidates.filter((c) => !c.cleared);
        const used = new Set();
        const ids = [];
        for (const line of lines) {
          const match = free.find(
            (c) =>
              !used.has(c.id) &&
              Math.abs(parseFloat(c.cash_amount) - Math.abs(line.amount)) <
                0.005 &&
              (line.amount >= 0) === (c.type === "income") &&
              Math.abs(line.date.diff(dayjs(c.date), "day")) <= 3,
          );
          if (match) {
            used.add(match.id);
            ids.push(match.id);
          }
        }
        if (ids.length > 0) clearMutation.mutate({ add: ids });
        toast.info(
          t("recon.matchedToast", { matched: ids.length, total: lines.length }),
        );
      },
    });
  }

  return (
    <div className="max-w-[860px] mx-auto">
      <PageHeader
        title={`${fundingLabel(recon, t)} · ${dayjs(recon.start_date).format("MMM D")} – ${dayjs(recon.end_date).format("MMM D, YYYY")}`}
        subtitle={
          inProgress ? t("recon.status_in_progress") : t("recon.lockedNote")
        }
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" icon="ti-arrow-left" onClick={onBack}>
              {t("recon.backToList")}
            </Button>
            {inProgress && (
              <>
                <Button
                  size="sm"
                  icon="ti-file-upload"
                  onClick={() => fileRef.current?.click()}
                >
                  {t("recon.uploadCsv")}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleCsv(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        message: t("recon.confirmCancel"),
                        confirmLabel: t("recon.cancelRecon"),
                        danger: true,
                      })
                    )
                      deleteMutation.mutate();
                  }}
                >
                  {t("recon.cancelRecon")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon="ti-lock-check"
                  disabled={!balanced || completeMutation.isPending}
                  title={!balanced ? t("recon.diffHint") : undefined}
                  onClick={() => completeMutation.mutate()}
                >
                  {t("recon.complete")}
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Summary bar */}
      <Card padding="none" className="px-4 py-3 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[
            [t("recon.statementStartBalance"), fmt(startBal, currency), ""],
            [t("recon.clearedTotal"), fmt(clearedDelta, currency), ""],
            [t("recon.statementEndBalance"), fmt(endBal, currency), ""],
            [
              t("recon.difference"),
              fmt(difference, currency),
              balanced ? "text-income" : "text-expense",
            ],
          ].map(([label, value, tone]) => (
            <div key={label}>
              <div className="text-[11px] text-muted uppercase tracking-[0.5px]">
                {label}
              </div>
              <div className={cx("text-sm font-bold", tone || "text-ink")}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Candidate transactions */}
      <Card padding="none" className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-muted text-md">
            {t("common.loading")}
          </div>
        ) : candidates.length === 0 ? (
          <EmptyState
            icon="ti-receipt-off"
            message={t("recon.noCandidates")}
          />
        ) : (
          candidates.map((tx) => (
            <label
              key={tx.id}
              className={cx(
                "flex items-center gap-3 px-4 py-[var(--row-y)] border-b border-line",
                inProgress
                  ? "cursor-pointer hover:bg-canvas transition-colors"
                  : "opacity-90",
              )}
            >
              <input
                type="checkbox"
                checked={tx.cleared}
                disabled={!inProgress || clearMutation.isPending}
                onChange={() =>
                  clearMutation.mutate(
                    tx.cleared ? { remove: [tx.id] } : { add: [tx.id] },
                  )
                }
                className="w-4 h-4 shrink-0 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <div className="text-md font-medium text-ink truncate">
                  {tx.merchant || tx.notes || "—"}
                </div>
                <div className="text-[11px] text-muted">
                  {dayjs(tx.date).format("MMM D, YYYY")}
                </div>
              </div>
              <div
                className={cx(
                  "text-sm font-semibold shrink-0",
                  tx.type === "income" ? "text-income" : "text-expense",
                )}
              >
                {tx.type === "income" ? "+" : "-"}
                {fmt(tx.cash_amount, currency)}
              </div>
            </label>
          ))
        )}
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Reconcile() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const [showNew, setShowNew] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const qc = useQueryClient();

  const { data: recons = [], isLoading } = useQuery({
    queryKey: ["reconciliations"],
    queryFn: () => api.get("/reconciliations").then((r) => r.data),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });
  const { data: coaGroups } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const ledgerAccounts = useMemo(() => {
    if (!coaGroups) return [];
    const twinIds = new Set(
      (accounts || []).map((a) => a.coa_account_id).filter(Boolean),
    );
    const out = [];
    const walk = (acc) => {
      if (!twinIds.has(acc.id))
        out.push({
          id: acc.id,
          name: acc.name_key ? t(acc.name_key) : acc.name,
          code: acc.code,
        });
      acc.children?.forEach(walk);
    };
    for (const g of coaGroups) {
      if (g.account_type === "asset" || g.account_type === "liability")
        g.accounts.forEach(walk);
    }
    return out;
  }, [coaGroups, accounts, t]);

  if (activeId) {
    return (
      <ReconDetail
        reconId={activeId}
        onBack={() => setActiveId(null)}
        fmt={fmt}
        currency={currency}
        t={t}
      />
    );
  }

  return (
    <div className="max-w-[860px] mx-auto">
      <PageHeader
        title={t("recon.title")}
        subtitle={t("recon.subtitle")}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => setShowNew(true)}
          >
            {t("recon.newRecon")}
          </Button>
        }
      />

      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {!isLoading && recons.length === 0 && (
        <Card>
          <EmptyState
            icon="ti-checklist"
            title={t("recon.noneYet")}
            message={t("recon.noneYetHint")}
            action={
              <Button
                variant="primary"
                icon="ti-plus"
                onClick={() => setShowNew(true)}
              >
                {t("recon.newRecon")}
              </Button>
            }
          />
        </Card>
      )}

      {!isLoading && recons.length > 0 && (
        <div className="flex flex-col gap-2">
          {recons.map((r) => (
            <Card
              key={r.id}
              padding="none"
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:border-brand transition-colors"
              onClick={() => setActiveId(r.id)}
            >
              <i
                className={cx(
                  "ti text-lg shrink-0",
                  r.status === "completed"
                    ? "ti-lock-check text-income"
                    : "ti-progress text-payroll",
                )}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <div className="text-md font-medium text-ink truncate">
                  {fundingLabel(r, t)}
                </div>
                <div className="text-[11px] text-muted">
                  {dayjs(r.start_date).format("MMM D")} –{" "}
                  {dayjs(r.end_date).format("MMM D, YYYY")} ·{" "}
                  {r.cleared_count} {t("recon.cleared")}
                </div>
              </div>
              <div className="text-sm font-semibold text-ink shrink-0">
                {fmt(r.statement_end_balance, currency)}
              </div>
              <Badge tone={r.status === "completed" ? "income" : "payroll"}>
                {t(`recon.status_${r.status}`)}
              </Badge>
            </Card>
          ))}
        </div>
      )}

      {showNew && (
        <NewReconModal
          onClose={() => setShowNew(false)}
          onCreated={(recon) => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ["reconciliations"] });
            setActiveId(recon.id);
          }}
          accounts={accounts}
          ledgerAccounts={ledgerAccounts}
          t={t}
        />
      )}
    </div>
  );
}
