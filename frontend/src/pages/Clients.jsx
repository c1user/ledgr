import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";
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
} from "../components/ui";

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

const STATUS_TONES = {
  draft: "neutral",
  sent: "brand",
  overdue: "expense",
  paid: "income",
  void: "neutral",
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
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t("clients.editClient") : t("clients.newClient")}
    >
      {error && (
        <div className="text-md text-expense bg-expense-bg rounded-md px-3 py-2 mb-3.5">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <Field label={t("clients.nameLabel")} className="mb-0">
          <Input
            type="text"
            placeholder={t("clients.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("clients.emailLabel")} className="mb-0">
            <Input
              type="email"
              placeholder="billing@client.com"
              value={form.billing_email}
              onChange={(e) =>
                setForm({ ...form, billing_email: e.target.value })
              }
            />
          </Field>
          <Field label={t("clients.phoneLabel")} className="mb-0">
            <Input
              type="tel"
              placeholder="(787) 555-0100"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
        </div>

        <Field label={t("clients.addressLabel")} className="mb-0">
          <Input
            type="text"
            placeholder="123 Main St"
            value={form.billing_address}
            onChange={(e) =>
              setForm({ ...form, billing_address: e.target.value })
            }
          />
        </Field>

        <div className="grid grid-cols-[1fr_80px_90px] gap-2">
          <Field label={t("clients.cityLabel")} className="mb-0">
            <Input
              type="text"
              placeholder="San Juan"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label={t("clients.stateLabel")} className="mb-0">
            <Input
              type="text"
              placeholder="PR"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
          </Field>
          <Field label={t("clients.zipLabel")} className="mb-0">
            <Input
              type="text"
              placeholder="00901"
              value={form.zip}
              onChange={(e) => setForm({ ...form, zip: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("clients.termsLabel")} className="mb-0">
            <Input
              type="number"
              min="0"
              value={form.payment_terms_days}
              onChange={(e) =>
                setForm({ ...form, payment_terms_days: e.target.value })
              }
            />
          </Field>
          {isEdit && (
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-md text-ink cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="w-4 h-4 cursor-pointer"
                />
                {t("clients.activeLabel")}
              </label>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-canvas rounded-lg">
          <input
            type="checkbox"
            id="client-taxexempt"
            checked={form.tax_exempt}
            onChange={(e) => setForm({ ...form, tax_exempt: e.target.checked })}
            className="w-4 h-4 cursor-pointer mt-0.5"
          />
          <div>
            <label
              htmlFor="client-taxexempt"
              className="block text-md font-medium text-ink cursor-pointer"
            >
              {t("clients.taxExemptLabel")}
            </label>
            <div className="text-[11px] text-muted mt-0.5">
              {t("clients.taxExemptHint")}
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending
              ? t("clients.saving")
              : isEdit
                ? t("clients.saveChanges")
                : t("clients.createClient")}
          </Button>
        </div>
      </form>
    </Modal>
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

  const contactRow = (icon, value, iconClass, textClass, alignTop) =>
    value && (
      <div
        className={cx(
          "flex gap-2 mb-1.5",
          alignTop ? "items-start" : "items-center",
        )}
      >
        <i
          className={cx(
            "ti",
            icon,
            "text-sm shrink-0",
            iconClass || "text-muted",
            alignTop && "mt-px",
          )}
          aria-hidden="true"
        />
        <span className={cx("text-md", textClass || "text-secondary")}>
          {value}
        </span>
      </div>
    );

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-[150]" />
      <div className="fade-in fixed top-0 right-0 bottom-0 w-[400px] max-w-full bg-surface border-l border-line z-[151] flex flex-col overflow-hidden">
        <div className="flex justify-between items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <div className="text-base font-bold text-ink truncate">
              {client.name}
            </div>
            {!client.is_active && (
              <div className="mt-1">
                <Badge tone="neutral">{t("clients.inactive")}</Badge>
              </div>
            )}
          </div>
          <Button size="sm" icon="ti-x" onClick={onClose} aria-label="Close" />
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            <div className="bg-canvas rounded-lg px-3.5 py-2.5">
              <div className="text-[11px] text-muted mb-0.5">
                {t("clients.outstanding")}
              </div>
              <div className="text-base font-bold text-brand">
                {fmt(data?.outstanding || 0)}
              </div>
            </div>
            <div className="bg-canvas rounded-lg px-3.5 py-2.5">
              <div className="text-[11px] text-muted mb-0.5">
                {t("clients.colInvoices")}
              </div>
              <div className="text-base font-bold text-ink">
                {invoices.length}
              </div>
            </div>
          </div>

          <div className="mb-5">
            {contactRow("ti-mail", client.billing_email)}
            {contactRow("ti-phone", client.phone)}
            {contactRow(
              "ti-map-pin",
              [client.billing_address, client.city, client.state, client.zip]
                .filter(Boolean)
                .join(", ") || null,
              null,
              null,
              true,
            )}
            {contactRow(
              "ti-calendar-due",
              t("clients.termsValue", { days: client.payment_terms_days }),
            )}
            {client.tax_exempt &&
              contactRow(
                "ti-discount-check",
                t("clients.taxExemptLabel"),
                "text-income",
                "text-income",
              )}
          </div>

          <Button icon="ti-pencil" onClick={onEdit} full className="mb-5">
            {t("common.edit")}
          </Button>

          <div className="text-[11px] font-semibold text-muted tracking-[0.5px] mb-2.5 uppercase">
            {t("clients.invoiceHistory")}
          </div>

          {isLoading ? (
            <div className="text-md text-muted">{t("common.loading")}</div>
          ) : invoices.length === 0 ? (
            <div className="text-md text-muted">{t("clients.noInvoices")}</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {invoices.map((inv) => {
                const eff = inv.is_overdue ? "overdue" : inv.status;
                return (
                  <div
                    key={inv.id}
                    className="flex justify-between items-center px-2.5 py-2 bg-canvas rounded-md"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink">
                        {inv.invoice_number}
                      </div>
                      <div className="text-[11px] text-muted mt-px">
                        {dayjs(inv.issue_date).format("MMM D, YYYY")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-ink">
                        {fmt(inv.total)}
                      </div>
                      <Badge tone={STATUS_TONES[eff] || "neutral"}>
                        {t(`invoices.status.${eff}`)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line shrink-0">
          <Button variant="danger" icon="ti-trash" onClick={onDelete} full>
            {t("common.delete")}
          </Button>
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

  // Deep link: /sales/clients?client=<id> opens that client's detail panel
  // (used by the command palette). The param drives the drawer directly —
  // no state sync — and is cleared when the drawer closes.
  const [searchParams, setSearchParams] = useSearchParams();
  const clientParam = searchParams.get("client");
  const clearClientParam = () => {
    if (clientParam) setSearchParams({}, { replace: true });
  };
  const activeClient =
    selected || (clientParam && clients.find((c) => c.id === clientParam)) || null;

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/clients/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      setSelected(null);
      clearClientParam();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("clients.deleteFailed")),
  });

  async function handleDelete(client) {
    if (
      await confirmDialog({
        message: t("clients.confirmDelete", { name: client.name }),
        danger: true,
      })
    ) {
      deleteMutation.mutate(client.id);
    }
  }

  function openEdit(client) {
    setEditClient(client);
    setShowModal(true);
    setSelected(null);
    clearClientParam();
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
    <div className="max-w-[900px] mx-auto">
      <PageHeader
        title={t("clients.title")}
        subtitle={t("clients.subtitle")}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => {
              setEditClient(null);
              setShowModal(true);
            }}
          >
            {t("clients.addClient")}
          </Button>
        }
      />

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
        <div className="relative">
          <i
            className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder={t("clients.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-[30px] w-[220px]"
          />
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {!isLoading && clients.length === 0 && (
        <Card>
          <EmptyState
            icon="ti-address-book"
            title={search ? t("clients.noneFound") : t("clients.noneYet")}
            message={!search ? t("clients.noneYetHint") : undefined}
            action={
              !search && (
                <Button
                  variant="primary"
                  icon="ti-plus"
                  onClick={() => {
                    setEditClient(null);
                    setShowModal(true);
                  }}
                >
                  {t("clients.addClient")}
                </Button>
              )
            }
          />
        </Card>
      )}

      {!isLoading && clients.length > 0 && (
        <Card padding="none" className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1fr_180px_90px_120px_50px] px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]">
              <div>{t("clients.colName")}</div>
              <div>{t("clients.colContact")}</div>
              <div className="text-center">{t("clients.colInvoices")}</div>
              <div className="text-right">{t("clients.colOutstanding")}</div>
              <div></div>
            </div>

            {clients.map((client) => (
              <div
                key={client.id}
                onClick={() => setSelected(client)}
                className={cx(
                  "grid grid-cols-[1fr_180px_90px_120px_50px] px-4 py-3 border-b border-line items-center cursor-pointer transition-colors hover:bg-canvas",
                  !client.is_active && "opacity-55",
                )}
              >
                <div>
                  <div className="text-md font-semibold text-ink">
                    {client.name}
                  </div>
                  {(client.city || client.state) && (
                    <div className="text-[11px] text-muted mt-px">
                      {[client.city, client.state].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  {client.billing_email && (
                    <div className="text-[11px] text-secondary truncate">
                      {client.billing_email}
                    </div>
                  )}
                  {client.phone && (
                    <div className="text-[11px] text-muted">{client.phone}</div>
                  )}
                </div>

                <div className="text-center text-md text-secondary">
                  {client.invoice_count}
                </div>

                <div
                  className={cx(
                    "text-md font-semibold text-right",
                    parseFloat(client.outstanding) > 0
                      ? "text-brand"
                      : "text-muted",
                  )}
                >
                  {parseFloat(client.outstanding) > 0
                    ? fmt(client.outstanding)
                    : "—"}
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    icon="ti-pencil"
                    title={t("common.edit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(client);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeClient && (
        <ClientDrawer
          client={activeClient}
          onClose={() => {
            setSelected(null);
            clearClientParam();
          }}
          onEdit={() => openEdit(activeClient)}
          onDelete={() => handleDelete(activeClient)}
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
