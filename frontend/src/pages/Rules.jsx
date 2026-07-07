import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { coaToCategories, resolveCatName } from "../lib/coaCategories";
import cx from "../lib/cx";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../components/ui";

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
    <div className="flex gap-1.5">
      {MATCH_TYPES.map((mt) => (
        <Button
          key={mt}
          size="sm"
          variant={value === mt ? "primary" : "secondary"}
          onClick={() => onChange(mt)}
        >
          {t(`rules.${mt}`)}
        </Button>
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
      api
        .post("/rules/test", { match_type: matchType, pattern })
        .then((r) => r.data),
    enabled,
    staleTime: 0,
    retry: false,
  });

  if (!enabled) return null;
  if (isFetching)
    return <div className="text-xs text-muted mt-1.5">…</div>;
  if (isError || data?.error)
    return (
      <div className="text-xs text-expense mt-1.5">{t("rules.testError")}</div>
    );
  if (!data) return null;

  const samples = (data.samples || [])
    .map((s) => s.merchant)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return (
    <div className="text-xs text-income mt-1.5">
      {t("rules.testResult", { count: data.count })}
      {samples && (
        <span className="text-muted ml-1">
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
    onError: (err) =>
      setError(err.response?.data?.error || t("rules.saveFailed")),
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
    if (err) {
      setError(err);
      return;
    }
    setError("");
    saveMutation.mutate(form);
  }

  // Group categories by type for the optgroup selector
  const incomeCategories = (categories || []).filter((c) => c.type === "income");
  const expenseCategories = (categories || []).filter(
    (c) => c.type === "expense",
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t("rules.editTitle") : t("rules.newTitle")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {/* Name */}
        <Field label={t("rules.ruleName")} className="mb-0">
          <Input
            type="text"
            placeholder={t("rules.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        {/* Match type */}
        <Field label={t("rules.matchType")} className="mb-0">
          <MatchTypePills
            value={form.match_type}
            onChange={(mt) => setForm({ ...form, match_type: mt })}
            t={t}
          />
        </Field>

        {/* Pattern + test preview */}
        <Field label={t("rules.pattern")} className="mb-0">
          <Input
            type="text"
            placeholder={t("rules.patternPlaceholder")}
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            autoComplete="off"
          />
          <TestPreview matchType={form.match_type} pattern={form.pattern} t={t} />
        </Field>

        {/* Category */}
        <Field label={t("rules.assignCategory")} className="mb-0">
          <Select
            value={form.category_id}
            onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          >
            <option value="">{t("transactions.selectACategory")}</option>
            {expenseCategories.length > 0 && (
              <optgroup label={t("common.expense")}>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {incomeCategories.length > 0 && (
              <optgroup label={t("common.income")}>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        {/* Active toggle */}
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            id="rule-active"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            className="w-4 h-4 cursor-pointer"
          />
          <label htmlFor="rule-active" className="text-md text-ink cursor-pointer">
            {t("rules.active")}
          </label>
        </div>

        {error && <div className="text-md text-expense">{error}</div>}

        <div className="flex gap-2.5 justify-end mt-1">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending
              ? t("rules.saving")
              : isEdit
                ? t("rules.saveChanges")
                : t("rules.createRule")}
          </Button>
        </div>
      </form>
    </Modal>
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
    <Card
      padding="none"
      className={cx(
        "flex items-center gap-3 px-4 py-3.5",
        !rule.is_active && "opacity-50",
      )}
    >
      {/* Priority badge */}
      <div className="flex items-center justify-center min-w-[28px] h-7 rounded-md bg-canvas text-xs font-semibold text-muted shrink-0">
        {index + 1}
      </div>

      {/* Rule info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink">
          {rule.name}
          {!rule.is_active && (
            <span className="text-[10px] text-muted ml-1.5 font-normal">
              inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted mt-0.5">
          <span className="bg-canvas rounded px-1.5 py-px font-mono">
            {matchTypeLabelMap[rule.match_type]}
          </span>
          <span className="font-mono text-ink">"{rule.pattern}"</span>
          <span>→</span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: rule.category_color || "#888" }}
            />
            {resolveCatName(rule.category_name_key, rule.category_name, t)}
            <span className="text-muted text-[11px]">
              ({rule.category_type})
            </span>
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1 items-center shrink-0">
        <Button
          size="sm"
          icon="ti-chevron-up"
          onClick={onMoveUp}
          disabled={index === 0}
          title={t("rules.moveUp")}
        />
        <Button
          size="sm"
          icon="ti-chevron-down"
          onClick={onMoveDown}
          disabled={index === total - 1}
          title={t("rules.moveDown")}
        />
        <Button size="sm" icon="ti-pencil" onClick={onEdit} />
        <Button size="sm" variant="danger" icon="ti-trash" onClick={onDelete} />
      </div>
    </Card>
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

  const { data: coaGroups = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const categories = coaToCategories(coaGroups, t);

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
    [newRules[index], newRules[swapIndex]] = [
      newRules[swapIndex],
      newRules[index],
    ];
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
    <div className="max-w-[760px] mx-auto">
      <PageHeader
        title={t("rules.title")}
        subtitle={t("rules.subtitle")}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => {
              setEditRule(null);
              setShowModal(true);
            }}
          >
            {t("rules.addRule")}
          </Button>
        }
      />

      {/* Rule list */}
      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {!isLoading && rules.length === 0 && (
        <Card>
          <EmptyState
            icon="ti-filter-cog"
            title={t("rules.noRules")}
            message={t("rules.noRulesHint")}
          />
        </Card>
      )}

      {!isLoading && rules.length > 0 && (
        <div className="flex flex-col gap-2">
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
