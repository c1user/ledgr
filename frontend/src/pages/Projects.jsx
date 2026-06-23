import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { resolveCatName } from "../lib/coaCategories";

const STATUSES = ["active", "completed", "archived"];

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const statusStyle = (status) => {
  if (status === "active")
    return { bg: "var(--income-bg)", color: "var(--income)" };
  if (status === "completed")
    return { bg: "var(--brand-light)", color: "var(--brand)" };
  return { bg: "var(--bg-secondary)", color: "var(--text-muted)" };
};

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

const makeEmptyForm = () => ({
  name: "",
  client_id: "",
  status: "active",
  budget: "",
  start_date: "",
  end_date: "",
  color: "#4f8ef7",
  description: "",
});

// ── Create / edit modal ──────────────────────────────────────
function ProjectModal({ onClose, clients, editItem, t }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() =>
    editItem
      ? {
          name: editItem.name || "",
          client_id: editItem.client_id || "",
          status: editItem.status || "active",
          budget: editItem.budget != null ? String(editItem.budget) : "",
          start_date: editItem.start_date || "",
          end_date: editItem.end_date || "",
          color: editItem.color || "#4f8ef7",
          description: editItem.description || "",
        }
      : makeEmptyForm(),
  );
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data) =>
      editItem
        ? api.put(`/projects/${editItem.id}`, data)
        : api.post("/projects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("projects.saveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError(t("projects.errNameRequired"));
    mutation.mutate({
      name: form.name.trim(),
      client_id: form.client_id || null,
      status: form.status,
      budget: form.budget === "" ? null : parseFloat(form.budget),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      color: form.color,
      description: form.description || null,
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
        style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", padding: 24 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            {editItem ? t("projects.editTitle") : t("projects.newTitle")}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20 }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "0.5px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
            <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="name">{t("projects.name")}</label>
            <input id="name" className="input" type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("projects.namePlaceholder")} required />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label className="label" htmlFor="client_id">{t("projects.client")}</label>
              <select id="client_id" className="input" value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">{t("projects.noClient")}</option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="status">{t("projects.status")}</label>
              <select id="status" className="input" value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`projects.status_${s}`)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label className="label" htmlFor="budget">{t("projects.budget")}</label>
              <input id="budget" className="input" type="number" step="0.01" min="0"
                value={form.budget} placeholder="0.00"
                onChange={(e) => setForm({ ...form, budget: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="start_date">{t("projects.startDate")}</label>
              <input id="start_date" className="input" type="date" value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="end_date">{t("projects.endDate")}</label>
              <input id="end_date" className="input" type="date" value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label" htmlFor="description">{t("projects.description")}</label>
            <input id="description" className="input" type="text" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">{t("common.cancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? t("projects.saving") : editItem ? t("common.save") : t("projects.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Per-job P&L detail (expanded) ────────────────────────────
function ProjectSummary({ projectId, fmt, currency, t }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-summary", projectId],
    queryFn: () => api.get(`/projects/${projectId}/summary`).then((r) => r.data),
  });

  if (isLoading)
    return <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>{t("common.loading")}</div>;
  if (!data) return null;

  const budget = data.project.budget;
  const pct = budget > 0 ? Math.min((data.actual_cost / budget) * 100, 100) : 0;
  const over = budget != null && data.actual_cost > budget;

  return (
    <div style={{ marginTop: 10, paddingTop: 12, borderTop: "0.5px solid var(--border-color)" }}>
      {/* P&L */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        <Stat label={t("projects.income")} value={fmt(data.income_total, currency)} color="var(--income)" />
        <Stat label={t("projects.expenses")} value={fmt(data.expense_total, currency)} color="var(--expense)" />
        <Stat label={t("projects.net")} value={fmt(data.net, currency)} color={data.net >= 0 ? "var(--income)" : "var(--expense)"} />
      </div>

      {/* Budget vs actual */}
      {budget != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            <span>{t("projects.spentOfBudget", { spent: fmt(data.actual_cost, currency), budget: fmt(budget, currency) })}</span>
            <span style={{ color: over ? "var(--expense)" : "var(--text-muted)" }}>
              {t("projects.remaining")}: {fmt(data.budget_remaining, currency)}
            </span>
          </div>
          <div style={{ height: 6, background: "var(--border-color)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: over ? "var(--expense)" : "var(--brand)", borderRadius: 3 }} />
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {data.categories.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            {t("projects.breakdown")}
          </div>
          {data.categories.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color || "var(--brand)" }} />
                {resolveCatName(c.name_key, c.name, t)}
              </span>
              <span style={{ color: c.account_type === "revenue" ? "var(--income)" : "var(--expense)" }}>
                {fmt(c.total, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hours (informational, separate from P&L) */}
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {t("projects.hoursLogged", {
          total: Number(data.hours.total_hours),
          billable: Number(data.hours.billable_hours),
        })}
        {" · "}
        {t("projects.billableValue", { value: fmt(data.hours.billable_amount, currency) })}
      </div>
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────
function ProjectCard({ p, fmt, currency, onEdit, t }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const ss = statusStyle(p.status);
  const income = Number(p.income_total);
  const expense = Number(p.expense_total);
  const net = income - expense;

  const del = useMutation({
    mutationFn: () => api.delete(`/projects/${p.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: p.color, flexShrink: 0, marginTop: 4 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{p.name}</span>
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: ss.bg, color: ss.color, fontWeight: 500 }}>
              {t(`projects.status_${p.status}`)}
            </span>
            {p.client_name && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {p.client_name}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{t("projects.income")}: <b style={{ color: "var(--income)" }}>{fmt(income, currency)}</b></span>
            <span>{t("projects.expenses")}: <b style={{ color: "var(--expense)" }}>{fmt(expense, currency)}</b></span>
            <span>{t("projects.net")}: <b style={{ color: net >= 0 ? "var(--income)" : "var(--expense)" }}>{fmt(net, currency)}</b></span>
            {p.budget != null && <span>{t("projects.budget")}: {fmt(p.budget, currency)}</span>}
            <span>{Number(p.total_hours)}h</span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--brand)", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
          >
            <i className={`ti ${expanded ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden="true" />
            {expanded ? t("projects.hideDetail") : t("projects.viewDetail")}
          </button>
          {expanded && <ProjectSummary projectId={p.id} fmt={fmt} currency={currency} t={t} />}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(p)} title={t("common.edit")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
            <i className="ti ti-pencil" style={{ fontSize: 15 }} aria-hidden="true" />
          </button>
          <button onClick={() => { if (window.confirm(t("projects.confirmDelete"))) del.mutate(); }} title={t("common.delete")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4 }}>
            <i className="ti ti-trash" style={{ fontSize: 15 }} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function Projects() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const currency = business?.currency || "USD";
  const fmt = makeFmt(i18n.language);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", statusFilter],
    queryFn: () =>
      api.get(`/projects${statusFilter ? `?status=${statusFilter}` : ""}`).then((r) => r.data),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api.get("/clients").then((r) => r.data),
  });

  const close = () => { setShowModal(false); setEditItem(null); };
  const openEdit = (p) => { setEditItem(p); setShowModal(true); };

  return (
    <div className="fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{t("projects.title")}</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("projects.subtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select className="input" style={{ width: 140 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t("projects.allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`projects.status_${s}`)}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowModal(true); }}>
            <i className="ti ti-plus" aria-hidden="true" /> {t("projects.new")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : projects.length === 0 ? (
        <div className="card" style={{ padding: 60, textAlign: "center" }}>
          <i className="ti ti-briefcase" style={{ fontSize: 36, color: "var(--text-muted)" }} aria-hidden="true" />
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", margin: "12px 0 6px" }}>{t("projects.noneTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{t("projects.noneHint")}</div>
          <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowModal(true); }}>{t("projects.addFirst")}</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} fmt={fmt} currency={currency} onEdit={openEdit} t={t} />
          ))}
        </div>
      )}

      {showModal && <ProjectModal onClose={close} clients={clients} editItem={editItem} t={t} />}
    </div>
  );
}
