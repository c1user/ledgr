import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";

const MATCH_TYPES = ["contains", "equals", "regex"];

const emptyForm = {
  name: "",
  match_type: "contains",
  pattern: "",
  category_id: "",
  is_active: true,
};

// ── Match type pill ───────────────────────────────────────────
function MatchTypePills({ value, onChange, t }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {MATCH_TYPES.map((mt) => (
        <button
          key={mt}
          type="button"
          className={`btn btn-sm ${value === mt ? "btn-primary" : "btn-secondary"}`}
          onClick={() => onChange(mt)}
        >
          {t(`rules.${mt}`)}
        </button>
      ))}
    </div>
  );
}

// ── Test preview ──────────────────────────────────────────────
function TestPreview({ matchType, pattern, t }) {
  const enabled = !!matchType && pattern.length > 1;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["rules-test", matchType, pattern],
    queryFn: () =>
      api.post("/rules/test", { match_type: matchType, pattern }).then((r) => r.data),
    enabled,
    staleTime: 0,
    retry: false,
  });

  if (!enabled) return null;
  if (isFetching) return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>…</div>
  );
  if (isError || data?.error) return (
    <div style={{ fontSize: 12, color: "var(--expense, #ef4444)", marginTop: 6 }}>
      {t("rules.testError")}
    </div>
  );
  if (!data) return null;

  const samples = (data.samples || [])
    .map((s) => s.merchant)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return (
    <div style={{ fontSize: 12, color: "var(--income, #22c55e)", marginTop: 6 }}>
      {t("rules.testResult", { count: data.count })}
      {samples && (
        <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
          {t("rules.testSamples", { samples })}
        </span>
      )}
    </div>
  );
}

