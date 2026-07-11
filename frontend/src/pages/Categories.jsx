import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { coaToCategories } from "../lib/coaCategories";
import { confirmDialog, toast } from "../store/feedbackStore";
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
  Tabs,
} from "../components/ui";

const emptyForm = { name: "", type: "expense", color: "#2F6BC6", parentId: "" };

// Categorical presets harmonized with the "Ink & plum" identity.
const COLOR_PRESETS = [
  "#5B3A9B",
  "#7D63C4",
  "#9C2F6F",
  "#C24E24",
  "#A6543F",
  "#B88A1F",
  "#1E7A5B",
  "#4C8F8A",
  "#2F6BC6",
  "#6B6880",
];

// ── Category Modal ────────────────────────────────────────────
function CategoryModal({ onClose, editCategory, categories, t }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    editCategory
      ? {
          name: editCategory.name,
          type: editCategory.type,
          color: editCategory.color,
          parentId: editCategory.parent_id || "",
        }
      : emptyForm,
  );
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data) =>
      editCategory
        ? // COA accounts: type is immutable and parent isn't re-parentable,
          // so an edit only changes name + color.
          api.put(`/chart-of-accounts/${editCategory.id}`, {
            name: data.name,
            color: data.color,
          })
        : api.post("/chart-of-accounts", {
            name: data.name,
            accountType: data.type === "income" ? "revenue" : "expense",
            color: data.color,
            parentId: data.parentId,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("categories.saveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.name) return setError(t("categories.errNameRequired"));
    mutation.mutate({
      name: form.name,
      type: form.type,
      color: form.color,
      parentId: form.parentId || undefined,
    });
  };

  const parentOptions =
    categories?.filter(
      (c) => c.type === form.type && c.id !== editCategory?.id,
    ) || [];

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={editCategory ? t("categories.editTitle") : t("categories.newTitle")}
    >
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      {editCategory?.is_system && (
        <div className="bg-payroll-bg text-payroll border border-payroll rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-info-circle mr-1.5" aria-hidden="true" />
          {t("categories.systemHint")}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Name */}
        <Field label={t("common.name")} htmlFor="cat-name" className="mb-3.5">
          <Input
            id="cat-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("categories.namePlaceholder")}
            disabled={editCategory?.is_system}
            required
            autoFocus
          />
        </Field>

        {/* Type */}
        <Field label={t("common.type")} className="mb-3.5">
          <div className="flex gap-2">
            {["expense", "income"].map((catType) => (
              <button
                key={catType}
                type="button"
                onClick={() => setForm({ ...form, type: catType, parentId: "" })}
                disabled={!!editCategory}
                className={cx(
                  "flex-1 py-2 rounded-lg border text-md font-medium transition-colors",
                  editCategory
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer",
                  form.type === catType
                    ? catType === "income"
                      ? "border-income bg-income-bg text-income"
                      : "border-expense bg-expense-bg text-expense"
                    : "border-line bg-transparent text-muted",
                )}
              >
                {t(`common.${catType}`)}
              </button>
            ))}
          </div>
        </Field>

        {/* Color */}
        <Field label={t("categories.color")} className="mb-3.5">
          <div className="flex gap-2 flex-wrap mb-2">
            {COLOR_PRESETS.map((c) => (
              <div
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={cx(
                  "w-7 h-7 rounded-full cursor-pointer border-[3px] transition-colors",
                  form.color === c ? "border-ink" : "border-transparent",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg shrink-0"
              style={{ background: form.color }}
            />
            <Input
              type="text"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              placeholder="#000000"
              className="font-mono"
            />
          </div>
        </Field>

        {/* Parent category — only when creating (COA accounts aren't re-parentable) */}
        {!editCategory && parentOptions.length > 0 && (
          <Field
            label={t("categories.parentCategory")}
            hint={t("categories.optional")}
            htmlFor="cat-parent"
            className="mb-6"
          >
            <Select
              id="cat-parent"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">{t("categories.noneTopLevel")}</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t("categories.saving")
              : editCategory
                ? t("categories.saveChanges")
                : t("categories.createCategory")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Category Card ─────────────────────────────────────────────
function CategoryCard({ category, subcategories, onEdit, onDelete, t }) {
  return (
    <Card padding="none" className="px-4 py-3.5">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: category.color }}
          />
          <div>
            <div className="text-sm font-medium text-ink">
              {category.name}
              {category.is_system && (
                <span className="text-[10px] bg-payroll-bg text-payroll px-1.5 py-px rounded-sm ml-1.5 font-normal">
                  {t("categories.system")}
                </span>
              )}
            </div>
            {category.parent_name && (
              <div className="text-[11px] text-muted mt-px">
                {t("categories.under", { parent: category.parent_name })}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(category)}
            className="p-1 text-muted hover:text-ink cursor-pointer"
            title={t("common.edit")}
          >
            <i className="ti ti-pencil text-[15px]" aria-hidden="true" />
          </button>
          {!category.is_system && (
            <button
              onClick={() => onDelete(category)}
              className="p-1 text-danger cursor-pointer"
              title={t("common.delete")}
            >
              <i className="ti ti-trash text-[15px]" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Subcategories */}
      {subcategories?.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-line">
          {subcategories.map((sub) => (
            <div
              key={sub.id}
              className="flex justify-between items-center py-1 pl-4"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: sub.color }}
                />
                <span className="text-md text-secondary">{sub.name}</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => onEdit(sub)}
                  className="p-1 text-muted hover:text-ink cursor-pointer"
                >
                  <i className="ti ti-pencil text-md" aria-hidden="true" />
                </button>
                <button
                  onClick={() => onDelete(sub)}
                  className="p-1 text-danger cursor-pointer"
                >
                  <i className="ti ti-trash text-md" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Main Categories Page ──────────────────────────────────────
export default function Categories() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editCategory, setEditCategory] = useState(null);
  const [activeTab, setActiveTab] = useState("expense");

  const { data: coaGroups, isLoading } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const categories = useMemo(() => coaToCategories(coaGroups, t), [coaGroups, t]);

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/chart-of-accounts/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] }),
    onError: (err) =>
      toast.error(err.response?.data?.error || t("categories.deleteFailed")),
  });

  const handleEdit = (cat) => {
    setEditCategory(cat);
    setShowModal(true);
  };
  const handleClose = () => {
    setShowModal(false);
    setEditCategory(null);
  };
  const handleDelete = async (cat) => {
    if (
      await confirmDialog({
        message: t("categories.confirmDelete", { name: cat.name }),
        danger: true,
      })
    ) {
      deleteMutation.mutate(cat.id);
    }
  };

  // Separate top-level and subcategories
  const filtered = categories?.filter((c) => c.type === activeTab) || [];
  const topLevel = filtered.filter((c) => !c.parent_id);
  const subMap = filtered.reduce((acc, c) => {
    if (c.parent_id) {
      acc[c.parent_id] = [...(acc[c.parent_id] || []), c];
    }
    return acc;
  }, {});

  const expenseCount =
    categories?.filter((c) => c.type === "expense").length || 0;
  const incomeCount =
    categories?.filter((c) => c.type === "income").length || 0;

  return (
    <div className="fade-in">
      <PageHeader
        title={t("categories.title")}
        subtitle={t("categories.countSummary", {
          expense: expenseCount,
          income: incomeCount,
        })}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => setShowModal(true)}
          >
            {t("categories.addCategory")}
          </Button>
        }
      />

      {/* Tabs */}
      <Tabs
        className="mb-5"
        tabs={[
          { id: "expense", label: `${t("common.expense")} (${expenseCount})` },
          { id: "income", label: `${t("common.income")} (${incomeCount})` },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Category list */}
      {isLoading ? (
        <div className="p-8 text-center text-muted">{t("common.loading")}</div>
      ) : topLevel.length === 0 ? (
        <Card>
          <EmptyState
            icon="ti-tag-off"
            message={t("categories.noneYet", {
              type: t(`common.${activeTab}`).toLowerCase(),
            })}
            action={
              <Button variant="primary" onClick={() => setShowModal(true)}>
                {t("categories.addFirst")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
          {topLevel.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              subcategories={subMap[cat.id]}
              onEdit={handleEdit}
              onDelete={handleDelete}
              t={t}
            />
          ))}
        </div>
      )}

      {showModal && (
        <CategoryModal
          onClose={handleClose}
          editCategory={editCategory}
          categories={categories}
          t={t}
        />
      )}
    </div>
  );
}
