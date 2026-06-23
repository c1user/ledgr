import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";

const emptyForm = {
  name: "",
  billing_email: "",
  billing_address: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  payment_terms_days: 30,
  tax_exempt: false,
  is_active: true,
};

const makeFmt = (lang) => (val) =>
  new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(val || 0);

const STATUS_COLORS = {
  draft: { bg: "var(--bg-secondary)", fg: "var(--text-muted)" },
  sent: { bg: "var(--brand-light)", fg: "var(--brand)" },
  overdue: { bg: "var(--expense-bg)", fg: "var(--expense)" },
  paid: { bg: "var(--income-bg)", fg: "var(--income)" },
  void: { bg: "var(--bg-secondary)", fg: "var(--text-muted)" },
};

// ── Client add/edit modal ─────────────────────────────────────
function ClientModal({ client, onClose, t }) {
  const isEdit = !!client?.id;
  const qc = useQueryClient();

  const [form, setForm] = useState(
    client
      ? {
          name: client.name,
          billing_email: client.billing_email || "",
          billing_address: client.billing_address || "",
          city: client.city || "",
          state: client.state || "",
          zip: client.zip || "",
          phone: client.phone || "",
          payment_terms_days: client.payment_terms_days ?? 30,
          tax_exempt: client.tax_exempt,
          is_active: client.is_active,
        }
      : { ...emptyForm },
  );
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? api.put(`/clients/${client.id}`, data).then((r) => r.data)
        : api.post("/clients", data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("clients.saveFailed")),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t("clients.errNameRequired"));
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
            {isEdit ? t("clients.editClient") : t("clients.newClient")}
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
            <label className="label">{t("clients.nameLabel")}</label>
            <input
              className="input"
              type="text"
              placeholder={t("clients.namePlaceholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <div>
              <label className="label">{t("clients.emailLabel")}</label>
              <input
                className="input"
                type="email"
                placeholder="billing@client.com"
                value={form.billing_email}
                onChange={(e) =>
                  setForm({ ...form, billing_email: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">{t("clients.phoneLabel")}</label>
              <input
                className="input"
                type="tel"
                placeholder="(787) 555-0100"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">{t("clients.addressLabel")}</label>
            <input
              className="input"
              type="text"
              placeholder="123 Main St"
              value={form.billing_address}
              onChange={(e) =>
                setForm({ ...form, billing_address: e.target.value })
              }
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
              <label className="label">{t("clients.cityLabel")}</label>
              <input
                className="input"
                type="text"
                placeholder="San Juan"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("clients.stateLabel")}</label>
              <input
                className="input"
                type="text"
                placeholder="PR"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t("clients.zipLabel")}</label>
              <input
                className="input"
                type="text"
                placeholder="00901"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
              />
            </div>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <div>
              <label className="label">{t("clients.termsLabel")}</label>
              <input
                className="input"
                type="number"
                min="0"
                value={form.payment_terms_days}
                onChange={(e) =>
                  setForm({ ...form, payment_terms_days: e.target.value })
                }
              />
            </div>
            {isEdit && (
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    paddingBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm({ ...form, is_active: e.target.checked })
                    }
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  {t("clients.activeLabel")}
                </label>
              </div>
            )}
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
              id="client-taxexempt"
              checked={form.tax_exempt}
              onChange={(e) =>
                setForm({ ...form, tax_exempt: e.target.checked })
              }
              style={{ width: 16, height: 16, cursor: "pointer", marginTop: 2 }}
            />
            <div>
              <label
                htmlFor="client-taxexempt"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  display: "block",
                }}
              >
                {t("clients.taxExemptLabel")}
              </label>
              <div
                style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
              >
                {t("clients.taxExemptHint")}
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
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? t("clients.saving")
                : isEdit
                  ? t("clients.saveChanges")
                  : t("clients.createClient")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Client detail drawer ──────────────────────────────────────