// ── Rule modal ────────────────────────────────────────────────
function RuleModal({ rule, onClose, categories, t }) {
  const isEdit = !!rule?.id;
  const qc = useQueryClient();

  const [form, setForm] = useState(
    rule
      ? {
          name: rule.name,
          match_type: rule.match_type,
          pattern: rule.pattern,
          category_id: rule.category_id,
          is_active: rule.is_active,
        }
      : { ...emptyForm },
  );
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? api.put(`/rules/${rule.id}`, data).then((r) => r.data)
        : api.post("/rules", data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || t("rules.saveFailed")),
  });

  function validate() {
    if (!form.name.trim()) return t("rules.errNameRequired");
    if (!form.pattern.trim()) return t("rules.errPatternRequired");
    if (!form.category_id) return t("rules.errCategoryRequired");
    return null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    saveMutation.mutate(form);
  }

  // Group categories by type for the optgroup selector
  const incomeCategories = (categories || []).filter((c) => c.type === "income");
  const expenseCategories = (categories || []).filter((c) => c.type === "expense");

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
        style={{ width: "100%", maxWidth: 480, padding: 24, maxHeight: "90vh", overflow: "auto" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            {isEdit ? t("rules.editTitle") : t("rules.newTitle")}
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Name */}
          <div>
            <label className="label">{t("rules.ruleName")}</label>
            <input
              className="input"
              type="text"
              placeholder={t("rules.namePlaceholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          {/* Match type */}
          <div>
            <label className="label" style={{ display: "block", marginBottom: 6 }}>
              {t("rules.matchType")}
            </label>
            <MatchTypePills
              value={form.match_type}
              onChange={(mt) => setForm({ ...form, match_type: mt })}
              t={t}
            />
          </div>

          {/* Pattern + test preview */}
          <div>
            <label className="label">{t("rules.pattern")}</label>
            <input
              className="input"
              type="text"
              placeholder={t("rules.patternPlaceholder")}
              value={form.pattern}
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              autoComplete="off"
            />
            <TestPreview matchType={form.match_type} pattern={form.pattern} t={t} />
          </div>

          {/* Category */}
          <div>
            <label className="label">{t("rules.assignCategory")}</label>
            <select
              className="input"
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              <option value="">{t("transactions.selectACategory")}</option>
              {expenseCategories.length > 0 && (
                <optgroup label={t("common.expense")}>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
              {incomeCategories.length > 0 && (
                <optgroup label={t("common.income")}>
                  {incomeCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Active toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              id="rule-active"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <label htmlFor="rule-active" style={{ fontSize: 13, color: "var(--text-primary)", cursor: "pointer" }}>
              {t("rules.active")}
            </label>
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "var(--expense, #ef4444)" }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending
                ? t("rules.saving")
                : isEdit
                ? t("rules.saveChanges")
                : t("rules.createRule")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Rule card ─────────────────────────────────────────────────
function RuleCard({ rule, index, total, onMoveUp, onMoveDown, onEdit, onDelete, t }) {
  const matchTypeLabelMap = {
    contains: "contains",
    equals: "=",
    regex: "regex",
  };

  return (
    <div
      className="card"
      style={{
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: rule.is_active ? 1 : 0.5,
      }}
    >
      {/* Priority badge */}
      <div
        style={{
          minWidth: 28,
          height: 28,
          borderRadius: 6,
          background: "var(--bg-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        {index + 1}
      </div>

      {/* Rule info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          {rule.name}
          {!rule.is_active && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 6, fontWeight: 400 }}>
              inactive
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              background: "var(--bg-secondary)",
              borderRadius: 4,
              padding: "1px 6px",
              fontFamily: "monospace",
            }}
          >
            {matchTypeLabelMap[rule.match_type]}
          </span>
          <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>
            "{rule.pattern}"
          </span>
          <span>→</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: rule.category_color || "#888",
                display: "inline-block",
              }}
            />
            {rule.category_name}
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              ({rule.category_type})
            </span>
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onMoveUp}
          disabled={index === 0}
          title={t("rules.moveUp")}
          style={{ padding: "4px 8px" }}
        >
          <i className="ti ti-chevron-up" style={{ fontSize: 14 }} />
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onMoveDown}
          disabled={index === total - 1}
          title={t("rules.moveDown")}
          style={{ padding: "4px 8px" }}
        >
          <i className="ti ti-chevron-down" style={{ fontSize: 14 }} />
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onEdit}
          style={{ padding: "4px 8px" }}
        >
          <i className="ti ti-pencil" style={{ fontSize: 14 }} />
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onDelete}
          style={{ padding: "4px 8px", color: "var(--expense, #ef4444)" }}
        >
          <i className="ti ti-trash" style={{ fontSize: 14 }} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Rules() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["rules"],
    queryFn: () => api.get("/rules").then((r) => r.data),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids) => api.post("/rules/reorder", { ids }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/rules/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  function move(index, direction) {
    const newRules = [...rules];
    const swapIndex = index + direction;
    [newRules[index], newRules[swapIndex]] = [newRules[swapIndex], newRules[index]];
    reorderMutation.mutate(newRules.map((r) => r.id));
  }

  function handleDelete(rule) {
    if (window.confirm(t("rules.confirmDelete", { name: rule.name }))) {
      deleteMutation.mutate(rule.id);
    }
  }

  function openEdit(rule) {
    setEditRule(rule);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditRule(null);
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            {t("rules.title")}
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
            {t("rules.subtitle")}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setEditRule(null); setShowModal(true); }}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <i className="ti ti-plus" style={{ fontSize: 15 }} />
          {t("rules.addRule")}
        </button>
      </div>

      {/* Rule list */}
      {isLoading && (
        <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          {t("common.loading")}
        </div>
      )}

      {!isLoading && rules.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <i className="ti ti-filter-cog" style={{ fontSize: 40, color: "var(--text-muted)", display: "block", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
            {t("rules.noRules")}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("rules.noRulesHint")}</div>
        </div>
      )}

      {!isLoading && rules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={index}
              total={rules.length}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onEdit={() => openEdit(rule)}
              onDelete={() => handleDelete(rule)}
              t={t}
            />
          ))}
        </div>
      )}

      {showModal && (
        <RuleModal
          rule={editRule}
          onClose={closeModal}
          categories={categories}
          t={t}
        />
      )}
    </div>
  );
}
