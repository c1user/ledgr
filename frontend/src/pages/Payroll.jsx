import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";

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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {editEmployee
              ? t("payroll.editEmployee")
              : t("payroll.newEmployee")}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 20,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "0.5px solid var(--danger)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i
              className="ti ti-alert-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: 1,
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            {t("payroll.basicInfo")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <label className="label" htmlFor="emp-name">
                {t("payroll.fullName")}
              </label>
              <input
                id="emp-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Maria Lopez"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label" htmlFor="emp-email">
                {t("common.email")}
              </label>
              <input
                id="emp-email"
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="maria@example.com"
              />
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div>
              <label className="label" htmlFor="emp-ssn">
                {t("payroll.ssnLast4")}
              </label>
              <input
                id="emp-ssn"
                className="input"
                value={form.ssnLast4}
                onChange={(e) => setForm({ ...form, ssnLast4: e.target.value })}
                placeholder="1234"
                maxLength={4}
              />
            </div>
            <div>
              <label className="label" htmlFor="emp-start">
                {t("payroll.startDate")}
              </label>
              <input
                id="emp-start"
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
                required
              />
            </div>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: 1,
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            {t("payroll.payInfo")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <label className="label" htmlFor="emp-paytype">
                {t("payroll.payType")}
              </label>
              <select
                id="emp-paytype"
                className="input"
                value={form.payType}
                onChange={(e) => setForm({ ...form, payType: e.target.value })}
              >
                <option value="salary">{t("payroll.payTypeSalary")}</option>
                <option value="hourly">{t("payroll.payTypeHourly")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="emp-payrate">
                {form.payType === "salary"
                  ? t("payroll.annualSalary")
                  : t("payroll.hourlyRate")}
              </label>
              <input
                id="emp-payrate"
                className="input"
                type="number"
                step="0.01"
                value={form.payRate}
                onChange={(e) => setForm({ ...form, payRate: e.target.value })}
                placeholder={form.payType === "salary" ? "42000" : "18.50"}
                required
              />
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label className="label" htmlFor="emp-freq">
              {t("payroll.payFrequency")}
            </label>
            <select
              id="emp-freq"
              className="input"
              value={form.payFrequency}
              onChange={(e) =>
                setForm({ ...form, payFrequency: e.target.value })
              }
            >
              <option value="weekly">{t("payroll.freqWeekly")}</option>
              <option value="biweekly">{t("payroll.freqBiweekly")}</option>
              <option value="monthly">{t("payroll.freqMonthly")}</option>
            </select>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: 1,
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            {t("payroll.taxInfo")}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: "var(--bg-secondary)",
              borderRadius: 8,
              marginBottom: 14,
            }}
          >
            <button
              type="button"
              onClick={() =>
                setForm({ ...form, federalExempt: !form.federalExempt })
              }
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: form.federalExempt
                  ? "var(--brand)"
                  : "var(--border-color)",
                border: "none",
                cursor: "pointer",
                position: "relative",
                flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 3,
                  left: form.federalExempt ? 18 : 3,
                  width: 14,
                  height: 14,
                  background: "#fff",
                  borderRadius: "50%",
                  transition: "left 0.2s",
                }}
              />
            </button>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                {t("payroll.federalExempt")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t("payroll.federalExemptHint")}
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div>
              <label className="label" htmlFor="emp-pr-rate">
                {t("payroll.prStateTaxRate")}
              </label>
              <input
                id="emp-pr-rate"
                className="input"
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={form.prStateTaxRate}
                onChange={(e) =>
                  setForm({ ...form, prStateTaxRate: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="emp-filing">
                {t("payroll.federalFilingStatus")}
              </label>
              <select
                id="emp-filing"
                className="input"
                value={form.federalFilingStatus}
                onChange={(e) =>
                  setForm({ ...form, federalFilingStatus: e.target.value })
                }
                disabled={form.federalExempt}
              >
                <option value="single">{t("payroll.filingSingle")}</option>
                <option value="married">{t("payroll.filingMarried")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t("payroll.saving")
                : editEmployee
                  ? t("payroll.saveChanges")
                  : t("payroll.addEmployee")}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card fade-in"
        style={{ width: "100%", maxWidth: 460, padding: 24 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {t("payroll.runPayroll")}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 20,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "0.5px solid var(--danger)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i
              className="ti ti-alert-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <label className="label" htmlFor="period-start">
                {t("payroll.periodStart")}
              </label>
              <input
                id="period-start"
                className="input"
                type="date"
                value={form.periodStart}
                onChange={(e) =>
                  setForm({ ...form, periodStart: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="period-end">
                {t("payroll.periodEnd")}
              </label>
              <input
                id="period-end"
                className="input"
                type="date"
                value={form.periodEnd}
                onChange={(e) =>
                  setForm({ ...form, periodEnd: e.target.value })
                }
                required
              />
            </div>
          </div>

          {hourlyEmployees.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                }}
              >
                {t("payroll.hoursWorkedHourly")}
              </div>
              {hourlyEmployees.map((emp) => (
                <div
                  key={emp.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-primary)",
                      flex: 1,
                    }}
                  >
                    {emp.name}
                  </span>
                  <input
                    className="input"
                    type="number"
                    style={{ width: 100 }}
                    placeholder="0"
                    value={hoursWorked[emp.id] || ""}
                    onChange={(e) =>
                      setHoursWorked({
                        ...hoursWorked,
                        [emp.id]: parseFloat(e.target.value),
                      })
                    }
                  />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("payroll.hrs")}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              background: "var(--bg-secondary)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            <i
              className="ti ti-users"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {t("payroll.willProcess")}{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {employees?.length || 0}
            </strong>{" "}
            {t("payroll.activeEmployeesLower")}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t("payroll.processing")
                : t("payroll.runPayroll")}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 600,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {t("payroll.payrollRun")}
            </h2>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}
            >
              {dayjs(run.period_start).format("MMM D")} —{" "}
              {dayjs(run.period_end).format("MMM D, YYYY")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 4,
                fontWeight: 500,
                background:
                  run.status === "finalized"
                    ? "var(--income-bg)"
                    : "var(--payroll-bg)",
                color:
                  run.status === "finalized"
                    ? "var(--income)"
                    : "var(--payroll)",
              }}
            >
              {statusLabel}
            </span>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: 20,
              }}
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {[
            {
              label: t("payroll.totalGross"),
              value: run.total_gross,
              color: "var(--text-primary)",
            },
            {
              label: t("payroll.totalTaxes"),
              value: run.total_taxes,
              color: "var(--expense)",
            },
            {
              label: t("payroll.totalNet"),
              value: run.total_net,
              color: "var(--income)",
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 4,
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>
                {fmt(s.value)}
              </div>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            {t("payroll.loadingPayslips")}
          </div>
        ) : (
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text-secondary)",
                marginBottom: 10,
              }}
            >
              {t("payroll.employeePayslips")}
            </div>
            {data?.payslips?.map((ps, i) => (
              <div
                key={i}
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: 8,
                  padding: "14px",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {ps.employee_name}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--income)",
                    }}
                  >
                    {t("payroll.netSuffix", { amount: fmt(ps.net_pay) })}
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: 8,
                  }}
                >
                  {[
                    {
                      label: t("payroll.gross"),
                      value: ps.gross_pay,
                      color: "var(--text-primary)",
                    },
                    {
                      label: t("payroll.federal"),
                      value: ps.federal_tax,
                      color: "var(--expense)",
                    },
                    {
                      label: t("payroll.socSec"),
                      value: ps.social_security,
                      color: "var(--expense)",
                    },
                    {
                      label: t("payroll.medicare"),
                      value: ps.medicare,
                      color: "var(--expense)",
                    },
                    {
                      label: t("payroll.prTax"),
                      value: ps.pr_state_tax,
                      color: "var(--expense)",
                    },
                  ].map((d) => (
                    <div key={d.label}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          marginBottom: 2,
                        }}
                      >
                        {d.label}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: d.color,
                        }}
                      >
                        {fmt(d.value)}
                      </div>
                    </div>
                  ))}
                </div>
                {ps.hours_worked && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 8,
                    }}
                  >
                    {t("payroll.hoursWorkedLabel", { hours: ps.hours_worked })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            marginTop: 16,
          }}
        >
          {run.status === "draft" && (
            <button
              onClick={() => {
                if (window.confirm(t("payroll.confirmDeleteRun")))
                  deleteMutation.mutate();
              }}
              className="btn btn-danger"
              disabled={deleteMutation.isPending}
            >
              <i className="ti ti-trash" aria-hidden="true" />{" "}
              {t("common.delete")}
            </button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={onClose} className="btn btn-secondary">
              {t("common.close")}
            </button>
            {run.status === "draft" && (
              <button
                onClick={() => finalizeMutation.mutate()}
                className="btn btn-primary"
                disabled={finalizeMutation.isPending}
              >
                {finalizeMutation.isPending
                  ? t("payroll.finalizing")
                  : t("payroll.finalizePayroll")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  return (
    <div className="fade-in">
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 4,
            }}
          >
            {t("payroll.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("payroll.activeEmployeeCount", {
              count: employees?.length || 0,
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setEditEmployee(null);
              setShowEmployeeModal(true);
            }}
          >
            <i className="ti ti-user-plus" aria-hidden="true" />
            {!isMobile && ` ${t("payroll.addEmployee")}`}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowRunModal(true)}
          >
            <i className="ti ti-report-money" aria-hidden="true" />
            {!isMobile && ` ${t("payroll.runPayroll")}`}
          </button>
        </div>
      </div>

      {/* YTD Summary */}
      {ytd && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[
            {
              label: t("payroll.ytdGross"),
              value: ytd.ytd_gross,
              color: "var(--text-primary)",
            },
            {
              label: t("payroll.ytdTaxes"),
              value: ytd.ytd_taxes,
              color: "var(--expense)",
            },
            {
              label: t("payroll.ytdNetPaid"),
              value: ytd.ytd_net,
              color: "var(--income)",
            },
            {
              label: t("payroll.payrollRuns"),
              value: ytd.total_runs,
              color: "var(--payroll)",
              isCount: true,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="card"
              style={{ padding: "14px 16px" }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  letterSpacing: 1,
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>
                {s.isCount ? s.value : fmt(s.value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "0.5px solid var(--border-color)",
        }}
      >
        {["employees", "runs"].map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: tab === tabKey ? "var(--brand)" : "var(--text-muted)",
              borderBottom:
                tab === tabKey
                  ? "2px solid var(--brand)"
                  : "2px solid transparent",
              fontWeight: tab === tabKey ? 500 : 400,
            }}
          >
            {tabKey === "runs"
              ? t("payroll.tabRuns")
              : t("payroll.tabEmployees")}
          </button>
        ))}
      </div>

      {/* ── EMPLOYEES TAB ── */}
      {tab === "employees" && (
        <div>
          {empLoading ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              {t("common.loading")}
            </div>
          ) : employees?.length === 0 ? (
            <div className="card" style={{ padding: 48, textAlign: "center" }}>
              <i
                className="ti ti-users"
                style={{ fontSize: 40, color: "var(--text-muted)" }}
                aria-hidden="true"
              />
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  marginTop: 12,
                }}
              >
                {t("payroll.noEmployees")}
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => setShowEmployeeModal(true)}
              >
                {t("payroll.addFirstEmployee")}
              </button>
            </div>
          ) : isMobile ? (
            // Mobile card layout
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  className="card"
                  style={{
                    padding: "14px 16px",
                    opacity: emp.is_active ? 1 : 0.6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        {emp.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {emp.email || "—"}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 500,
                        background: emp.is_active
                          ? "var(--income-bg)"
                          : "var(--expense-bg)",
                        color: emp.is_active
                          ? "var(--income)"
                          : "var(--expense)",
                      }}
                    >
                      {emp.is_active
                        ? t("payroll.active")
                        : t("payroll.inactive")}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        background: "var(--bg-secondary)",
                        borderRadius: 6,
                        padding: "8px 10px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          marginBottom: 2,
                        }}
                      >
                        {t("payroll.payRate")}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        {fmt(emp.pay_rate)}
                        {emp.pay_type === "hourly"
                          ? t("payroll.perHr")
                          : t("payroll.perYr")}
                      </div>
                    </div>
                    <div
                      style={{
                        background: "var(--bg-secondary)",
                        borderRadius: 6,
                        padding: "8px 10px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          marginBottom: 2,
                        }}
                      >
                        {t("payroll.frequency")}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        {freqLabel(emp.pay_frequency)}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      onClick={() => {
                        setEditEmployee(emp);
                        setShowEmployeeModal(true);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 8px",
                      }}
                    >
                      <i className="ti ti-pencil" aria-hidden="true" />{" "}
                      {t("common.edit")}
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            t("payroll.confirmDeactivate", { name: emp.name }),
                          )
                        )
                          deactivateMutation.mutate(emp.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--danger)",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 8px",
                      }}
                    >
                      <i className="ti ti-user-off" aria-hidden="true" />{" "}
                      {t("payroll.deactivate")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Desktop table layout
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 120px 110px 90px 70px",
                  padding: "10px 18px",
                  borderBottom: "0.5px solid var(--border-color)",
                  background: "var(--bg-secondary)",
                }}
              >
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
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontWeight: 500,
                      letterSpacing: 0.5,
                    }}
                  >
                    {h}
                  </div>
                ))}
              </div>
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 120px 110px 90px 70px",
                    padding: "12px 18px",
                    borderBottom: "0.5px solid var(--border-color)",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {emp.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {emp.email || "—"}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {t(`payroll.payTypeShort.${emp.pay_type}`, emp.pay_type)}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {fmt(emp.pay_rate)}
                    {emp.pay_type === "hourly"
                      ? t("payroll.perHr")
                      : t("payroll.perYr")}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {freqLabel(emp.pay_frequency)}
                  </div>
                  <div>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 500,
                        background: emp.is_active
                          ? "var(--income-bg)"
                          : "var(--expense-bg)",
                        color: emp.is_active
                          ? "var(--income)"
                          : "var(--expense)",
                      }}
                    >
                      {emp.is_active
                        ? t("payroll.active")
                        : t("payroll.inactive")}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      onClick={() => {
                        setEditEmployee(emp);
                        setShowEmployeeModal(true);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        padding: 4,
                      }}
                      title={t("common.edit")}
                    >
                      <i
                        className="ti ti-pencil"
                        style={{ fontSize: 15 }}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            t("payroll.confirmDeactivate", { name: emp.name }),
                          )
                        )
                          deactivateMutation.mutate(emp.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--danger)",
                        padding: 4,
                      }}
                      title={t("payroll.deactivate")}
                    >
                      <i
                        className="ti ti-user-off"
                        style={{ fontSize: 15 }}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PAYROLL RUNS TAB ── */}
      {tab === "runs" && (
        <div>
          {runsLoading ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              {t("common.loading")}
            </div>
          ) : payrollRuns?.length === 0 ? (
            <div className="card" style={{ padding: 48, textAlign: "center" }}>
              <i
                className="ti ti-report-money"
                style={{ fontSize: 40, color: "var(--text-muted)" }}
                aria-hidden="true"
              />
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  marginTop: 12,
                }}
              >
                {t("payroll.noRuns")}
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => setShowRunModal(true)}
              >
                {t("payroll.runFirst")}
              </button>
            </div>
          ) : isMobile ? (
            // Mobile card layout
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {payrollRuns.map((run) => (
                <div
                  key={run.id}
                  className="card"
                  style={{ padding: "14px 16px", cursor: "pointer" }}
                  onClick={() => setSelectedRun(run)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        {dayjs(run.period_start).format("MMM D")} —{" "}
                        {dayjs(run.period_end).format("MMM D, YYYY")}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {t("payroll.runOn", {
                          date: dayjs(run.run_date).format("MMM D, YYYY"),
                        })}{" "}
                        · {t("payroll.empCount", { count: run.employee_count })}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 500,
                        background:
                          run.status === "finalized"
                            ? "var(--income-bg)"
                            : "var(--payroll-bg)",
                        color:
                          run.status === "finalized"
                            ? "var(--income)"
                            : "var(--payroll)",
                      }}
                    >
                      {t(`payroll.status.${run.status}`, run.status)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 8,
                    }}
                  >
                    {[
                      {
                        label: t("payroll.gross"),
                        value: run.total_gross,
                        color: "var(--text-primary)",
                      },
                      {
                        label: t("payroll.taxes"),
                        value: run.total_taxes,
                        color: "var(--expense)",
                      },
                      {
                        label: t("payroll.net"),
                        value: run.total_net,
                        color: "var(--income)",
                      },
                    ].map((s) => (
                      <div
                        key={s.label}
                        style={{
                          background: "var(--bg-secondary)",
                          borderRadius: 6,
                          padding: "8px 10px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--text-muted)",
                            marginBottom: 2,
                          }}
                        >
                          {s.label}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: s.color,
                          }}
                        >
                          {fmt(s.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Desktop table layout
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 110px 110px 90px 70px",
                  padding: "10px 18px",
                  borderBottom: "0.5px solid var(--border-color)",
                  background: "var(--bg-secondary)",
                }}
              >
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
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontWeight: 500,
                      letterSpacing: 0.5,
                    }}
                  >
                    {h}
                  </div>
                ))}
              </div>
              {payrollRuns.map((run) => (
                <div
                  key={run.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 110px 110px 90px 70px",
                    padding: "12px 18px",
                    borderBottom: "0.5px solid var(--border-color)",
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-secondary)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                  onClick={() => setSelectedRun(run)}
                >
                  <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                    {dayjs(run.period_start).format("MMM D")} —{" "}
                    {dayjs(run.period_end).format("MMM D, YYYY")}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {dayjs(run.run_date).format("MMM D, YYYY")}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {fmt(run.total_gross)}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--income)",
                    }}
                  >
                    {fmt(run.total_net)}
                  </div>
                  <div>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 500,
                        background:
                          run.status === "finalized"
                            ? "var(--income-bg)"
                            : "var(--payroll-bg)",
                        color:
                          run.status === "finalized"
                            ? "var(--income)"
                            : "var(--payroll)",
                      }}
                    >
                      {t(`payroll.status.${run.status}`, run.status)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("payroll.empShort", { count: run.employee_count })}
                  </div>
                </div>
              ))}
            </div>
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