function ClientDrawer({ client, onClose, onEdit, onDelete, fmt, t }) {
  const { data, isLoading } = useQuery({
    queryKey: ["client-invoices", client.id],
    queryFn: () =>
      api.get(`/clients/${client.id}/invoices`).then((r) => r.data),
  });

  const invoices = data?.invoices || [];

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 200,
        }}
      />
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
              {client.name}
            </div>
            {!client.is_active && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "var(--bg-secondary)",
                  color: "var(--text-muted)",
                }}
              >
                {t("clients.inactive")}
              </span>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
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
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 2,
                }}
              >
                {t("clients.outstanding")}
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 700, color: "var(--brand)" }}
              >
                {fmt(data?.outstanding || 0)}
              </div>
            </div>
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 2,
                }}
              >
                {t("clients.colInvoices")}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                {invoices.length}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            {client.billing_email && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <i
                  className="ti ti-mail"
                  style={{ fontSize: 14, color: "var(--text-muted)" }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {client.billing_email}
                </span>
              </div>
            )}
            {client.phone && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <i
                  className="ti ti-phone"
                  style={{ fontSize: 14, color: "var(--text-muted)" }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {client.phone}
                </span>
              </div>
            )}
            {(client.billing_address || client.city) && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "flex-start",
                }}
              >
                <i
                  className="ti ti-map-pin"
                  style={{
                    fontSize: 14,
                    color: "var(--text-muted)",
                    marginTop: 1,
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {[client.billing_address, client.city, client.state, client.zip]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 6,
                alignItems: "center",
              }}
            >
              <i
                className="ti ti-calendar-due"
                style={{ fontSize: 14, color: "var(--text-muted)" }}
              />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t("clients.termsValue", { days: client.payment_terms_days })}
              </span>
            </div>
            {client.tax_exempt && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <i
                  className="ti ti-discount-check"
                  style={{ fontSize: 14, color: "var(--income)" }}
                />
                <span style={{ fontSize: 13, color: "var(--income)" }}>
                  {t("clients.taxExemptLabel")}
                </span>
              </div>
            )}
          </div>

          <button
            className="btn btn-secondary"
            onClick={onEdit}
            style={{
              width: "100%",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "center",
            }}
          >
            <i className="ti ti-pencil" style={{ fontSize: 14 }} />
            {t("common.edit")}
          </button>

          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              letterSpacing: 0.5,
              marginBottom: 10,
            }}
          >
            {t("clients.invoiceHistory").toUpperCase()}
          </div>

          {isLoading ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("common.loading")}
            </div>
          ) : invoices.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("clients.noInvoices")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {invoices.map((inv) => {
                const eff = inv.is_overdue ? "overdue" : inv.status;
                const c = STATUS_COLORS[eff] || STATUS_COLORS.draft;
                return (
                  <div
                    key={inv.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 10px",
                      background: "var(--bg-secondary)",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {inv.invoice_number}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {dayjs(inv.issue_date).format("MMM D, YYYY")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {fmt(inv.total)}
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: c.bg,
                          color: c.fg,
                        }}
                      >
                        {t(`invoices.status.${eff}`)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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

// ── Main page ─────────────────────────────────────────────────
export default function Clients() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const fmt = makeFmt(i18n.language);

  const [tab, setTab] = useState("active"); // "active" | "all"
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients", search, tab],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (tab === "active") p.set("active", "true");
      return api.get(`/clients?${p}`).then((r) => r.data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/clients/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      setSelected(null);
    },
    onError: (err) =>
      window.alert(err.response?.data?.error || t("clients.deleteFailed")),
  });

  function handleDelete(client) {
    if (window.confirm(t("clients.confirmDelete", { name: client.name }))) {
      deleteMutation.mutate(client.id);
    }
  }

  function openEdit(client) {
    setEditClient(client);
    setShowModal(true);
    setSelected(null);
  }

  function closeModal() {
    setShowModal(false);
    setEditClient(null);
  }

  const TABS = [
    { key: "active", label: t("clients.tabActive") },
    { key: "all", label: t("clients.tabAll") },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
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
            {t("clients.title")}
          </h1>
          <p
            style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}
          >
            {t("clients.subtitle")}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditClient(null);
            setShowModal(true);
          }}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className="ti ti-plus" style={{ fontSize: 15 }} />
          {t("clients.addClient")}
        </button>
      </div>

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
            placeholder={t("clients.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30, width: 220 }}
          />
        </div>
      </div>

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

      {!isLoading && clients.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <i
            className="ti ti-address-book"
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
            {search ? t("clients.noneFound") : t("clients.noneYet")}
          </div>
          {!search && (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("clients.noneYetHint")}
            </div>
          )}
        </div>
      )}

      {!isLoading && clients.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 180px 90px 120px 50px",
              padding: "10px 16px",
              borderBottom: "0.5px solid var(--border-color)",
              background: "var(--bg-secondary)",
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 500,
              letterSpacing: 0.5,
            }}
          >
            <div>{t("clients.colName")}</div>
            <div>{t("clients.colContact")}</div>
            <div style={{ textAlign: "center" }}>{t("clients.colInvoices")}</div>
            <div style={{ textAlign: "right" }}>{t("clients.colOutstanding")}</div>
            <div></div>
          </div>

          {clients.map((client) => (
            <div
              key={client.id}
              onClick={() => setSelected(client)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px 90px 120px 50px",
                padding: "12px 16px",
                borderBottom: "0.5px solid var(--border-color)",
                alignItems: "center",
                cursor: "pointer",
                transition: "background 0.15s",
                opacity: client.is_active ? 1 : 0.55,
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
                  {client.name}
                </div>
                {(client.city || client.state) && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 1,
                    }}
                  >
                    {[client.city, client.state].filter(Boolean).join(", ")}
                  </div>
                )}
              </div>

              <div style={{ minWidth: 0 }}>
                {client.billing_email && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {client.billing_email}
                  </div>
                )}
                {client.phone && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {client.phone}
                  </div>
                )}
              </div>

              <div
                style={{
                  textAlign: "center",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                {client.invoice_count}
              </div>

              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color:
                    parseFloat(client.outstanding) > 0
                      ? "var(--brand)"
                      : "var(--text-muted)",
                  textAlign: "right",
                }}
              >
                {parseFloat(client.outstanding) > 0
                  ? fmt(client.outstanding)
                  : "—"}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(client);
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

      {selected && (
        <ClientDrawer
          client={selected}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected)}
          fmt={fmt}
          t={t}
        />
      )}

      {showModal && (
        <ClientModal client={editClient} onClose={closeModal} t={t} />
      )}
    </div>
  );
}
