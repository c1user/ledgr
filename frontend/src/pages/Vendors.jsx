import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";

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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 520,
          padding: 24,
          maxHeight: "90vh",
          overflow: "auto",
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
              fontWeight: 700,
              margin: 0,
              color: "var(--text-primary)",
            }}
          >
            {isEdit ? t("vendors.editVendor") : t("vendors.newVendor")}
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        {error && (
          <div
            style={{
              fontSize: 13,
              color: "var(--expense, #ef4444)",
              background: "var(--expense-bg)",
              borderRadius: 6,
              padding: "8px 12px",
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div>
            <label className="label">{t("vendors.nameLabel")}</label>
            <input
              className="input"
              type="text"
              placeholder={t("vendors.namePlaceholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <label className="label">{t("vendors.einLabel")}</label>
            <input
              className="input"
              type="text"
              placeholder={t("vendors.einPlaceholder")}
              value={form.ein}
              onChange={(e) => setForm({ ...form, ein: e.target.value })}
            />
          </div>

          <div>
            <label className="label">{t("vendors.addressLabel")}</label>
            <input
              className="input"
              type="text"
              placeholder="123 Main St"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 80px 90px",
              gap: 8,
            }}
          >
            <div>
              <label className="label">{t("vendors.cityLabel")}</label>
              <input
                className="input"
                type="text"
                placeholder="San Juan"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("vendors.stateLabel")}</label>
              <input
                className="input"
                type="text"
                placeholder="PR"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("vendors.zipLabel")}</label>
              <input
                className="input"
                type="text"
                placeholder="00901"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label className="label">{t("vendors.emailLabel")}</label>
              <input
                className="input"
                type="email"
                placeholder="contact@vendor.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("vendors.phoneLabel")}</label>
              <input
                className="input"
                type="tel"
                placeholder="(787) 555-0100"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 14px",
              background: "var(--bg-secondary)",
              borderRadius: 8,
            }}
          >
            <input
              type="checkbox"
              id="vendor-1099"
              checked={form.is_1099_eligible}
              onChange={(e) =>
                setForm({ ...form, is_1099_eligible: e.target.checked })
              }
              style={{ width: 16, height: 16, cursor: "pointer", marginTop: 2 }}
            />
            <div>
              <label
                htmlFor="vendor-1099"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  display: "block",
                }}
              >
                {t("vendors.is1099Label")}
              </label>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {t("vendors.is1099Hint")}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? t("vendors.saving")
                : isEdit
                  ? t("vendors.saveChanges")
                  : t("vendors.createVendor")}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 200,
        }}
      />
      {/* Panel */}
      <div
        className="fade-in"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "100vw",
          background: "var(--bg-primary)",
          borderLeft: "0.5px solid var(--border-color)",
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "0.5px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {vendor.name}
            </div>
            {vendor.is_1099_eligible && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "var(--income-bg)",
                  color: "var(--income)",
                  letterSpacing: 0.5,
                }}
              >
                1099
              </span>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {/* YTD stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                {t("vendors.ytdPaid")}
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 700, color: "var(--expense)" }}
              >
                {fmt(totalPaid)}
              </div>
            </div>
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                {t("vendors.colTxCount")}
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}
              >
                {txs.length}
              </div>
            </div>
          </div>

          {/* Contact info */}
          <div style={{ marginBottom: 20 }}>
            {vendor.ein && (
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <i
                  className="ti ti-id"
                  style={{ fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {vendor.ein}
                </span>
              </div>
            )}
            {(vendor.address || vendor.city) && (
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                <i
                  className="ti ti-map-pin"
                  style={{ fontSize: 14, color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {[vendor.address, vendor.city, vendor.state, vendor.zip]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
            {vendor.email && (
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <i
                  className="ti ti-mail"
                  style={{ fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {vendor.email}
                </span>
              </div>
            )}
            {vendor.phone && (
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <i
                  className="ti ti-phone"
                  style={{ fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {vendor.phone}
                </span>
              </div>
            )}
          </div>

          {/* Edit button */}
          <button
            className="btn btn-secondary"
            onClick={onEdit}
            style={{ width: "100%", marginBottom: 20, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
          >
            <i className="ti ti-pencil" style={{ fontSize: 14 }} />
            {t("common.edit")}
          </button>

          {/* Recent transactions */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              letterSpacing: 0.5,
              marginBottom: 10,
            }}
          >
            {t("vendors.recentTransactions").toUpperCase()}
          </div>

          {txLoading ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("common.loading")}
            </div>
          ) : txs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("vendors.noTransactions")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {txs.map((tx) => (
                <div
                  key={tx.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    padding: "8px 10px",
                    background: "var(--bg-secondary)",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tx.merchant || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                      {dayjs(tx.date).format("MMM D, YYYY")}
                      {txCategoryName(tx, t) && ` · ${txCategoryName(tx, t)}`}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color:
                        tx.type === "income" ? "var(--income)" : "var(--expense)",
                      marginLeft: 8,
                      flexShrink: 0,
                    }}
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
        <div
          style={{
            padding: "12px 20px",
            borderTop: "0.5px solid var(--border-color)",
            flexShrink: 0,
          }}
        >
          <button
            className="btn btn-secondary"
            onClick={onDelete}
            style={{
              width: "100%",
              color: "var(--expense, #ef4444)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "center",
            }}
          >
            <i className="ti ti-trash" style={{ fontSize: 14 }} />
            {t("common.delete")}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 1099 Report tab ───────────────────────────────────────────
function Report1099({ fmt, t }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendors-1099", year],
    queryFn: () =>
      api.get(`/vendors/1099-report?year=${year}`).then((r) => r.data),
  });

  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("vendors.reportYear")}
        </div>
        <select
          className="input"
          style={{ width: 100 }}
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            padding: "4px 10px",
            background: "var(--bg-secondary)",
            borderRadius: 6,
          }}
        >
          {t("vendors.reportThreshold")}
        </div>
      </div>

      {isLoading && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "32px 0", textAlign: "center" }}>
          {t("common.loading")}
        </div>
      )}

      {isError && (
        <div style={{ fontSize: 13, color: "var(--expense)", padding: 16, textAlign: "center" }}>
          {t("common.error")}
        </div>
      )}

      {data && data.vendors.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <i
            className="ti ti-file-invoice"
            style={{ fontSize: 40, color: "var(--text-muted)", display: "block", marginBottom: 12 }}
          />
          <div
            style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}
          >
            {t("vendors.noEligible")}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("vendors.noEligibleHint")}
          </div>
        </div>
      )}

      {data && data.vendors.length > 0 && (
        <>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginBottom: 12,
            }}
          >
            {t("vendors.reportSummary", {
              count: data.vendors.length,
              flagged: data.flagged.length,
            })}
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 130px 100px",
                padding: "10px 16px",
                borderBottom: "0.5px solid var(--border-color)",
                background: "var(--bg-secondary)",
                fontSize: 11,
                color: "var(--text-muted)",
                fontWeight: 500,
                letterSpacing: 0.5,
              }}
            >
              <div>{t("vendors.reportColVendor")}</div>
              <div>{t("vendors.reportColEin")}</div>
              <div style={{ textAlign: "right" }}>{t("vendors.reportColTotal")}</div>
              <div style={{ textAlign: "right" }}>{t("vendors.reportColStatus")}</div>
            </div>

            {data.vendors.map((v) => {
              const flagged = parseFloat(v.total_paid) >= 600;
              return (
                <div
                  key={v.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 140px 130px 100px",
                    padding: "12px 16px",
                    borderBottom: "0.5px solid var(--border-color)",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}
                    >
                      {v.name}
                    </div>
                    {(v.city || v.state) && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                        {[v.city, v.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {v.ein || "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: flagged ? "var(--expense)" : "var(--text-primary)",
                      textAlign: "right",
                    }}
                  >
                    {fmt(v.total_paid)}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {flagged ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: "var(--expense-bg)",
                          color: "var(--expense)",
                          letterSpacing: 0.5,
                        }}
                      >
                        {t("vendors.flagged")}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                        }}
                      >
                        {t("vendors.belowThreshold")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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

  function handleDelete(vendor) {
    if (window.confirm(t("vendors.confirmDelete", { name: vendor.name }))) {
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
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            {t("vendors.title")}
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
            {t("vendors.subtitle")}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditVendor(null);
            setShowModal(true);
          }}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className="ti ti-plus" style={{ fontSize: 15 }} />
          {t("vendors.addVendor")}
        </button>
      </div>

      {/* Tabs + search */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((tb) => (
            <button
              key={tb.key}
              className={`btn btn-sm ${tab === tb.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
            </button>
          ))}
        </div>
        {tab !== "report" && (
          <div style={{ position: "relative" }}>
            <i
              className="ti ti-search"
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 14,
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            />
            <input
              className="input"
              type="text"
              placeholder={t("vendors.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 30, width: 220 }}
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
            <div
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                padding: "40px 0",
                textAlign: "center",
              }}
            >
              {t("common.loading")}
            </div>
          )}

          {!isLoading && vendors.length === 0 && (
            <div className="card" style={{ padding: 48, textAlign: "center" }}>
              <i
                className="ti ti-users"
                style={{
                  fontSize: 40,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 12,
                }}
              />
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 6,
                }}
              >
                {search ? t("vendors.noneFound") : t("vendors.noneYet")}
              </div>
              {!search && (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {t("vendors.noneYetHint")}
                </div>
              )}
            </div>
          )}

          {!isLoading && vendors.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 120px 160px 80px 110px 50px",
                  padding: "10px 16px",
                  borderBottom: "0.5px solid var(--border-color)",
                  background: "var(--bg-secondary)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  letterSpacing: 0.5,
                }}
              >
                <div>{t("vendors.colName")}</div>
                <div>{t("vendors.colEin")}</div>
                <div>{t("vendors.colContact")}</div>
                <div style={{ textAlign: "center" }}>{t("vendors.col1099")}</div>
                <div style={{ textAlign: "right" }}>{t("vendors.colYtd")}</div>
                <div></div>
              </div>

              {vendors.map((vendor) => (
                <div
                  key={vendor.id}
                  onClick={() => setSelectedVendor(vendor)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 120px 160px 80px 110px 50px",
                    padding: "12px 16px",
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
                >
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {vendor.name}
                    </div>
                    {(vendor.city || vendor.state) && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {[vendor.city, vendor.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {vendor.ein || "—"}
                  </div>

                  <div>
                    {vendor.email && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {vendor.email}
                      </div>
                    )}
                    {vendor.phone && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {vendor.phone}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "center" }}>
                    {vendor.is_1099_eligible ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--income-bg)",
                          color: "var(--income)",
                        }}
                      >
                        1099
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        —
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color:
                        parseFloat(vendor.ytd_paid) > 0
                          ? "var(--expense)"
                          : "var(--text-muted)",
                      textAlign: "right",
                    }}
                  >
                    {parseFloat(vendor.ytd_paid) > 0
                      ? fmt(vendor.ytd_paid)
                      : "—"}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(vendor);
                      }}
                      style={{ padding: "4px 8px" }}
                      title={t("common.edit")}
                    >
                      <i className="ti ti-pencil" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
