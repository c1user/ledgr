/**
 * PR payroll v2 run flow (ROADMAP-V5 · Phase 3): create-run modal with
 * the daily hours grid, and the run detail modal (items, finalize,
 * reverse). Sandbox runs carry the watermark banner on every surface.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import api from "../../lib/api";
import useAuthStore from "../../store/authStore";
import { toast, confirmDialog } from "../../store/feedbackStore";
import cx from "../../lib/cx";
import { Badge, Button, Field, Input, Modal, Select } from "../ui";

// Mirrors SANDBOX_WATERMARK in backend/src/services/payrollRules.js.
const SANDBOX_WATERMARK = "CÁLCULO NO VERIFICADO — SOLO PRUEBAS";

const fmtCents = (lang) => (cents) =>
  new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);

function WatermarkBanner({ t }) {
  return (
    <div className="bg-danger-bg border border-danger rounded-lg px-3.5 py-2.5 mb-4">
      <div className="font-bold text-danger text-[13px] tracking-wide">
        <i className="ti ti-flask mr-1.5" aria-hidden="true" />
        {SANDBOX_WATERMARK}
      </div>
      <div className="text-[11px] text-secondary mt-0.5">
        {t("payrollV2.sandboxRunHint")}
      </div>
    </div>
  );
}

function periodDates(start, end) {
  const dates = [];
  let d = dayjs(start);
  const stop = dayjs(end);
  while (d.isBefore(stop) || d.isSame(stop, "day")) {
    dates.push(d.format("YYYY-MM-DD"));
    d = d.add(1, "day");
  }
  return dates.length <= 31 ? dates : [];
}

// ── Create-run modal ─────────────────────────────────────────
export function RunPayrollV2Modal({ onClose, employees, t }) {
  const queryClient = useQueryClient();
  const now = dayjs();
  const [form, setForm] = useState({
    periodStart: now.subtract(13, "day").format("YYYY-MM-DD"),
    periodEnd: now.format("YYYY-MM-DD"),
    payDate: now.add(5, "day").format("YYYY-MM-DD"),
    frequency: "biweekly",
  });
  // hours[employeeId][date] = string
  const [hours, setHours] = useState({});
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState(null);

  const hourly = employees?.filter((e) => e.pay_type === "hourly") || [];
  const dates = periodDates(form.periodStart, form.periodEnd);

  // Default frequency from the employer profile, once.
  useQuery({
    queryKey: ["payroll-profile"],
    queryFn: async () => {
      const r = await api.get("/payroll-profile");
      if (r.data?.default_pay_frequency) {
        setForm((f) => ({ ...f, frequency: r.data.default_pay_frequency }));
      }
      return r.data;
    },
    staleTime: Infinity,
  });

  // Prefill grid from saved time entries for the period.
  useQuery({
    queryKey: ["payroll-time", form.periodStart, form.periodEnd],
    queryFn: async () => {
      const r = await api.get(
        `/payroll-time?start=${form.periodStart}&end=${form.periodEnd}`,
      );
      const grid = {};
      for (const e of r.data) {
        const date = String(e.work_date).slice(0, 10);
        (grid[e.employee_id] ||= {})[date] = String(Number(e.hours));
      }
      setHours(grid);
      return r.data;
    },
    enabled: dates.length > 0 && hourly.length > 0,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      // 1) persist the hours grid, 2) create the draft run.
      const entries = [];
      for (const emp of hourly) {
        for (const date of dates) {
          const raw = hours[emp.id]?.[date];
          if (raw !== undefined && raw !== "") {
            entries.push({
              employeeId: emp.id,
              date,
              hours: Number(raw) || 0,
            });
          }
        }
      }
      if (entries.length > 0) {
        await api.put("/payroll-time", { entries });
      }
      return api.post("/payroll-v2", form).then((r) => r.data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-v2"] });
      if (data.warnings?.length) {
        toast.info(
          `${t("payrollV2.createdWithWarnings")}: ${data.warnings.join(", ")}`,
        );
      } else {
        toast.success(t("payrollV2.draftCreated"));
      }
      onClose(data.run?.id);
    },
    onError: (err) => {
      const body = err.response?.data;
      if (body?.code === "PREFLIGHT_BLOCKED") {
        setBlockers(body.blockers || []);
        setError(t("payrollV2.blockedTitle"));
      } else {
        setError(body?.error || t("payroll.runFailed"));
      }
    },
  });

  const totalHours = (empId) =>
    dates.reduce((a, d) => a + (Number(hours[empId]?.[d]) || 0), 0);

  return (
    <Modal open onClose={() => onClose()} title={t("payrollV2.runTitle")} size="xl">
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-3">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
          {blockers && (
            <ul className="mt-2 text-[12px] list-disc pl-5">
              {blockers.map((b) => (
                <li key={b.rule_type}>
                  {t(`payrollRules.type_${b.rule_type}`, {
                    defaultValue: b.rule_type,
                  })}{" "}
                  — {b.reason === "MISSING"
                    ? t("payrollV2.ruleMissing")
                    : t("payrollRules.unverified")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Field label={t("payroll.periodStart")} className="mb-0">
          <Input
            type="date"
            value={form.periodStart}
            onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
          />
        </Field>
        <Field label={t("payroll.periodEnd")} className="mb-0">
          <Input
            type="date"
            value={form.periodEnd}
            onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
          />
        </Field>
        <Field label={t("payrollV2.payDate")} className="mb-0">
          <Input
            type="date"
            value={form.payDate}
            onChange={(e) => setForm({ ...form, payDate: e.target.value })}
          />
        </Field>
        <Field label={t("payroll.payFrequency")} className="mb-0">
          <Select
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
          >
            <option value="weekly">{t("payroll.freqWeekly")}</option>
            <option value="biweekly">{t("payroll.freqBiweekly")}</option>
            <option value="semimonthly">{t("payroll.freqSemimonthly")}</option>
            <option value="monthly">{t("payroll.freqMonthly")}</option>
          </Select>
        </Field>
      </div>

      {hourly.length > 0 && dates.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-secondary mb-2">
            {t("payrollV2.dailyHours")}
          </div>
          <div className="overflow-x-auto border border-line rounded-lg">
            <table className="text-[12px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left text-muted sticky left-0 bg-surface">
                    {t("payroll.tableEmployee", "Employee")}
                  </th>
                  {dates.map((d) => (
                    <th key={d} className="px-1 py-2 text-muted font-normal">
                      {dayjs(d).format("D")}
                      <div className="text-[10px]">{dayjs(d).format("dd")}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-muted">Σ</th>
                </tr>
              </thead>
              <tbody>
                {hourly.map((emp) => (
                  <tr key={emp.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink sticky left-0 bg-surface">
                      {emp.name}
                    </td>
                    {dates.map((d) => (
                      <td key={d} className="px-0.5 py-1">
                        <input
                          className="w-11 text-center bg-canvas border border-line rounded px-1 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand/40"
                          inputMode="decimal"
                          value={hours[emp.id]?.[d] ?? ""}
                          onChange={(e) =>
                            setHours((h) => ({
                              ...h,
                              [emp.id]: { ...h[emp.id], [d]: e.target.value },
                            }))
                          }
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-secondary font-medium">
                      {totalHours(emp.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-muted mt-1.5">
            {t("payrollV2.dailyHoursHint")}
          </div>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button onClick={() => onClose()}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          icon="ti-calculator"
          disabled={mutation.isPending}
          onClick={() => {
            setError("");
            setBlockers(null);
            mutation.mutate();
          }}
        >
          {mutation.isPending
            ? t("payroll.saving")
            : t("payrollV2.createDraft")}
        </Button>
      </div>
    </Modal>
  );
}

// ── Christmas-bonus eligibility panel (Phase 4.3) ────────────
export function BonusEligibilityPanel({ t, lang }) {
  const fmt = fmtCents(lang);
  const { data, isLoading } = useQuery({
    queryKey: ["bonus-eligibility"],
    queryFn: () =>
      api.get("/payroll-v2/reports/bonus-eligibility").then((r) => r.data),
  });

  if (isLoading || !data) {
    return <div className="p-6 text-center text-muted">…</div>;
  }

  return (
    <div>
      {(data.watermark || data.rule_status === "UNVERIFIED") && (
        <WatermarkBanner t={t} />
      )}

      <div className="flex items-center gap-3 flex-wrap mb-3 text-[12px] text-muted">
        <span>
          {t("payrollV2.bonusAsOf")} {dayjs(data.as_of).format("MMM D, YYYY")}
        </span>
        {data.payment_window && (
          <span>
            {t("payrollV2.bonusWindow")}: {data.payment_window.start} —{" "}
            {data.payment_window.end}
          </span>
        )}
        {!data.size_band && (
          <Badge tone="danger" icon="ti-alert-triangle">
            {t("payrollV2.bonusNoSizeBand")}
          </Badge>
        )}
      </div>

      <div className="border border-line rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-muted uppercase tracking-[0.5px] border-b border-line">
              <th className="px-4 py-2.5">{t("payroll.tableEmployee", "Employee")}</th>
              <th className="px-4 py-2.5">{t("payrollV2.bonusHours")}</th>
              <th className="px-4 py-2.5">{t("payrollV2.bonusStatus")}</th>
              <th className="px-4 py-2.5 text-right">
                {t("payrollV2.bonusProjected")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => (
              <tr key={e.employee_id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 text-ink">
                  {e.name}
                  <div className="text-[11px] text-muted">
                    {t("payrollV2.bonusHired")}{" "}
                    {dayjs(e.hire_date).format("MMM YYYY")}
                  </div>
                </td>
                <td className="px-4 py-3 text-secondary whitespace-nowrap">
                  {e.qualifying_hours}
                  {e.threshold != null && (
                    <span className="text-muted"> / {e.threshold}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {e.eligible == null ? (
                    <Badge tone="neutral">—</Badge>
                  ) : e.eligible ? (
                    <Badge tone="income" icon="ti-check">
                      {t("payrollV2.bonusEligible")}
                    </Badge>
                  ) : (
                    <Badge tone="payroll">{t("payrollV2.bonusPending")}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-ink whitespace-nowrap">
                  {e.projected_bonus_cents != null
                    ? fmt(e.projected_bonus_cents)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-muted mt-2.5">
        {t("payrollV2.bonusDisclaimer")}
      </div>
    </div>
  );
}

// ── Run detail modal ─────────────────────────────────────────
export function RunV2DetailModal({ runId, onClose, t, lang }) {
  const queryClient = useQueryClient();
  const fmt = fmtCents(lang);
  const user = useAuthStore((s) => s.user);
  const canAct = ["owner", "admin"].includes(user?.role);
  const [openLine, setOpenLine] = useState(null);

  const { data: run } = useQuery({
    queryKey: ["payroll-v2-run", runId],
    queryFn: () => api.get(`/payroll-v2/${runId}`).then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll-v2"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-v2-run", runId] });
  };

  const finalizeMutation = useMutation({
    mutationFn: () => api.post(`/payroll-v2/${runId}/finalize`),
    onSuccess: () => {
      invalidate();
      toast.success(t("payrollV2.finalized"));
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const reverseMutation = useMutation({
    mutationFn: () => api.post(`/payroll-v2/${runId}/reverse`, { confirm: true }),
    onSuccess: () => {
      invalidate();
      toast.success(t("payrollV2.reversed"));
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/payroll-v2/${runId}`),
    onSuccess: () => {
      invalidate();
      toast.success(t("payrollV2.draftDeleted"));
      onClose();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("common.error")),
  });

  if (!run) return null;

  const statusTone = { draft: "payroll", finalized: "income", reversed: "expense" }[
    run.status
  ];
  const itemLabel = (code) =>
    t(`payrollV2.item_${code}`, { defaultValue: code });

  const downloadPdf = async (kind) => {
    try {
      const res = await api.get(`/payroll-v2/${runId}/${kind}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-${String(run.pay_date).slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("common.error"));
    }
  };

  return (
    <Modal open onClose={onClose} title={t("payrollV2.runDetailTitle")} size="xl">
      {run.run_mode === "sandbox" && <WatermarkBanner t={t} />}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Badge tone={statusTone}>
          {t(`payrollV2.status_${run.status}`, { defaultValue: run.status })}
        </Badge>
        <Badge tone={run.run_mode === "sandbox" ? "danger" : "income"}>
          {run.run_mode === "sandbox"
            ? t("payrollV2.modeSandbox")
            : t("payrollV2.modeProduction")}
        </Badge>
        {run.reversal_of && (
          <Badge tone="neutral">{t("payrollV2.isReversal")}</Badge>
        )}
        <span className="text-[12px] text-muted">
          {dayjs(run.period_start).format("MMM D")} —{" "}
          {dayjs(run.period_end).format("MMM D, YYYY")} ·{" "}
          {t("payrollV2.payDate")} {dayjs(run.pay_date).format("MMM D, YYYY")}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          ["payrollV2.gross", run.gross_cents],
          ["payrollV2.deductions", run.employee_deductions_cents],
          ["payrollV2.employerCost", run.employer_contributions_cents],
          ["payrollV2.net", run.net_cents],
        ].map(([key, cents]) => (
          <div key={key} className="bg-canvas rounded-lg px-3.5 py-3">
            <div className="text-[11px] text-muted mb-1">{t(key)}</div>
            <div className="text-md font-semibold text-ink">{fmt(cents)}</div>
          </div>
        ))}
      </div>

      <div className="border border-line rounded-lg overflow-hidden mb-4">
        {run.lines.map((line) => (
          <div key={line.id} className="border-b border-line last:border-0">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-canvas text-left"
              onClick={() => setOpenLine(openLine === line.id ? null : line.id)}
            >
              <span className="text-md font-medium text-ink">
                {line.employee_name}
              </span>
              <span className="text-[12px] text-secondary">
                {t("payrollV2.gross")} {fmt(line.gross_cents)} ·{" "}
                {t("payrollV2.net")}{" "}
                <strong className="text-ink">{fmt(line.net_cents)}</strong>
                <i
                  className={cx(
                    "ti ml-2",
                    openLine === line.id ? "ti-chevron-up" : "ti-chevron-down",
                  )}
                  aria-hidden="true"
                />
              </span>
            </button>
            {openLine === line.id && (
              <div className="px-3.5 pb-3">
                {["earning", "employee_deduction", "employer_contribution"].map(
                  (type) => {
                    const items = line.items.filter(
                      (i) => i.item_type === type,
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={type} className="mb-2">
                        <div className="text-[11px] text-muted uppercase tracking-[0.5px] mb-1">
                          {t(`payrollV2.group_${type}`)}
                        </div>
                        {items.map((it) => (
                          <div
                            key={it.id}
                            className="flex justify-between text-[13px] py-0.5"
                          >
                            <span className="text-secondary">
                              {itemLabel(it.code)}
                              {it.quantity != null && (
                                <span className="text-muted">
                                  {" "}
                                  · {Number(it.quantity)}h ×{" "}
                                  {fmt(it.rate_cents)}
                                </span>
                              )}
                            </span>
                            <span className="text-ink">
                              {fmt(it.amount_cents)}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 justify-end flex-wrap">
        <Button
          icon="ti-file-type-pdf"
          onClick={() => downloadPdf("stubs")}
        >
          {t("payrollV2.stubsPdf")}
        </Button>
        {run.status === "finalized" && !run.reversal_of && (
          <Button icon="ti-checkbook" onClick={() => downloadPdf("checks")}>
            {t("payrollV2.checksPdf")}
          </Button>
        )}
        <Button onClick={onClose}>{t("common.close", "Close")}</Button>
        {canAct && run.status === "draft" && (
          <>
            <Button
              variant="danger"
              icon="ti-trash"
              disabled={deleteMutation.isPending}
              onClick={async () => {
                if (
                  await confirmDialog({
                    message: t("payrollV2.confirmDeleteDraft"),
                    danger: true,
                  })
                )
                  deleteMutation.mutate();
              }}
            >
              {t("common.delete")}
            </Button>
            <Button
              variant="primary"
              icon="ti-lock-check"
              disabled={finalizeMutation.isPending}
              onClick={async () => {
                if (
                  await confirmDialog({
                    message: t(
                      run.run_mode === "production"
                        ? "payrollV2.confirmFinalizeProduction"
                        : "payrollV2.confirmFinalizeSandbox",
                    ),
                    confirmLabel: t("payrollV2.finalize"),
                  })
                )
                  finalizeMutation.mutate();
              }}
            >
              {t("payrollV2.finalize")}
            </Button>
          </>
        )}
        {canAct && run.status === "finalized" && !run.reversal_of && (
          <Button
            variant="danger"
            icon="ti-arrow-back-up"
            disabled={reverseMutation.isPending}
            onClick={async () => {
              if (
                await confirmDialog({
                  message: t("payrollV2.confirmReverse"),
                  confirmLabel: t("payrollV2.reverse"),
                  danger: true,
                })
              )
                reverseMutation.mutate();
            }}
          >
            {t("payrollV2.reverse")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
