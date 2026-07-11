import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { resolveCatName } from "../lib/coaCategories";
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

const STATUSES = ["active", "completed", "archived"];

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const STATUS_TONES = {
  active: "income",
  completed: "brand",
  archived: "neutral",
};

function Stat({ label, value, cls }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cx("text-base font-bold", cls || "text-ink")}>{value}</div>
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
  color: "#2f6bc6",
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
          color: editItem.color || "#2f6bc6",
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
    <Modal
      open
      onClose={onClose}
      title={editItem ? t("projects.editTitle") : t("projects.newTitle")}
    >
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Field label={t("projects.name")} htmlFor="name" className="mb-3.5">
          <Input
            id="name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("projects.namePlaceholder")}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field label={t("projects.client")} htmlFor="client_id" className="mb-0">
            <Select
              id="client_id"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
            >
              <option value="">{t("projects.noClient")}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("projects.status")} htmlFor="status" className="mb-0">
            <Select
              id="status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`projects.status_${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3.5">
          <Field label={t("projects.budget")} htmlFor="budget" className="mb-0">
            <Input
              id="budget"
              type="number"
              step="0.01"
              min="0"
              value={form.budget}
              placeholder="0.00"
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </Field>
          <Field
            label={t("projects.startDate")}
            htmlFor="start_date"
            className="mb-0"
          >
            <Input
              id="start_date"
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </Field>
          <Field label={t("projects.endDate")} htmlFor="end_date" className="mb-0">
            <Input
              id="end_date"
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </Field>
        </div>

        <Field
          label={t("projects.description")}
          htmlFor="description"
          className="mb-5"
        >
          <Input
            id="description"
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t("projects.saving")
              : editItem
                ? t("common.save")
                : t("projects.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Per-job P&L detail (expanded) ────────────────────────────
function ProjectSummary({ projectId, fmt, currency, t }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-summary", projectId],
    queryFn: () => api.get(`/projects/${projectId}/summary`).then((r) => r.data),
  });

  if (isLoading)
    return <div className="p-3 text-xs text-muted">{t("common.loading")}</div>;
  if (!data) return null;

  const budget = data.project.budget;
  const pct = budget > 0 ? Math.min((data.actual_cost / budget) * 100, 100) : 0;
  const over = budget != null && data.actual_cost > budget;

  return (
    <div className="mt-2.5 pt-3 border-t border-line">
      {/* P&L */}
      <div className="grid grid-cols-3 gap-3 mb-3.5">
        <Stat
          label={t("projects.income")}
          value={fmt(data.income_total, currency)}
          cls="text-income"
        />
        <Stat
          label={t("projects.expenses")}
          value={fmt(data.expense_total, currency)}
          cls="text-expense"
        />
        <Stat
          label={t("projects.net")}
          value={fmt(data.net, currency)}
          cls={data.net >= 0 ? "text-income" : "text-expense"}
        />
      </div>

      {/* Budget vs actual */}
      {budget != null && (
        <div className="mb-3.5">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>
              {t("projects.spentOfBudget", {
                spent: fmt(data.actual_cost, currency),
                budget: fmt(budget, currency),
              })}
            </span>
            <span className={over ? "text-expense" : "text-muted"}>
              {t("projects.remaining")}: {fmt(data.budget_remaining, currency)}
            </span>
          </div>
          <div className="h-1.5 bg-line rounded-sm overflow-hidden">
            <div
              className={cx(
                "h-full rounded-sm",
                over ? "bg-expense" : "bg-brand",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {data.categories.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.5px] mb-1.5">
            {t("projects.breakdown")}
          </div>
          {data.categories.map((c) => (
            <div key={c.id} className="flex justify-between py-1 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: c.color || "var(--brand)" }}
                />
                {resolveCatName(c.name_key, c.name, t)}
              </span>
              <span
                className={
                  c.account_type === "revenue" ? "text-income" : "text-expense"
                }
              >
                {fmt(c.total, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hours (informational, separate from P&L) */}
      <div className="text-xs text-muted">
        {t("projects.hoursLogged", {
          total: Number(data.hours.total_hours),
          billable: Number(data.hours.billable_hours),
        })}
        {" · "}
        {t("projects.billableValue", {
          value: fmt(data.hours.billable_amount, currency),
        })}
      </div>
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────
function ProjectCard({ p, fmt, currency, onEdit, t }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const income = Number(p.income_total);
  const expense = Number(p.expense_total);
  const net = income - expense;

  const del = useMutation({
    mutationFn: () => api.delete(`/projects/${p.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <Card padding="none" className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div
          className="w-3 h-3 rounded-full shrink-0 mt-1"
          style={{ background: p.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink">{p.name}</span>
            <Badge tone={STATUS_TONES[p.status] || "neutral"}>
              {t(`projects.status_${p.status}`)}
            </Badge>
            {p.client_name && (
              <span className="text-[11px] text-muted">· {p.client_name}</span>
            )}
          </div>
          <div className="flex gap-3 flex-wrap text-xs text-muted mt-1">
            <span>
              {t("projects.income")}:{" "}
              <b className="text-income">{fmt(income, currency)}</b>
            </span>
            <span>
              {t("projects.expenses")}:{" "}
              <b className="text-expense">{fmt(expense, currency)}</b>
            </span>
            <span>
              {t("projects.net")}:{" "}
              <b className={net >= 0 ? "text-income" : "text-expense"}>
                {fmt(net, currency)}
              </b>
            </span>
            {p.budget != null && (
              <span>
                {t("projects.budget")}: {fmt(p.budget, currency)}
              </span>
            )}
            <span>{Number(p.total_hours)}h</span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-1.5 p-0 text-xs text-brand cursor-pointer"
          >
            <i
              className={`ti ${expanded ? "ti-chevron-up" : "ti-chevron-down"}`}
              aria-hidden="true"
            />
            {expanded ? t("projects.hideDetail") : t("projects.viewDetail")}
          </button>
          {expanded && (
            <ProjectSummary
              projectId={p.id}
              fmt={fmt}
              currency={currency}
              t={t}
            />
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => onEdit(p)}
            title={t("common.edit")}
            className="p-1 text-muted hover:text-ink cursor-pointer"
          >
            <i className="ti ti-pencil text-[15px]" aria-hidden="true" />
          </button>
          <button
            onClick={async () => {
              if (
                await confirmDialog({
                  message: t("projects.confirmDelete"),
                  danger: true,
                })
              )
                del.mutate();
            }}
            title={t("common.delete")}
            className="p-1 text-danger cursor-pointer"
          >
            <i className="ti ti-trash text-[15px]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </Card>
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
      api
        .get(`/projects${statusFilter ? `?status=${statusFilter}` : ""}`)
        .then((r) => r.data),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api.get("/clients").then((r) => r.data),
  });

  const close = () => {
    setShowModal(false);
    setEditItem(null);
  };
  const openEdit = (p) => {
    setEditItem(p);
    setShowModal(true);
  };

  return (
    <div className="fade-in max-w-[820px] mx-auto">
      <PageHeader
        title={t("projects.title")}
        subtitle={t("projects.subtitle")}
        actions={
          <>
            <Select
              className="w-[140px]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("projects.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`projects.status_${s}`)}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              icon="ti-plus"
              onClick={() => {
                setEditItem(null);
                setShowModal(true);
              }}
            >
              {t("projects.new")}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="p-10 text-center text-muted">{t("common.loading")}</div>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon="ti-briefcase"
            title={t("projects.noneTitle")}
            message={t("projects.noneHint")}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditItem(null);
                  setShowModal(true);
                }}
              >
                {t("projects.addFirst")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              fmt={fmt}
              currency={currency}
              onEdit={openEdit}
              t={t}
            />
          ))}
        </div>
      )}

      {showModal && (
        <ProjectModal
          onClose={close}
          clients={clients}
          editItem={editItem}
          t={t}
        />
      )}
    </div>
  );
}
