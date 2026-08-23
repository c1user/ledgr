import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  RunPayrollV2Modal,
  RunV2DetailModal,
  BonusEligibilityPanel,
} from "../components/payroll/RunV2Modals";
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
  ssn: "",
  position: "",
  address: "",
  addressCity: "",
  addressState: "PR",
  addressZip: "",
  payType: "salary",
  payRate: "",
  payFrequency: "biweekly",
  classification: "exempt_salaried",
  isChauffeur: false,
  exemptionStatus: "none",
  allowances: 0,
  additionalWithholding: "",
  startDate: dayjs().format("YYYY-MM-DD"),
};

// Uppercase section label inside modals.
function SectionLabel({ children }) {
  return (
    <div className="text-[11px] text-muted tracking-[1px] uppercase mb-2.5">
      {children}
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
          ssn: "", // write-only: blank = keep the SSN on file
          position: editEmployee.position || "",
          address: editEmployee.address || "",
          addressCity: editEmployee.address_city || "",
          addressState: editEmployee.address_state || "PR",
          addressZip: editEmployee.address_zip || "",
          payType: editEmployee.pay_type,
          payRate: editEmployee.pay_rate,
          payFrequency: editEmployee.pay_frequency,
          classification:
            editEmployee.classification ||
            (editEmployee.pay_type === "hourly"
              ? "nonexempt_hourly"
              : "exempt_salaried"),
          isChauffeur: editEmployee.is_chauffeur ?? false,
          exemptionStatus:
            editEmployee.elections_499r4?.exemption_status || "none",
          allowances: editEmployee.elections_499r4?.allowances || 0,
          additionalWithholding:
            editEmployee.elections_499r4?.additional_withholding_cents != null
              ? (
                  editEmployee.elections_499r4.additional_withholding_cents /
                  100
                ).toFixed(2)
              : "",
          startDate: dayjs(editEmployee.start_date).format("YYYY-MM-DD"),
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
    if (form.ssn && !/^\d{3}-?\d{2}-?\d{4}$/.test(form.ssn.trim()))
      return setError(t("payroll.errSsn"));

    const additionalCents = form.additionalWithholding
      ? Math.round(parseFloat(form.additionalWithholding) * 100)
      : 0;

    const payload = {
      name: form.name,
      email: form.email,
      position: form.position,
      address: form.address,
      addressCity: form.addressCity,
      addressState: form.addressState,
      addressZip: form.addressZip,
      payType: form.payType,
      payRate: parseFloat(form.payRate),
      payFrequency: form.payFrequency,
      classification: form.classification,
      isChauffeur: form.isChauffeur,
      elections499r4: {
        exemption_status: form.exemptionStatus,
        allowances: parseInt(form.allowances || 0),
        additional_withholding_cents: Number.isFinite(additionalCents)
          ? additionalCents
          : 0,
      },
      startDate: form.startDate,
    };
    // SSN is write-only: only send when the user typed one.
    if (form.ssn) payload.ssn = form.ssn.trim();

    mutation.mutate(payload);
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
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field label={t("payroll.ssnFull")} htmlFor="emp-ssn" className="mb-0">
            <Input
              id="emp-ssn"
              type="password"
              autoComplete="off"
              value={form.ssn}
              onChange={(e) => setForm({ ...form, ssn: e.target.value })}
              placeholder={
                editEmployee?.ssn_last4 || editEmployee?.has_ssn
                  ? t("payroll.ssnKeepPlaceholder")
                  : "***-**-****"
              }
              maxLength={11}
            />
            <div className="text-[11px] text-muted mt-1">
              {t("payroll.ssnHint")}
            </div>
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
        <Field
          label={t("payroll.position")}
          htmlFor="emp-position"
          className="mb-3.5"
          hint={t("payroll.positionHint")}
        >
          <Input
            id="emp-position"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
            placeholder={t("payroll.positionPlaceholder")}
          />
        </Field>
        <Field
          label={t("payroll.address")}
          htmlFor="emp-address"
          className="mb-3.5"
        >
          <Input
            id="emp-address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder={t("payroll.addressPlaceholder")}
          />
        </Field>
        <div className="grid grid-cols-[1fr_90px_110px] gap-3 mb-5">
          <Field
            label={t("payroll.addressCity")}
            htmlFor="emp-city"
            className="mb-0"
          >
            <Input
              id="emp-city"
              value={form.addressCity}
              onChange={(e) =>
                setForm({ ...form, addressCity: e.target.value })
              }
            />
          </Field>
          <Field
            label={t("payroll.addressState")}
            htmlFor="emp-state"
            className="mb-0"
          >
            <Input
              id="emp-state"
              value={form.addressState}
              onChange={(e) =>
                setForm({ ...form, addressState: e.target.value })
              }
            />
          </Field>
          <Field
            label={t("payroll.addressZip")}
            htmlFor="emp-zip"
            className="mb-0"
          >
            <Input
              id="emp-zip"
              value={form.addressZip}
              onChange={(e) => setForm({ ...form, addressZip: e.target.value })}
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
            <option value="semimonthly">{t("payroll.freqSemimonthly")}</option>
            <option value="monthly">{t("payroll.freqMonthly")}</option>
          </Select>
        </Field>

        <SectionLabel>{t("payroll.prSection")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field
            label={t("payroll.classification")}
            htmlFor="emp-class"
            className="mb-0"
          >
            <Select
              id="emp-class"
              value={form.classification}
              onChange={(e) =>
                setForm({ ...form, classification: e.target.value })
              }
            >
              <option value="nonexempt_hourly">
                {t("payroll.classNonexempt")}
              </option>
              <option value="exempt_salaried">
                {t("payroll.classExempt")}
              </option>
            </Select>
          </Field>
          <Field
            label={t("payroll.exemptionStatus")}
            htmlFor="emp-exemption"
            className="mb-0"
          >
            <Select
              id="emp-exemption"
              value={form.exemptionStatus}
              onChange={(e) =>
                setForm({ ...form, exemptionStatus: e.target.value })
              }
            >
              <option value="none">{t("payroll.exemptionNone")}</option>
              <option value="complete">
                {t("payroll.exemptionComplete")}
              </option>
              <option value="half_joint">
                {t("payroll.exemptionHalfJoint")}
              </option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field
            label={t("payroll.allowances499")}
            htmlFor="emp-allowances"
            className="mb-0"
          >
            <Input
              id="emp-allowances"
              type="number"
              min="0"
              value={form.allowances}
              onChange={(e) => setForm({ ...form, allowances: e.target.value })}
            />
          </Field>
          <Field
            label={t("payroll.additionalWithholding")}
            htmlFor="emp-addl-wh"
            className="mb-0"
          >
            <Input
              id="emp-addl-wh"
              type="number"
              step="0.01"
              min="0"
              value={form.additionalWithholding}
              onChange={(e) =>
                setForm({ ...form, additionalWithholding: e.target.value })
              }
              placeholder="0.00"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-canvas rounded-lg mb-5">
          <Toggle
            checked={form.isChauffeur}
            onChange={() =>
              setForm({ ...form, isChauffeur: !form.isChauffeur })
            }
            aria-label={t("payroll.isChauffeur")}
          />
          <div>
            <div className="text-md font-medium text-ink">
              {t("payroll.isChauffeur")}
            </div>
            <div className="text-[11px] text-muted">
              {t("payroll.isChauffeurHint")}
            </div>
          </div>
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

// ── Employer Profile Modal (ROADMAP-V5 Phase 2.1) ─────────────
// The employer's compliance identity: agency account numbers used by
// filings and exports. EIN is read-only here (Business Profile owns it).
function EmployerProfileModal({ onClose, t }) {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["payroll-profile"],
    queryFn: () => api.get("/payroll-profile").then((r) => r.data),
  });
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");

  // Initialize once the profile loads.
  if (profile && form === null) {
    setForm({
      merchantRegNo: profile.merchant_reg_no || "",
      suriAccountRef: profile.suri_account_ref || "",
      dtrhEmployerNo: profile.dtrh_employer_no || "",
      cfsePolicyNo: profile.cfse_policy_no || "",
      defaultPayFrequency: profile.default_pay_frequency || "biweekly",
      sizeBand: profile.size_band || "",
      defaultMunicipality: profile.default_municipality || "",
      checkOffsetXMm: profile.check_offset_x_mm ?? 0,
      checkOffsetYMm: profile.check_offset_y_mm ?? 0,
    });
  }

  const mutation = useMutation({
    mutationFn: (data) => api.put("/payroll-profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-profile"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("payroll.profileSaveFailed")),
  });

  const fields = [
    ["merchantRegNo", "payroll.merchantRegNo"],
    ["suriAccountRef", "payroll.suriAccountRef"],
    ["dtrhEmployerNo", "payroll.dtrhEmployerNo"],
    ["cfsePolicyNo", "payroll.cfsePolicyNo"],
  ];

  return (
    <Modal open onClose={onClose} title={t("payroll.employerProfile")}>
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      {!form ? (
        <div className="p-6 text-center text-muted">{t("common.loading")}</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            mutation.mutate({
              ...form,
              sizeBand: form.sizeBand || null,
              defaultMunicipality: form.defaultMunicipality || null,
              checkOffsetXMm: Number(form.checkOffsetXMm) || 0,
              checkOffsetYMm: Number(form.checkOffsetYMm) || 0,
            });
          }}
        >
          <div className="bg-canvas rounded-lg px-3.5 py-2.5 mb-4 text-md text-secondary">
            <span className="text-[11px] text-muted mr-2 uppercase tracking-[0.5px]">
              {t("payroll.ein")}
            </span>
            <strong className="text-ink">{profile?.ein || "—"}</strong>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3.5">
            {fields.map(([key, labelKey]) => (
              <Field
                key={key}
                label={t(labelKey)}
                htmlFor={`prof-${key}`}
                className="mb-0"
              >
                <Input
                  id={`prof-${key}`}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3.5">
            <Field
              label={t("payroll.checkOffsetX")}
              htmlFor="prof-offx"
              className="mb-0"
            >
              <Input
                id="prof-offx"
                type="number"
                step="0.5"
                min="-50"
                max="50"
                value={form.checkOffsetXMm}
                onChange={(e) =>
                  setForm({ ...form, checkOffsetXMm: e.target.value })
                }
              />
            </Field>
            <Field
              label={t("payroll.checkOffsetY")}
              htmlFor="prof-offy"
              className="mb-0"
            >
              <Input
                id="prof-offy"
                type="number"
                step="0.5"
                min="-50"
                max="50"
                value={form.checkOffsetYMm}
                onChange={(e) =>
                  setForm({ ...form, checkOffsetYMm: e.target.value })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <Field
              label={t("payroll.defaultPayFrequency")}
              htmlFor="prof-freq"
              className="mb-0"
            >
              <Select
                id="prof-freq"
                value={form.defaultPayFrequency}
                onChange={(e) =>
                  setForm({ ...form, defaultPayFrequency: e.target.value })
                }
              >
                <option value="weekly">{t("payroll.freqWeekly")}</option>
                <option value="biweekly">{t("payroll.freqBiweekly")}</option>
                <option value="semimonthly">
                  {t("payroll.freqSemimonthly")}
                </option>
                <option value="monthly">{t("payroll.freqMonthly")}</option>
              </Select>
            </Field>
            <Field
              label={t("payroll.defaultMunicipality")}
              htmlFor="prof-muni"
              className="mb-0"
            >
              <Input
                id="prof-muni"
                value={form.defaultMunicipality}
                onChange={(e) =>
                  setForm({ ...form, defaultMunicipality: e.target.value })
                }
                placeholder="San Juan"
              />
            </Field>
          </div>

          <div className="flex gap-2 justify-end">
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={mutation.isPending}
            >
              {t("common.save")}
            </Button>
          </div>
        </form>
      )}
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedV2RunId, setSelectedV2RunId] = useState(null);
  const [editEmployee, setEditEmployee] = useState(null);

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get("/employees").then((r) => r.data),
  });

  const { data: v2Runs } = useQuery({
    queryKey: ["payroll-v2"],
    queryFn: () => api.get("/payroll-v2").then((r) => r.data),
  });

  // YTD tiles from v2 runs: reversal-aware (a reversed pair nets to 0),
  // current calendar year by pay date.
  const thisYear = String(new Date().getFullYear());
  const ytd = (v2Runs || []).reduce(
    (acc, run) => {
      if (!["finalized", "reversed"].includes(run.status)) return acc;
      if (String(run.pay_date).slice(0, 4) !== thisYear) return acc;
      const sign = run.reversal_of ? -1 : 1;
      acc.gross += (sign * Number(run.gross_cents)) / 100;
      acc.taxes += (sign * Number(run.employee_deductions_cents)) / 100;
      acc.net += (sign * Number(run.net_cents)) / 100;
      if (run.status === "finalized" && !run.reversal_of) acc.runs += 1;
      return acc;
    },
    { gross: 0, taxes: 0, net: 0, runs: 0 },
  );

  // Sandbox/production mode (ROADMAP-V5 Phase 1.6): sandbox output must
  // always carry the watermark banner. Text mirrors SANDBOX_WATERMARK in
  // backend/src/services/payrollRules.js.
  const { data: modeData } = useQuery({
    queryKey: ["payroll-mode"],
    queryFn: () => api.get("/payroll-rules/mode").then((r) => r.data),
  });
  const sandboxMode = (modeData?.payroll_mode || "sandbox") === "sandbox";

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

  return (
    <div className="fade-in">
      <PageHeader
        title={t("payroll.title")}
        subtitle={t("payroll.activeEmployeeCount", {
          count: employees?.length || 0,
        })}
        actions={
          <>
            <Link to="/payroll/compliance">
              <Button icon="ti-calendar-due" title={t("payrollFilings.title")}>
                <span className="hidden lg:inline">
                  {t("payrollFilings.titleShort")}
                </span>
              </Button>
            </Link>
            <Button
              icon="ti-id-badge-2"
              title={t("payroll.employerProfile")}
              onClick={() => setShowProfileModal(true)}
            >
              <span className="hidden sm:inline">
                {t("payroll.employerProfile")}
              </span>
            </Button>
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

      {/* October–December: the Law 148 bonus window approaches — surface
          the eligibility report prominently (ROADMAP-V5 4.3). */}
      {dayjs().month() >= 9 && tab !== "bonus" && (
        <Card
          padding="none"
          className="p-3.5 mb-4 border border-line bg-canvas cursor-pointer hover:bg-sunken"
          onClick={() => setTab("bonus")}
        >
          <div className="text-md text-secondary">
            <i className="ti ti-gift mr-1.5" aria-hidden="true" />
            {t("payrollV2.bonusSeasonBanner")}
          </div>
        </Card>
      )}

      {/* Sandbox watermark banner — links to the rules admin */}
      {sandboxMode && (
        <Link to="/payroll/rules" className="block mb-4">
          <Card
            padding="none"
            className="p-3.5 border border-danger bg-danger-bg hover:opacity-90"
          >
            <div className="font-bold text-danger text-[13px] tracking-wide">
              <i className="ti ti-flask mr-1.5" aria-hidden="true" />
              CÁLCULO NO VERIFICADO — SOLO PRUEBAS
            </div>
            <div className="text-[12px] text-secondary mt-0.5">
              {t("payrollRules.sandboxExplain")}
            </div>
          </Card>
        </Link>
      )}

      {/* YTD Summary */}
      {v2Runs && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 mb-6">
          {[
            { label: t("payroll.ytdGross"), value: fmt(ytd.gross), cls: "text-ink" },
            {
              label: t("payroll.ytdTaxes"),
              value: fmt(ytd.taxes),
              cls: "text-expense",
            },
            {
              label: t("payroll.ytdNetPaid"),
              value: fmt(ytd.net),
              cls: "text-income",
            },
            {
              label: t("payroll.payrollRuns"),
              value: ytd.runs,
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
          { id: "bonus", label: t("payrollV2.tabBonus") },
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
          {/* PR payroll runs (v2 engine) */}
          <div className="text-[11px] text-muted tracking-[1px] uppercase mb-2">
            {t("payrollV2.runsTitle")}
          </div>
          {!v2Runs?.length ? (
            <Card padding="none" className="p-3.5 mb-5 text-md text-secondary">
              {t("payrollV2.noRuns")}
            </Card>
          ) : (
            <Card padding="none" className="mb-5 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] text-muted uppercase tracking-[0.5px] border-b border-line">
                    <th className="px-4 py-2.5">{t("payroll.tablePeriod", "Period")}</th>
                    <th className="px-4 py-2.5">{t("payrollV2.payDate")}</th>
                    <th className="px-4 py-2.5">{t("payrollV2.mode")}</th>
                    <th className="px-4 py-2.5">{t("payroll.tableStatus", "Status")}</th>
                    <th className="px-4 py-2.5 text-right">{t("payrollV2.net")}</th>
                  </tr>
                </thead>
                <tbody>
                  {v2Runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-line last:border-0 hover:bg-canvas cursor-pointer"
                      onClick={() => setSelectedV2RunId(run.id)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-ink">
                        {dayjs(run.period_start).format("MMM D")} —{" "}
                        {dayjs(run.period_end).format("MMM D, YYYY")}
                        {run.reversal_of && (
                          <Badge tone="neutral" className="ml-2">
                            {t("payrollV2.isReversal")}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-secondary">
                        {dayjs(run.pay_date).format("MMM D, YYYY")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={run.run_mode === "sandbox" ? "danger" : "income"}
                        >
                          {run.run_mode === "sandbox"
                            ? t("payrollV2.modeSandbox")
                            : t("payrollV2.modeProduction")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            { draft: "payroll", finalized: "income", reversed: "expense" }[
                              run.status
                            ]
                          }
                        >
                          {t(`payrollV2.status_${run.status}`, run.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-ink whitespace-nowrap">
                        {fmt(Number(run.net_cents) / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

        </div>
      )}

      {/* ── BONUS TAB (Law 148 eligibility, Phase 4.3) ── */}
      {tab === "bonus" && <BonusEligibilityPanel t={t} lang={i18n.language} />}

      <div className="text-[12px] text-muted mt-6 mb-8">
        <i className="ti ti-info-circle mr-1" aria-hidden="true" />
        {t("payroll.pageDisclaimer")}
      </div>

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
        <RunPayrollV2Modal
          onClose={(createdRunId) => {
            setShowRunModal(false);
            if (createdRunId) setSelectedV2RunId(createdRunId);
          }}
          employees={employees}
          t={t}
        />
      )}
      {selectedV2RunId && (
        <RunV2DetailModal
          runId={selectedV2RunId}
          onClose={() => setSelectedV2RunId(null)}
          t={t}
          lang={i18n.language}
        />
      )}
      {showProfileModal && (
        <EmployerProfileModal
          onClose={() => setShowProfileModal(false)}
          t={t}
        />
      )}
    </div>
  );
}
