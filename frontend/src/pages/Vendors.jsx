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
} from "../components/ui";

const emptyForm = {
  name: "",
  ein: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  email: "",
  phone: "",
  is_1099_eligible: false,
  withholding_exempt: false,
  waiver_certificate_no: "",
};

// The category comes from the ledger now: system categories carry a name_key
// (resolved via i18n), custom ones a plain name.
const txCategoryName = (tx, t) =>
  tx.category_name_key ? t(tx.category_name_key) : tx.category_name;

const makeFmt = (lang) => (val) =>
  new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(val || 0);

// Checkbox row on a muted background, with label + hint (+ optional extra).
function CheckRow({ id, checked, onChange, label, hint, children }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-canvas rounded-lg">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 cursor-pointer mt-0.5"
      />
      <div className="flex-1">
        <label
          htmlFor={id}
          className="block text-md font-medium text-ink cursor-pointer"
        >
          {label}
        </label>
        <div className="text-[11px] text-muted mt-0.5">{hint}</div>
        {children}
      </div>
    </div>
  );
}

// ── Vendor add/edit modal ─────────────────────────────────────
function VendorModal({ vendor, onClose, t }) {
  const isEdit = !!vendor?.id;
  const qc = useQueryClient();

  const [form, setForm] = useState(
    vendor
      ? {
          name: vendor.name,
          ein: vendor.ein || "",
          address: vendor.address || "",
          city: vendor.city || "",
          state: vendor.state || "",
          zip: vendor.zip || "",
          email: vendor.email || "",
          phone: vendor.phone || "",
          is_1099_eligible: vendor.is_1099_eligible,
          withholding_exempt: vendor.withholding_exempt || false,
          waiver_certificate_no: vendor.waiver_certificate_no || "",
        }
      : { ...emptyForm },
  );
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? api.put(`/vendors/${vendor.id}`, data).then((r) => r.data)
        : api.post("/vendors", data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("vendors.saveFailed")),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t("vendors.errNameRequired"));
      return;
    }
    setError("");
    saveMutation.mutate(form);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t("vendors.editVendor") : t("vendors.newVendor")}
    >
      {error && (
        <div className="text-md text-expense bg-expense-bg rounded-md px-3 py-2 mb-3.5">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <Field label={t("vendors.nameLabel")} className="mb-0">
          <Input
            type="text"
            placeholder={t("vendors.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </Field>

        <Field label={t("vendors.einLabel")} className="mb-0">
          <Input
            type="text"
            placeholder={t("vendors.einPlaceholder")}
            value={form.ein}
            onChange={(e) => setForm({ ...form, ein: e.target.value })}
          />
        </Field>

        <Field label={t("vendors.addressLabel")} className="mb-0">
          <Input
            type="text"
            placeholder="123 Main St"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-[1fr_80px_90px] gap-2">
          <Field label={t("vendors.cityLabel")} className="mb-0">
            <Input
              type="text"
              placeholder="San Juan"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label={t("vendors.stateLabel")} className="mb-0">
            <Input
              type="text"
              placeholder="PR"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
          </Field>
          <Field label={t("vendors.zipLabel")} className="mb-0">
            <Input
              type="text"
              placeholder="00901"
              value={form.zip}
              onChange={(e) => setForm({ ...form, zip: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("vendors.emailLabel")} className="mb-0">
            <Input
              type="email"
              placeholder="contact@vendor.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t("vendors.phoneLabel")} className="mb-0">
            <Input
              type="tel"
              placeholder="(787) 555-0100"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
        </div>

        <CheckRow
          id="vendor-1099"
          checked={form.is_1099_eligible}
          onChange={(e) =>
            setForm({ ...form, is_1099_eligible: e.target.checked })
          }
          label={t("vendors.is1099Label")}
          hint={t("vendors.is1099Hint")}
        />

        {/* §1062.03 withholding waiver (relevo) — feeds Form 480.6SP */}
        <CheckRow
          id="vendor-waiver"
          checked={form.withholding_exempt}
          onChange={(e) =>
            setForm({ ...form, withholding_exempt: e.target.checked })
          }
          label={t("vendors.waiverLabel")}
          hint={t("vendors.waiverHint")}
        >
          {form.withholding_exempt && (
            <Input
              className="mt-2"
              type="text"
              placeholder={t("vendors.waiverCertPlaceholder")}
              value={form.waiver_certificate_no}
              onChange={(e) =>
                setForm({ ...form, waiver_certificate_no: e.target.value })
              }
            />
          )}
        </CheckRow>

        <div className="flex gap-2.5 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending
              ? t("vendors.saving")
              : isEdit
                ? t("vendors.saveChanges")
                : t("vendors.createVendor")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Vendor detail drawer ──────────────────────────────────────
function VendorDrawer({ vendor, onClose, onEdit, onDelete, fmt, t }) {
  const { data: txs = [], isLoading: txLoading } = useQuery({
    queryKey: ["vendor-transactions", vendor.id],
    queryFn: () =>
      api.get(`/vendors/${vendor.id}/transactions`).then((r) => r.data),
  });

  const totalPaid = txs
    .filter((tx) => tx.type === "expense")
    .reduce((s, tx) => s + parseFloat(tx.total_amount), 0);

  const contactRow = (icon, value, alignTop) =>
    value && (
      <div
        className={cx(
          "flex gap-2 mb-1.5",
          alignTop ? "items-start" : "items-center",
        )}
      >
        <i
          className={cx("ti", icon, "text-sm text-muted shrink-0", alignTop && "mt-px")}
          aria-hidden="true"
        />
        <span className="text-md text-secondary">{value}</span>
      </div>
    );

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-[150]" />
      {/* Panel */}
      <div className="fade-in fixed top-0 right-0 bottom-0 w-[400px] max-w-full bg-surface border-l border-line z-[151] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <div className="text-base font-bold text-ink truncate">
              {vendor.name}
            </div>
            {vendor.is_1099_eligible && (
              <div className="mt-1">
                <Badge tone="income">1099</Badge>
              </div>
            )}
          </div>
          <Button size="sm" icon="ti-x" onClick={onClose} aria-label="Close" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {/* YTD stats */}
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            <div className="bg-canvas rounded-lg px-3.5 py-2.5">
              <div className="text-[11px] text-muted mb-0.5">
                {t("vendors.ytdPaid")}
              </div>
              <div className="text-base font-bold text-expense">
                {fmt(totalPaid)}
              </div>
            </div>
            <div className="bg-canvas rounded-lg px-3.5 py-2.5">
              <div className="text-[11px] text-muted mb-0.5">
                {t("vendors.colTxCount")}
              </div>
              <div className="text-base font-bold text-ink">{txs.length}</div>
            </div>
          </div>

          {/* Contact info */}
          <div className="mb-5">
            {contactRow("ti-id", vendor.ein)}
            {contactRow(
              "ti-map-pin",
              [vendor.address, vendor.city, vendor.state, vendor.zip]
                .filter(Boolean)
                .join(", ") || null,
              true,
            )}
            {contactRow("ti-mail", vendor.email)}
            {contactRow("ti-phone", vendor.phone)}
          </div>

          {/* Edit button */}
          <Button icon="ti-pencil" onClick={onEdit} full className="mb-5">
            {t("common.edit")}
          </Button>

          {/* Recent transactions */}
          <div className="text-[11px] font-semibold text-muted tracking-[0.5px] mb-2.5 uppercase">
            {t("vendors.recentTransactions")}
          </div>

          {txLoading ? (
            <div className="text-md text-muted">{t("common.loading")}</div>
          ) : txs.length === 0 ? (
            <div className="text-md text-muted">
              {t("vendors.noTransactions")}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {txs.map((tx) => (
                <div
                  key={tx.id}
                  className="flex justify-between items-start px-2.5 py-2 bg-canvas rounded-md"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-ink truncate">
                      {tx.merchant || "—"}
                    </div>
                    <div className="text-[11px] text-muted mt-px">
                      {dayjs(tx.date).format("MMM D, YYYY")}
                      {txCategoryName(tx, t) && ` · ${txCategoryName(tx, t)}`}
                    </div>
                  </div>
                  <div
                    className={cx(
                      "text-xs font-semibold ml-2 shrink-0",
                      tx.type === "income" ? "text-income" : "text-expense",
                    )}
                  >
                    {tx.type === "income" ? "+" : "-"}
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(tx.total_amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delete footer */}
        <div className="px-5 py-3 border-t border-line shrink-0">
          <Button variant="danger" icon="ti-trash" onClick={onDelete} full>
            {t("common.delete")}
          </Button>
        </div>
      </div>
    </>
  );
}

// ── 1099 Report tab ───────────────────────────────────────────
function Report1099({ fmt, t }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [exportError, setExportError] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-1099", year],
    queryFn: () => api.get(`/reports/1099?year=${year}`).then((r) => r.data),
  });

  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  // Localized label for each required field key the backend can report missing.
  const fieldLabel = (f) => t(`vendors.field_${f}`);

  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await api.get(`/reports/1099/export?year=${year}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `1099-nec-${year}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => setExportError(""),
    onError: () => setExportError(t("vendors.exportBlocked")),
  });

  const flaggedCount = data?.flagged_count || 0;
  const incompleteCount = data?.incomplete_count || 0;
  const canExport = flaggedCount > 0 && incompleteCount === 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="text-md text-muted">{t("vendors.reportYear")}</div>
        <Select
          className="w-[100px]"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <div className="text-xs text-muted px-2.5 py-1 bg-canvas rounded-md">
          {t("vendors.reportThreshold")}
        </div>
        <Button
          size="sm"
          icon="ti-download"
          className="ml-auto"
          onClick={() => exportCsv.mutate()}
          disabled={!canExport || exportCsv.isPending}
          title={
            canExport ? t("vendors.exportCsv") : t("vendors.exportDisabledHint")
          }
        >
          {t("vendors.exportCsv")}
        </Button>
      </div>

      {isLoading && (
        <div className="text-md text-muted py-8 text-center">
          {t("common.loading")}
        </div>
      )}

      {isError && (
        <div className="text-md text-expense p-4 text-center">
          {t("common.error")}
        </div>
      )}

      {/* Missing-field blocker: flagged vendors can't be filed until complete */}
      {data && incompleteCount > 0 && (
        <div className="bg-expense-bg text-expense border border-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
          <i className="ti ti-alert-triangle mr-1.5" aria-hidden="true" />
          {t("vendors.incompleteWarning", { count: incompleteCount })}
        </div>
      )}

      {exportError && (
        <div className="bg-expense-bg text-expense rounded-lg px-3.5 py-2.5 text-md mb-3">
          {exportError}
        </div>
      )}

      {data && data.vendors.length === 0 && (
        <Card>
          <EmptyState
            icon="ti-file-invoice"
            title={t("vendors.noEligible")}
            message={t("vendors.noEligibleHint")}
          />
        </Card>
      )}

      {data && data.vendors.length > 0 && (
        <>
          <div className="flex justify-between flex-wrap gap-2 text-xs text-muted mb-3">
            <span>
              {t("vendors.reportSummary", {
                count: data.eligible_count,
                flagged: data.flagged_count,
              })}
            </span>
            {data.flagged_count > 0 && (
              <span className="font-semibold text-secondary">
                {t("vendors.reportReportable", {
                  amount: fmt(data.total_reportable),
                })}
              </span>
            )}
          </div>

          <Card padding="none" className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_140px_130px_160px] px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]">
                <div>{t("vendors.reportColVendor")}</div>
                <div>{t("vendors.reportColEin")}</div>
                <div className="text-right">{t("vendors.reportColTotal")}</div>
                <div className="text-right">{t("vendors.reportColStatus")}</div>
              </div>

              {data.vendors.map((v) => {
                const incomplete = v.flagged && v.missing_fields?.length > 0;
                return (
                  <div
                    key={v.id}
                    className="grid grid-cols-[1fr_140px_130px_160px] px-4 py-3 border-b border-line items-center"
                  >
                    <div>
                      <div className="text-md font-medium text-ink">
                        {v.name}
                      </div>
                      {(v.city || v.state) && (
                        <div className="text-[11px] text-muted mt-px">
                          {[v.city, v.state].filter(Boolean).join(", ")}
                        </div>
                      )}
                    </div>
                    <div
                      className={cx(
                        "text-xs",
                        v.ein ? "text-secondary" : "text-expense",
                      )}
                    >
                      {v.ein || t("vendors.missingEin")}
                    </div>
                    <div
                      className={cx(
                        "text-md font-semibold text-right",
                        v.flagged ? "text-expense" : "text-ink",
                      )}
                    >
                      {fmt(v.total_paid)}
                    </div>
                    <div className="text-right">
                      {!v.flagged ? (
                        <span className="text-[11px] text-muted">
                          {t("vendors.belowThreshold")}
                        </span>
                      ) : incomplete ? (
                        <Badge
                          tone="expense"
                          className="text-left"
                          title={v.missing_fields.map(fieldLabel).join(", ")}
                        >
                          {t("vendors.statusMissing", {
                            fields: v.missing_fields.map(fieldLabel).join(", "),
                          })}
                        </Badge>
                      ) : (
                        <Badge tone="income">{t("vendors.statusReady")}</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Vendors() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const fmt = makeFmt(i18n.language);

  const [tab, setTab] = useState("all"); // "all" | "eligible" | "report"
  const [search, setSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editVendor, setEditVendor] = useState(null);

  const vendorQueryKey = ["vendors", search, tab === "eligible"];
  const { data: vendors = [], isLoading } = useQuery({
    queryKey: vendorQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (tab === "eligible") p.set("eligible", "true");
      return api.get(`/vendors?${p}`).then((r) => r.data);
    },
    enabled: tab !== "report",
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/vendors/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setSelectedVendor(null);
    },
  });

  async function handleDelete(vendor) {
    if (
      await confirmDialog({
        message: t("vendors.confirmDelete", { name: vendor.name }),
        danger: true,
      })
    ) {
      deleteMutation.mutate(vendor.id);
    }
  }

  function openEdit(vendor) {
    setEditVendor(vendor);
    setShowModal(true);
    setSelectedVendor(null);
  }

  function closeModal() {
    setShowModal(false);
    setEditVendor(null);
  }

  const TABS = [
    { key: "all", label: t("vendors.tabAll") },
    { key: "eligible", label: t("vendors.tab1099") },
    { key: "report", label: t("vendors.tabReport") },
  ];

  return (
    <div className="max-w-[900px] mx-auto">
      <PageHeader
        title={t("vendors.title")}
        subtitle={t("vendors.subtitle")}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => {
              setEditVendor(null);
              setShowModal(true);
            }}
          >
            {t("vendors.addVendor")}
          </Button>
        }
      />

      {/* Tabs + search */}
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <div className="flex gap-1">
          {TABS.map((tb) => (
            <Button
              key={tb.key}
              size="sm"
              variant={tab === tb.key ? "primary" : "secondary"}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
            </Button>
          ))}
        </div>
        {tab !== "report" && (
          <div className="relative">
            <i
              className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="text"
              placeholder={t("vendors.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-[30px] w-[220px]"
            />
          </div>
        )}
      </div>

      {/* 1099 Report tab */}
      {tab === "report" && <Report1099 fmt={fmt} t={t} />}

      {/* Vendor list tabs */}
      {tab !== "report" && (
        <>
          {isLoading && (
            <div className="text-sm text-muted py-10 text-center">
              {t("common.loading")}
            </div>
          )}

          {!isLoading && vendors.length === 0 && (
            <Card>
              <EmptyState
                icon="ti-users"
                title={search ? t("vendors.noneFound") : t("vendors.noneYet")}
                message={!search ? t("vendors.noneYetHint") : undefined}
              />
            </Card>
          )}

          {!isLoading && vendors.length > 0 && (
            <Card padding="none" className="overflow-x-auto">
              <div className="min-w-[640px]">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_120px_160px_80px_110px_50px] px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]">
                  <div>{t("vendors.colName")}</div>
                  <div>{t("vendors.colEin")}</div>
                  <div>{t("vendors.colContact")}</div>
                  <div className="text-center">{t("vendors.col1099")}</div>
                  <div className="text-right">{t("vendors.colYtd")}</div>
                  <div></div>
                </div>

                {vendors.map((vendor) => (
                  <div
                    key={vendor.id}
                    onClick={() => setSelectedVendor(vendor)}
                    className="grid grid-cols-[1fr_120px_160px_80px_110px_50px] px-4 py-3 border-b border-line items-center cursor-pointer transition-colors hover:bg-canvas"
                  >
                    <div>
                      <div className="text-md font-semibold text-ink">
                        {vendor.name}
                      </div>
                      {(vendor.city || vendor.state) && (
                        <div className="text-[11px] text-muted mt-px">
                          {[vendor.city, vendor.state].filter(Boolean).join(", ")}
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-secondary">
                      {vendor.ein || "—"}
                    </div>

                    <div>
                      {vendor.email && (
                        <div className="text-[11px] text-secondary truncate">
                          {vendor.email}
                        </div>
                      )}
                      {vendor.phone && (
                        <div className="text-[11px] text-muted">
                          {vendor.phone}
                        </div>
                      )}
                    </div>

                    <div className="text-center">
                      {vendor.is_1099_eligible ? (
                        <Badge tone="income">1099</Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </div>

                    <div
                      className={cx(
                        "text-md font-semibold text-right",
                        parseFloat(vendor.ytd_paid) > 0
                          ? "text-expense"
                          : "text-muted",
                      )}
                    >
                      {parseFloat(vendor.ytd_paid) > 0
                        ? fmt(vendor.ytd_paid)
                        : "—"}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        icon="ti-pencil"
                        title={t("common.edit")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(vendor);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Detail drawer */}
      {selectedVendor && (
        <VendorDrawer
          vendor={selectedVendor}
          onClose={() => setSelectedVendor(null)}
          onEdit={() => openEdit(selectedVendor)}
          onDelete={() => handleDelete(selectedVendor)}
          fmt={fmt}
          t={t}
        />
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <VendorModal vendor={editVendor} onClose={closeModal} t={t} />
      )}
    </div>
  );
}
