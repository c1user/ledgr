import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";
import { confirmDialog } from "../store/feedbackStore";
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
  Tabs,
  Toggle,
} from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const emptyEmployee = {
  name: "",
  email: "",
  ssnLast4: "",
  payType: "salary",
  payRate: "",
  payFrequency: "biweekly",
  federalFilingStatus: "single",
  federalAllowances: 0,
  prStateTaxRate: 0.07,
  startDate: dayjs().format("YYYY-MM-DD"),
  federalExempt: true,
};

// Uppercase section label inside modals.
function SectionLabel({ children }) {
  return (
    <div className="text-[11px] text-muted tracking-[1px] uppercase mb-2.5">
      {children}
    </div>
  );
}

// Small label+value tile on a muted background.
function StatTile({ label, value, className }) {
  return (
    <div className="bg-canvas rounded-lg px-3.5 py-3">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className={cx("text-lg font-semibold", className || "text-ink")}>
        {value}
      </div>
    </div>
  );
}

// ── Employee Modal ────────────────────────────────────────────
function EmployeeModal({ onClose, editEmployee, t }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    editEmployee
      ? {
          name: editEmployee.name,
          email: editEmployee.email || "",
          ssnLast4: "",
          payType: editEmployee.pay_type,
          payRate: editEmployee.pay_rate,
          payFrequency: editEmployee.pay_frequency,
          federalFilingStatus: editEmployee.federal_filing_status,
          federalAllowances: editEmployee.federal_allowances,
          prStateTaxRate: editEmployee.pr_state_tax_rate,
          startDate: dayjs(editEmployee.start_date).format("YYYY-MM-DD"),
          federalExempt: editEmployee.federal_exempt ?? true,
        }
      : emptyEmployee,
  );
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data) =>
      editEmployee
        ? api.put(`/employees/${editEmployee.id}`, data)
        : api.post("/employees", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("payroll.empSaveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.name) return setError(t("payroll.errNameRequired"));
    if (!form.payRate || form.payRate <= 0)
      return setError(t("payroll.errPayRate"));
    mutation.mutate({
      ...form,
      payRate: parseFloat(form.payRate),
      federalAllowances: parseInt(form.federalAllowances || 0),
      prStateTaxRate: parseFloat(form.prStateTaxRate || 0.07),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        editEmployee ? t("payroll.editEmployee") : t("payroll.newEmployee")
      }
    >
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <SectionLabel>{t("payroll.basicInfo")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field label={t("payroll.fullName")} htmlFor="emp-name" className="mb-0">
            <Input
              id="emp-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Maria Lopez"
              required
              autoFocus
            />
          </Field>
          <Field label={t("common.email")} htmlFor="emp-email" className="mb-0">
            <Input
              id="emp-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="maria@example.com"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <Field label={t("payroll.ssnLast4")} htmlFor="emp-ssn" className="mb-0">
            <Input
              id="emp-ssn"
              value={form.ssnLast4}
              onChange={(e) => setForm({ ...form, ssnLast4: e.target.value })}
              placeholder="1234"
              maxLength={4}
            />
          </Field>
          <Field
            label={t("payroll.startDate")}
            htmlFor="emp-start"
            className="mb-0"
          >
            <Input
              id="emp-start"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </Field>
        </div>

        <SectionLabel>{t("payroll.payInfo")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field
            label={t("payroll.payType")}
            htmlFor="emp-paytype"
            className="mb-0"
          >
            <Select
              id="emp-paytype"
              value={form.payType}
              onChange={(e) => setForm({ ...form, payType: e.target.value })}
            >
              <option value="salary">{t("payroll.payTypeSalary")}</option>
              <option value="hourly">{t("payroll.payTypeHourly")}</option>
            </Select>
          </Field>
          <Field
            label={
              form.payType === "salary"
                ? t("payroll.annualSalary")
                : t("payroll.hourlyRate")
            }
            htmlFor="emp-payrate"
            className="mb-0"
          >
            <Input
              id="emp-payrate"
              type="number"
              step="0.01"
              value={form.payRate}
              onChange={(e) => setForm({ ...form, payRate: e.target.value })}
              placeholder={form.payType === "salary" ? "42000" : "18.50"}
              required
            />
          </Field>
        </div>
        <Field
          label={t("payroll.payFrequency")}
          htmlFor="emp-freq"
          className="mb-5"
        >
          <Select
            id="emp-freq"
            value={form.payFrequency}
            onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}
          >
            <option value="weekly">{t("payroll.freqWeekly")}</option>
            <option value="biweekly">{t("payroll.freqBiweekly")}</option>
            <option value="monthly">{t("payroll.freqMonthly")}</option>
          </Select>
        </Field>

        <SectionLabel>{t("payroll.taxInfo")}</SectionLabel>
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-canvas rounded-lg mb-3.5">
          <Toggle
            checked={form.federalExempt}
            onChange={() =>
              setForm({ ...form, federalExempt: !form.federalExempt })
            }
            aria-label={t("payroll.federalExempt")}
          />
          <div>
            <div className="text-md font-medium text-ink">
              {t("payroll.federalExempt")}
            </div>
            <div className="text-[11px] text-muted">
              {t("payroll.federalExemptHint")}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Field
            label={t("payroll.prStateTaxRate")}
            htmlFor="emp-pr-rate"
            className="mb-0"
          >
            <Input
              id="emp-pr-rate"
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={form.prStateTaxRate}
              onChange={(e) =>
                setForm({ ...form, prStateTaxRate: e.target.value })
              }
            />
          </Field>
          <Field
            label={t("payroll.federalFilingStatus")}
            htmlFor="emp-filing"
            className="mb-0"
          >
            <Select
              id="emp-filing"
              value={form.federalFilingStatus}
              onChange={(e) =>
                setForm({ ...form, federalFilingStatus: e.target.value })
              }
              disabled={form.federalExempt}
            >
              <option value="single">{t("payroll.filingSingle")}</option>
              <option value="married">{t("payroll.filingMarried")}</option>
            </Select>
          </Field>
        </div>

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t("payroll.saving")
              : editEmployee
                ? t("payroll.saveChanges")
                : t("payroll.addEmployee")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Run Payroll Modal ─────────────────────────────────────────
function RunPayrollModal({ onClose, employees, t }) {
  const queryClient = useQueryClient();
  const now = dayjs();
  const [form, setForm] = useState({
    periodStart: now.startOf("month").format("YYYY-MM-DD"),
    periodEnd: now.endOf("month").format("YYYY-MM-DD"),
  });
  const [hoursWorked, setHoursWorked] = useState({});
  const [error, setError] = useState("");
  const hourlyEmployees =
    employees?.filter((e) => e.pay_type === "hourly") || [];

  const mutation = useMutation({
    mutationFn: (data) => api.post("/payroll", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("payroll.runFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.periodStart || !form.periodEnd)
      return setError(t("payroll.errBothDates"));
    mutation.mutate({
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      hoursWorked,
    });
  };

  return (
    <Modal open onClose={onClose} title={t("payroll.runPayroll")}>
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Field
            label={t("payroll.periodStart")}
            htmlFor="period-start"
            className="mb-0"
          >
            <Input
              id="period-start"
              type="date"
              value={form.periodStart}
              onChange={(e) =>
                setForm({ ...form, periodStart: e.target.value })
              }
              required
            />
          </Field>
          <Field
            label={t("payroll.periodEnd")}
            htmlFor="period-end"
            className="mb-0"
          >
            <Input
              id="period-end"
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              required
            />
          </Field>
        </div>

        {hourlyEmployees.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-secondary mb-2">
              {t("payroll.hoursWorkedHourly")}
            </div>
            {hourlyEmployees.map((emp) => (
              <div key={emp.id} className="flex items-center gap-2.5 mb-2">
                <span className="text-md text-ink flex-1">{emp.name}</span>
                <Input
                  type="number"
                  className="w-[100px]"
                  placeholder="0"
                  value={hoursWorked[emp.id] || ""}
                  onChange={(e) =>
                    setHoursWorked({
                      ...hoursWorked,
                      [emp.id]: parseFloat(e.target.value),
                    })
                  }
                />
                <span className="text-xs text-muted">{t("payroll.hrs")}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bg-canvas rounded-lg px-3.5 py-2.5 mb-4 text-md text-secondary">
          <i className="ti ti-users mr-1.5" aria-hidden="true" />
          {t("payroll.willProcess")}{" "}
          <strong className="text-ink">{employees?.length || 0}</strong>{" "}
          {t("payroll.activeEmployeesLower")}
        </div>

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t("payroll.processing")
              : t("payroll.runPayroll")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Payroll Run Detail Modal ──────────────────────────────────
function PayrollRunModal({ run, onClose, fmt, t }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["payroll-run", run.id],
    queryFn: () => api.get(`/payroll/${run.id}`).then((r) => r.data),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => api.put(`/payroll/${run.id}/finalize`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-run", run.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/payroll/${run.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    },
  });

  // status label: "finalized" | "draft" → localized
  const statusLabel = t(`payroll.status.${run.status}`, run.status);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          {t("payroll.payrollRun")}
          <Badge tone={run.status === "finalized" ? "income" : "payroll"}>
            {statusLabel}
          </Badge>
        </span>
      }
    >
      <div className="text-xs text-muted mb-4">
        {dayjs(run.period_start).format("MMM D")} —{" "}
        {dayjs(run.period_end).format("MMM D, YYYY")}
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <StatTile label={t("payroll.totalGross")} value={fmt(run.total_gross)} />
        <StatTile
          label={t("payroll.totalTaxes")}
          value={fmt(run.total_taxes)}
          className="text-expense"
        />
        <StatTile
          label={t("payroll.totalNet")}
          value={fmt(run.total_net)}
          className="text-income"
        />
      </div>

      {isLoading ? (
        <div className="p-5 text-center text-muted">
          {t("payroll.loadingPayslips")}
        </div>
      ) : (
        <div>
          <div className="text-xs font-medium text-secondary mb-2.5">
            {t("payroll.employeePayslips")}
          </div>
          {data?.payslips?.map((ps, i) => (
            <div key={i} className="bg-canvas rounded-lg p-3.5 mb-2">
              <div className="flex justify-between mb-2.5">
                <div className="text-sm font-medium text-ink">
                  {ps.employee_name}
                </div>
                <div className="text-sm font-semibold text-income">
                  {t("payroll.netSuffix", { amount: fmt(ps.net_pay) })}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { label: t("payroll.gross"), value: ps.gross_pay, cls: "text-ink" },
                  {
                    label: t("payroll.federal"),
                    value: ps.federal_tax,
                    cls: "text-expense",
                  },
                  {
                    label: t("payroll.socSec"),
                    value: ps.social_security,
                    cls: "text-expense",
                  },
                  {
                    label: t("payroll.medicare"),
                    value: ps.medicare,
                    cls: "text-expense",
                  },
                  {
                    label: t("payroll.prTax"),
                    value: ps.pr_state_tax,
                    cls: "text-expense",
                  },
                ].map((d) => (
                  <div key={d.label}>
                    <div className="text-[10px] text-muted mb-0.5">
                      {d.label}
                    </div>
                    <div className={cx("text-xs font-medium", d.cls)}>
                      {fmt(d.value)}
                    </div>
                  </div>
                ))}
              </div>
              {ps.hours_worked && (
                <div className="text-[11px] text-muted mt-2">
                  {t("payroll.hoursWorkedLabel", { hours: ps.hours_worked })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-between mt-4">
        {run.status === "draft" && (
          <Button
            variant="danger"
            icon="ti-trash"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              if (
                await confirmDialog({
                  message: t("payroll.confirmDeleteRun"),
                  danger: true,
                })
              )
                deleteMutation.mutate();
            }}
          >
            {t("common.delete")}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={onClose}>{t("common.close")}</Button>
          {run.status === "draft" && (
            <Button
              variant="primary"
              disabled={finalizeMutation.isPending}
              onClick={() => finalizeMutation.mutate()}
            >
              {finalizeMutation.isPending
                ? t("payroll.finalizing")
                : t("payroll.finalizePayroll")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main Payroll Page ─────────────────────────────────────────
export default function Payroll() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fmt = makeFmt(i18n.language);
  const [tab, setTab] = useState("employees");
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [editEmployee, setEditEmployee] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get("/employees").then((r) => r.data),
  });

  const { data: payrollRuns, isLoading: runsLoading } = useQuery({
    queryKey: ["payroll"],
    queryFn: () => api.get("/payroll").then((r) => r.data),
  });

  const { data: ytd } = useQuery({
    queryKey: ["payroll-ytd"],
    queryFn: () => api.get("/payroll/summary/ytd").then((r) => r.data),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => api.delete(`/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  // Localized pay frequency label for the cells (DB stores weekly/biweekly/monthly)
  const freqLabel = (f) => t(`payroll.freqShort.${f}`, f);

  const loadingState = (
    <div className="p-8 text-center text-muted">{t("common.loading")}</div>
  );

  const empStatusBadge = (emp) => (
    <Badge tone={emp.is_active ? "income" : "expense"}>
      {emp.is_active ? t("payroll.active") : t("payroll.inactive")}
    </Badge>
  );

  const runStatusBadge = (run) => (
    <Badge tone={run.status === "finalized" ? "income" : "payroll"}>
      {t(`payroll.status.${run.status}`, run.status)}
    </Badge>
  );

  return (
    <div className="fade-in">
      <PageHeader
        title={t("payroll.title")}
        subtitle={t("payroll.activeEmployeeCount", {
          count: employees?.length || 0,
        })}
        actions={
          <>
            <Button
              icon="ti-user-plus"
              title={t("payroll.addEmployee")}
              onClick={() => {
                setEditEmployee(null);
                setShowEmployeeModal(true);
              }}
            >
              <span className="hidden sm:inline">
                {t("payroll.addEmployee")}
              </span>
            </Button>
            <Button
              variant="primary"
              icon="ti-report-money"
              title={t("payroll.runPayroll")}
              onClick={() => setShowRunModal(true)}
            >
              <span className="hidden sm:inline">{t("payroll.runPayroll")}</span>
            </Button>
          </>
        }
      />

      {/* YTD Summary */}
      {ytd && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 mb-6">
          {[
            { label: t("payroll.ytdGross"), value: fmt(ytd.ytd_gross), cls: "text-ink" },
            {
              label: t("payroll.ytdTaxes"),
              value: fmt(ytd.ytd_taxes),
              cls: "text-expense",
            },
            {
              label: t("payroll.ytdNetPaid"),
              value: fmt(ytd.ytd_net),
              cls: "text-income",
            },
            {
              label: t("payroll.payrollRuns"),
              value: ytd.total_runs,
              cls: "text-payroll",
            },
          ].map((s) => (
            <Card key={s.label} padding="none" className="px-4 py-3.5 min-w-0">
              <div className="text-[11px] text-muted tracking-[1px] uppercase mb-1.5">
                {s.label}
              </div>
              <div className={cx("text-lg font-semibold break-words", s.cls)}>
                {s.value}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs
        className="mb-4"
        tabs={[
          { id: "employees", label: t("payroll.tabEmployees") },
          { id: "runs", label: t("payroll.tabRuns") },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ── EMPLOYEES TAB ── */}
      {tab === "employees" && (
        <div>
          {empLoading ? (
            loadingState
          ) : employees?.length === 0 ? (
            <Card>
              <EmptyState
                icon="ti-users"
                message={t("payroll.noEmployees")}
                action={
                  <Button
                    variant="primary"
                    onClick={() => setShowEmployeeModal(true)}
                  >
                    {t("payroll.addFirstEmployee")}
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="md:hidden flex flex-col gap-2.5">
                {employees.map((emp) => (
                  <Card
                    key={emp.id}
                    padding="none"
                    className={cx("px-4 py-3.5", !emp.is_active && "opacity-60")}
                  >
                    <div className="flex justify-between items-start mb-2.5">
                      <div>
                        <div className="text-sm font-medium text-ink">
                          {emp.name}
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          {emp.email || "—"}
                        </div>
                      </div>
                      {empStatusBadge(emp)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="bg-canvas rounded-md px-2.5 py-2">
                        <div className="text-[10px] text-muted mb-0.5">
                          {t("payroll.payRate")}
                        </div>
                        <div className="text-md font-medium text-ink">
                          {fmt(emp.pay_rate)}
                          {emp.pay_type === "hourly"
                            ? t("payroll.perHr")
                            : t("payroll.perYr")}
                        </div>
                      </div>
                      <div className="bg-canvas rounded-md px-2.5 py-2">
                        <div className="text-[10px] text-muted mb-0.5">
                          {t("payroll.frequency")}
                        </div>
                        <div className="text-md font-medium text-ink">
                          {freqLabel(emp.pay_frequency)}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2.5 justify-end">
                      <button
                        onClick={() => {
                          setEditEmployee(emp);
                          setShowEmployeeModal(true);
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-md text-muted cursor-pointer"
                      >
                        <i className="ti ti-pencil" aria-hidden="true" />{" "}
                        {t("common.edit")}
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            await confirmDialog({
                              message: t("payroll.confirmDeactivate", {
                                name: emp.name,
                              }),
                              confirmLabel: t("payroll.deactivate"),
                              danger: true,
                            })
                          )
                            deactivateMutation.mutate(emp.id);
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-md text-danger cursor-pointer"
                      >
                        <i className="ti ti-user-off" aria-hidden="true" />{" "}
                        {t("payroll.deactivate")}
                      </button>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop table layout */}
              <Card padding="none" className="hidden md:block overflow-hidden">
                <div className="grid grid-cols-[1fr_100px_120px_110px_90px_70px] px-[18px] py-2.5 border-b border-line bg-canvas">
                  {[
                    t("payroll.colEmployee"),
                    t("common.type"),
                    t("payroll.colRate"),
                    t("payroll.frequency"),
                    t("common.status"),
                    "",
                  ].map((h, idx) => (
                    <div
                      key={idx}
                      className="text-[11px] text-muted font-medium tracking-[0.5px]"
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="grid grid-cols-[1fr_100px_120px_110px_90px_70px] px-[18px] py-[var(--row-y)] border-b border-line items-center"
                  >
                    <div>
                      <div className="text-md font-medium text-ink">
                        {emp.name}
                      </div>
                      <div className="text-[11px] text-muted">
                        {emp.email || "—"}
                      </div>
                    </div>
                    <div className="text-xs text-secondary">
                      {t(`payroll.payTypeShort.${emp.pay_type}`, emp.pay_type)}
                    </div>
                    <div className="text-md font-medium text-ink">
                      {fmt(emp.pay_rate)}
                      {emp.pay_type === "hourly"
                        ? t("payroll.perHr")
                        : t("payroll.perYr")}
                    </div>
                    <div className="text-xs text-secondary">
                      {freqLabel(emp.pay_frequency)}
                    </div>
                    <div>{empStatusBadge(emp)}</div>
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => {
                          setEditEmployee(emp);
                          setShowEmployeeModal(true);
                        }}
                        className="p-1 text-muted hover:text-ink cursor-pointer"
                        title={t("common.edit")}
                      >
                        <i
                          className="ti ti-pencil text-[15px]"
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            await confirmDialog({
                              message: t("payroll.confirmDeactivate", {
                                name: emp.name,
                              }),
                              confirmLabel: t("payroll.deactivate"),
                              danger: true,
                            })
                          )
                            deactivateMutation.mutate(emp.id);
                        }}
                        className="p-1 text-danger cursor-pointer"
                        title={t("payroll.deactivate")}
                      >
                        <i
                          className="ti ti-user-off text-[15px]"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── PAYROLL RUNS TAB ── */}
      {tab === "runs" && (
        <div>
          {runsLoading ? (
            loadingState
          ) : payrollRuns?.length === 0 ? (
            <Card>
              <EmptyState
                icon="ti-report-money"
                message={t("payroll.noRuns")}
                action={
                  <Button variant="primary" onClick={() => setShowRunModal(true)}>
                    {t("payroll.runFirst")}
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="md:hidden flex flex-col gap-2.5">
                {payrollRuns.map((run) => (
                  <Card
                    key={run.id}
                    padding="none"
                    className="px-4 py-3.5 cursor-pointer"
                    onClick={() => setSelectedRun(run)}
                  >
                    <div className="flex justify-between items-start mb-2.5">
                      <div>
                        <div className="text-md font-medium text-ink">
                          {dayjs(run.period_start).format("MMM D")} —{" "}
                          {dayjs(run.period_end).format("MMM D, YYYY")}
                        </div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {t("payroll.runOn", {
                            date: dayjs(run.run_date).format("MMM D, YYYY"),
                          })}{" "}
                          ·{" "}
                          {t("payroll.empCount", {
                            count: run.employee_count,
                          })}
                        </div>
                      </div>
                      {runStatusBadge(run)}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          label: t("payroll.gross"),
                          value: run.total_gross,
                          cls: "text-ink",
                        },
                        {
                          label: t("payroll.taxes"),
                          value: run.total_taxes,
                          cls: "text-expense",
                        },
                        {
                          label: t("payroll.net"),
                          value: run.total_net,
                          cls: "text-income",
                        },
                      ].map((s) => (
                        <div
                          key={s.label}
                          className="bg-canvas rounded-md px-2.5 py-2"
                        >
                          <div className="text-[10px] text-muted mb-0.5">
                            {s.label}
                          </div>
                          <div className={cx("text-md font-semibold", s.cls)}>
                            {fmt(s.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop table layout */}
              <Card padding="none" className="hidden md:block overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_110px_110px_90px_70px] px-[18px] py-2.5 border-b border-line bg-canvas">
                  {[
                    t("payroll.colPeriod"),
                    t("payroll.colRunDate"),
                    t("payroll.gross"),
                    t("payroll.net"),
                    t("common.status"),
                    "",
                  ].map((h, idx) => (
                    <div
                      key={idx}
                      className="text-[11px] text-muted font-medium tracking-[0.5px]"
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {payrollRuns.map((run) => (
                  <div
                    key={run.id}
                    className="grid grid-cols-[1fr_1fr_110px_110px_90px_70px] px-[18px] py-[var(--row-y)] border-b border-line items-center cursor-pointer transition-colors hover:bg-canvas"
                    onClick={() => setSelectedRun(run)}
                  >
                    <div className="text-md text-ink">
                      {dayjs(run.period_start).format("MMM D")} —{" "}
                      {dayjs(run.period_end).format("MMM D, YYYY")}
                    </div>
                    <div className="text-xs text-muted">
                      {dayjs(run.run_date).format("MMM D, YYYY")}
                    </div>
                    <div className="text-md font-medium text-ink">
                      {fmt(run.total_gross)}
                    </div>
                    <div className="text-md font-medium text-income">
                      {fmt(run.total_net)}
                    </div>
                    <div>{runStatusBadge(run)}</div>
                    <div className="text-xs text-muted">
                      {t("payroll.empShort", { count: run.employee_count })}
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>
      )}

      {showEmployeeModal && (
        <EmployeeModal
          onClose={() => {
            setShowEmployeeModal(false);
            setEditEmployee(null);
          }}
          editEmployee={editEmployee}
          t={t}
        />
      )}
      {showRunModal && (
        <RunPayrollModal
          onClose={() => setShowRunModal(false)}
          employees={employees}
          t={t}
        />
      )}
      {selectedRun && (
        <PayrollRunModal
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          fmt={fmt}
          t={t}
        />
      )}
    </div>
  );
}
