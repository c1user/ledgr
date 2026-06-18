import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";

const emptyForm = { name: "", type: "expense", color: "#4F8EF7", parentId: "" };

const COLOR_PRESETS = [
  "#00C896",
  "#4F8EF7",
  "#A259FF",
  "#F7934C",
  "#F7C948",
  "#E24B4A",
  "#5DCAA5",
  "#185FA5",
  "#534AB7",
  "#888780",
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
        ? api.put(`/categories/${editCategory.id}`, data)
        : api.post("/categories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
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
        style={{ width: "100%", maxWidth: 440, padding: 24 }}
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
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {editCategory
              ? t("categories.editTitle")
              : t("categories.newTitle")}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 20,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "0.5px solid var(--danger)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i
              className="ti ti-alert-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {error}
          </div>
        )}

        {editCategory?.is_system && (
          <div
            style={{
              background: "var(--payroll-bg)",
              color: "var(--payroll)",
              border: "0.5px solid var(--payroll)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i
              className="ti ti-info-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {t("categories.systemHint")}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="cat-name">
              {t("common.name")}
            </label>
            <input
              id="cat-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("categories.namePlaceholder")}
              disabled={editCategory?.is_system}
              required
              autoFocus
            />
          </div>

          {/* Type */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">{t("common.type")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["expense", "income"].map((catType) => (
                <button
                  key={catType}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, type: catType, parentId: "" })
                  }
                  disabled={!!editCategory}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 8,
                    border: "0.5px solid",
                    borderColor:
                      form.type === catType
                        ? catType === "income"
                          ? "var(--income)"
                          : "var(--expense)"
                        : "var(--border-color)",
                    background:
                      form.type === catType
                        ? catType === "income"
                          ? "var(--income-bg)"
                          : "var(--expense-bg)"
                        : "transparent",
                    color:
                      form.type === catType
                        ? catType === "income"
                          ? "var(--income)"
                          : "var(--expense)"
                        : "var(--text-muted)",
                    cursor: editCategory ? "not-allowed" : "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: editCategory ? 0.6 : 1,
                  }}
                >
                  {t(`common.${catType}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">{t("categories.color")}</label>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              {COLOR_PRESETS.map((c) => (
                <div
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    border:
                      form.color === c
                        ? "3px solid var(--text-primary)"
                        : "3px solid transparent",
                    transition: "border 0.15s",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: form.color,
                  flexShrink: 0,
                }}
              />
              <input
                className="input"
                type="text"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                placeholder="#000000"
                style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
            </div>
          </div>

          {/* Parent category */}
          {!editCategory?.is_system && parentOptions.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <label className="label" htmlFor="cat-parent">
                {t("categories.parentCategory")}
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontWeight: 400,
                    marginLeft: 4,
                  }}
                >
                  {t("categories.optional")}
                </span>
              </label>
              <select
                id="cat-parent"
                className="input"
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              >
                <option value="">{t("categories.noneTopLevel")}</option>
                {parentOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t("categories.saving")
                : editCategory
                  ? t("categories.saveChanges")
                  : t("categories.createCategory")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Category Card ─────────────────────────────────────────────
function CategoryCard({ category, subcategories, onEdit, onDelete, t }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: category.color,
              flexShrink: 0,
            }}
          />
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text-primary)",
              }}
            >
              {category.name}
              {category.is_system && (
                <span
                  style={{
                    fontSize: 10,
                    background: "var(--payroll-bg)",
                    color: "var(--payroll)",
                    padding: "1px 6px",
                    borderRadius: 3,
                    marginLeft: 6,
                    fontWeight: 400,
                  }}
                >
                  {t("categories.system")}
                </span>
              )}
            </div>
            {category.parent_name && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 1,
                }}
              >
                {t("categories.under", { parent: category.parent_name })}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => onEdit(category)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
            }}
            title={t("common.edit")}
          >
            <i
              className="ti ti-pencil"
              style={{ fontSize: 15 }}
              aria-hidden="true"
            />
          </button>
          {!category.is_system && (
            <button
              onClick={() => onDelete(category)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--danger)",
                padding: 4,
              }}
              title={t("common.delete")}
            >
              <i
                className="ti ti-trash"
                style={{ fontSize: 15 }}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>

      {/* Subcategories */}
      {subcategories?.length > 0 && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "0.5px solid var(--border-color)",
          }}
        >
          {subcategories.map((sub) => (
            <div
              key={sub.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "5px 0 5px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: sub.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {sub.name}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => onEdit(sub)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    padding: 4,
                  }}
                >
                  <i
                    className="ti ti-pencil"
                    style={{ fontSize: 13 }}
                    aria-hidden="true"
                  />
                </button>
                <button
                  onClick={() => onDelete(sub)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--danger)",
                    padding: 4,
                  }}
                >
                  <i
                    className="ti ti-trash"
                    style={{ fontSize: 13 }}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Categories Page ──────────────────────────────────────
export default function Categories() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editCategory, setEditCategory] = useState(null);
  const [activeTab, setActiveTab] = useState("expense");

  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/categories/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["categories"] }),
    onError: (err) =>
      alert(err.response?.data?.error || t("categories.deleteFailed")),
  });

  const handleEdit = (cat) => {
    setEditCategory(cat);
    setShowModal(true);
  };
  const handleClose = () => {
    setShowModal(false);
    setEditCategory(null);
  };
  const handleDelete = (cat) => {
    if (window.confirm(t("categories.confirmDelete", { name: cat.name }))) {
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
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 4,
            }}
          >
            {t("categories.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("categories.countSummary", {
              expense: expenseCount,
              income: incomeCount,
            })}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <i className="ti ti-plus" aria-hidden="true" />{" "}
          {t("categories.addCategory")}
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "0.5px solid var(--border-color)",
        }}
      >
        {["expense", "income"].map((catType) => (
          <button
            key={catType}
            onClick={() => setActiveTab(catType)}
            style={{
              padding: "8px 20px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color:
                activeTab === catType ? "var(--brand)" : "var(--text-muted)",
              borderBottom:
                activeTab === catType
                  ? "2px solid var(--brand)"
                  : "2px solid transparent",
              fontWeight: activeTab === catType ? 500 : 400,
            }}
          >
            {t(`common.${catType}`)} (
            {catType === "expense" ? expenseCount : incomeCount})
          </button>
        ))}
      </div>

      {/* Category list */}
      {isLoading ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          {t("common.loading")}
        </div>
      ) : topLevel.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <i
            className="ti ti-tag-off"
            style={{ fontSize: 40, color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <div
            style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 12 }}
          >
            {t("categories.noneYet", {
              type: t(`common.${activeTab}`).toLowerCase(),
            })}
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => setShowModal(true)}
          >
            {t("categories.addFirst")}
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 10,
          }}
        >
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
