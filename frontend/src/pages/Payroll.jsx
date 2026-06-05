import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import dayjs from "dayjs";

const fmt = (val, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    val || 0,
  );

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
function EmployeeModal({ onClose, editEmployee }) {
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
      setError(err.response?.data?.error || "Failed to save employee"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.name) return setError("Name is required");
    if (!form.payRate || form.payRate <= 0)
      return setError("Pay rate must be greater than 0");
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
            {editEmployee ? "Edit Employee" : "New Employee"}
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
            Basic Info
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
                Full Name
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
                Email
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
                SSN Last 4 Digits
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
                Start Date
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
            Pay Info
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
                Pay Type
              </label>
              <select
                id="emp-paytype"
                className="input"
                value={form.payType}
                onChange={(e) => setForm({ ...form, payType: e.target.value })}
              >
                <option value="salary">Salary (annual)</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="emp-payrate">
                {form.payType === "salary" ? "Annual Salary" : "Hourly Rate"}
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
              Pay Frequency
            </label>
            <select
              id="emp-freq"
              className="input"
              value={form.payFrequency}
              onChange={(e) =>
                setForm({ ...form, payFrequency: e.target.value })
              }
            >
              <option value="weekly">Weekly (52x/year)</option>
              <option value="biweekly">Bi-weekly (26x/year)</option>
              <option value="monthly">Monthly (12x/year)</option>
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
            Tax Info
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
                Federal Tax Exempt
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Most PR residents are exempt from federal income tax
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
                PR State Tax Rate
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
                Federal Filing Status
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
                <option value="single">Single</option>
                <option value="married">Married</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? "Saving..."
                : editEmployee
                  ? "Save changes"
                  : "Add employee"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Run Payroll Modal ─────────────────────────────────────────
function RunPayrollModal({ onClose, employees }) {
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
      setError(err.response?.data?.error || "Failed to run payroll"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.periodStart || !form.periodEnd)
      return setError("Both dates are required");
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
            Run Payroll
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
                Period Start
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
                Period End
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
                Hours Worked (Hourly Employees)
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
                    hrs
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
            Will process{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {employees?.length || 0}
            </strong>{" "}
            active employees
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Processing..." : "Run Payroll"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Payroll Run Detail Modal ──────────────────────────────────
function PayrollRunModal({ run, onClose }) {
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
              Payroll Run
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
                textTransform: "capitalize",
              }}
            >
              {run.status}
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
              label: "Total Gross",
              value: run.total_gross,
              color: "var(--text-primary)",
            },
            {
              label: "Total Taxes",
              value: run.total_taxes,
              color: "var(--expense)",
            },
            {
              label: "Total Net",
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
            Loading payslips...
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
              Employee Payslips
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
                    {fmt(ps.net_pay)} net
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
                      label: "Gross",
                      value: ps.gross_pay,
                      color: "var(--text-primary)",
                    },
                    {
                      label: "Federal",
                      value: ps.federal_tax,
                      color: "var(--expense)",
                    },
                    {
                      label: "Soc. Sec.",
                      value: ps.social_security,
                      color: "var(--expense)",
                    },
                    {
                      label: "Medicare",
                      value: ps.medicare,
                      color: "var(--expense)",
                    },
                    {
                      label: "PR Tax",
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
                    Hours worked: {ps.hours_worked}
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
                if (window.confirm("Delete this payroll run?"))
                  deleteMutation.mutate();
              }}
              className="btn btn-danger"
              disabled={deleteMutation.isPending}
            >
              <i className="ti ti-trash" aria-hidden="true" /> Delete
            </button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
            {run.status === "draft" && (
              <button
                onClick={() => finalizeMutation.mutate()}
                className="btn btn-primary"
                disabled={finalizeMutation.isPending}
              >
                {finalizeMutation.isPending
                  ? "Finalizing..."
                  : "Finalize Payroll"}
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
  const queryClient = useQueryClient();
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
            Payroll
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {employees?.length || 0} active employees
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
            {!isMobile && " Add Employee"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowRunModal(true)}
          >
            <i className="ti ti-report-money" aria-hidden="true" />
            {!isMobile && " Run Payroll"}
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
              label: "YTD Gross",
              value: ytd.ytd_gross,
              color: "var(--text-primary)",
            },
            {
              label: "YTD Taxes",
              value: ytd.ytd_taxes,
              color: "var(--expense)",
            },
            {
              label: "YTD Net Paid",
              value: ytd.ytd_net,
              color: "var(--income)",
            },
            {
              label: "Payroll Runs",
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
        {["employees", "runs"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: tab === t ? "var(--brand)" : "var(--text-muted)",
              borderBottom:
                tab === t ? "2px solid var(--brand)" : "2px solid transparent",
              fontWeight: tab === t ? 500 : 400,
              textTransform: "capitalize",
            }}
          >
            {t === "runs" ? "Payroll Runs" : "Employees"}
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
              Loading...
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
                No employees yet
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => setShowEmployeeModal(true)}
              >
                Add your first employee
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
                      {emp.is_active ? "Active" : "Inactive"}
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
                        Pay Rate
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        {fmt(emp.pay_rate)}
                        {emp.pay_type === "hourly" ? "/hr" : "/yr"}
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
                        Frequency
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          textTransform: "capitalize",
                        }}
                      >
                        {emp.pay_frequency}
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
                      <i className="ti ti-pencil" aria-hidden="true" /> Edit
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Deactivate ${emp.name}?`))
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
                      Deactivate
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
                {["Employee", "Type", "Rate", "Frequency", "Status", ""].map(
                  (h) => (
                    <div
                      key={h}
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontWeight: 500,
                        letterSpacing: 0.5,
                      }}
                    >
                      {h}
                    </div>
                  ),
                )}
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
                      textTransform: "capitalize",
                    }}
                  >
                    {emp.pay_type}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {fmt(emp.pay_rate)}
                    {emp.pay_type === "hourly" ? "/hr" : "/yr"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      textTransform: "capitalize",
                    }}
                  >
                    {emp.pay_frequency}
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
                      {emp.is_active ? "Active" : "Inactive"}
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
                      title="Edit"
                    >
                      <i
                        className="ti ti-pencil"
                        style={{ fontSize: 15 }}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Deactivate ${emp.name}?`))
                          deactivateMutation.mutate(emp.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--danger)",
                        padding: 4,
                      }}
                      title="Deactivate"
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
              Loading...
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
                No payroll runs yet
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => setShowRunModal(true)}
              >
                Run your first payroll
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
                        Run on {dayjs(run.run_date).format("MMM D, YYYY")} ·{" "}
                        {run.employee_count} employees
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
                        textTransform: "capitalize",
                      }}
                    >
                      {run.status}
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
                        label: "Gross",
                        value: run.total_gross,
                        color: "var(--text-primary)",
                      },
                      {
                        label: "Taxes",
                        value: run.total_taxes,
                        color: "var(--expense)",
                      },
                      {
                        label: "Net",
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
                {["Period", "Run Date", "Gross", "Net", "Status", ""].map(
                  (h) => (
                    <div
                      key={h}
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontWeight: 500,
                        letterSpacing: 0.5,
                      }}
                    >
                      {h}
                    </div>
                  ),
                )}
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
                        textTransform: "capitalize",
                      }}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {run.employee_count} emp
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
        />
      )}
      {showRunModal && (
        <RunPayrollModal
          onClose={() => setShowRunModal(false)}
          employees={employees}
        />
      )}
      {selectedRun && (
        <PayrollRunModal
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  );
}
