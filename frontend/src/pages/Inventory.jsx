import { useState, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import useInventoryStore from "../store/inventoryStore";
import { coaToCategories, resolveCatName } from "../lib/coaCategories";
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
  Select,
  Textarea,
} from "../components/ui";

// ── helpers ────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt$ = (n) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtQty = (n) =>
  n == null
    ? "0"
    : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });

const TH = "px-4 py-2.5 font-medium text-muted text-xs";
const TD = "px-4 py-3";

// ── ProductModal ────────────────────────────────────────────────
function ProductModal({ product, categories, onClose, onSave, saving }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: product?.name || "",
    sku: product?.sku || "",
    description: product?.description || "",
    unitCost: product?.unit_cost ?? "",
    sellPrice: product?.sell_price ?? "",
    reorderPoint: product?.reorder_point ?? 0,
    valuationMethod: product?.valuation_method || "avg",
    categoryId: product?.category_id || "",
    isActive: product?.is_active !== false,
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.name.trim()) {
      setErr(t("inventory.errNameRequired"));
      return;
    }
    setErr("");
    onSave(form);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? t("inventory.editProduct") : t("inventory.newProduct")}
    >
      {err && <div className="text-danger text-xs mb-3">{err}</div>}

      <div className="grid grid-cols-2 gap-3">
        <Field
          label={`${t("inventory.productName")} *`}
          className="col-span-2 mb-0"
        >
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t("inventory.productNamePlaceholder")}
          />
        </Field>
        <Field label={t("inventory.sku")} className="mb-0">
          <Input
            value={form.sku}
            onChange={(e) => set("sku", e.target.value)}
            placeholder="SKU-001"
          />
        </Field>
        <Field label={t("inventory.category")} className="mb-0">
          <Select
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
          >
            <option value="">{t("inventory.noCategory")}</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("inventory.unitCost")} className="mb-0">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(e) => set("unitCost", e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label={t("inventory.sellPrice")} className="mb-0">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.sellPrice}
            onChange={(e) => set("sellPrice", e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label={t("inventory.reorderPoint")} className="mb-0">
          <Input
            type="number"
            min="0"
            step="1"
            value={form.reorderPoint}
            onChange={(e) => set("reorderPoint", e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label={t("inventory.valuationMethod")} className="mb-0">
          <Select
            value={form.valuationMethod}
            onChange={(e) => set("valuationMethod", e.target.value)}
          >
            <option value="avg">{t("inventory.avgCost")}</option>
            <option value="fifo">{t("inventory.fifo")}</option>
          </Select>
        </Field>
        <Field label={t("inventory.description")} className="col-span-2 mb-0">
          <Textarea
            className="min-h-[60px]"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        {product && (
          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            <label
              htmlFor="isActive"
              className="text-md text-secondary cursor-pointer"
            >
              {t("inventory.active")}
            </label>
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end mt-5">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving
            ? t("inventory.saving")
            : product
              ? t("inventory.saveChanges")
              : t("inventory.createProduct")}
        </Button>
      </div>
    </Modal>
  );
}

// ── ReceiveModal ────────────────────────────────────────────────
function ReceiveModal({ product, accounts, categories, onClose, onSave, saving }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    quantity: "",
    unitCost: product?.unit_cost ?? "",
    notes: "",
    createTransaction: true,
    accountId: "",
    categoryId: "",
    date: todayStr(),
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.quantity || parseFloat(form.quantity) <= 0) {
      setErr(t("inventory.errQtyRequired"));
      return;
    }
    if (form.createTransaction && !form.accountId) {
      setErr(t("inventory.errAccountRequired"));
      return;
    }
    if (form.createTransaction && !form.categoryId) {
      setErr(t("inventory.errExpenseCategoryRequired"));
      return;
    }
    setErr("");
    onSave({ ...form, productId: product.id });
  };

  const total =
    form.quantity && form.unitCost
      ? (parseFloat(form.quantity) * parseFloat(form.unitCost)).toFixed(2)
      : null;

  return (
    <Modal open onClose={onClose} title={t("inventory.receiveStock")}>
      <div className="text-md text-muted -mt-1 mb-4">{product?.name}</div>

      {err && <div className="text-danger text-xs mb-3">{err}</div>}

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("inventory.quantity")} *`} className="mb-0">
            <Input
              type="number"
              min="0.001"
              step="1"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label={t("inventory.unitCostReceive")} className="mb-0">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.unitCost}
              onChange={(e) => set("unitCost", e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>

        {total != null && (
          <div className="bg-canvas rounded-md px-3 py-2 text-md">
            {t("inventory.totalCost")}: <strong>{fmt$(total)}</strong>
          </div>
        )}

        <Field label={t("inventory.notes")} className="mb-0">
          <Input
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("inventory.notesPlaceholder")}
          />
        </Field>

        <div className="border-t border-line pt-3">
          <label className="flex items-center gap-2 cursor-pointer text-md text-secondary">
            <input
              type="checkbox"
              checked={form.createTransaction}
              onChange={(e) => set("createTransaction", e.target.checked)}
            />
            {t("inventory.createPurchaseTx")}
          </label>
        </div>

        {form.createTransaction && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("inventory.date")} className="mb-0">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label={t("inventory.account")} className="mb-0">
              <Select
                value={form.accountId}
                onChange={(e) => set("accountId", e.target.value)}
              >
                <option value="">{t("inventory.selectAccount")}</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`${t("inventory.expenseCategory")} *`}
              className="col-span-2 mb-0"
            >
              <Select
                value={form.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                <option value="">{t("inventory.selectCategory")}</option>
                {categories
                  ?.filter((c) => c.type === "expense")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end mt-5">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("inventory.saving") : t("inventory.receiveStock")}
        </Button>
      </div>
    </Modal>
  );
}

// ── AdjustModal ─────────────────────────────────────────────────
function AdjustModal({ product, onClose, onSave, saving }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ delta: "", notes: "" });
  const [err, setErr] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    const delta = parseFloat(form.delta);
    if (!form.delta || isNaN(delta) || delta === 0) {
      setErr(t("inventory.errDeltaRequired"));
      return;
    }
    const newQty = parseFloat(product.qty_on_hand) + delta;
    if (newQty < 0) {
      setErr(t("inventory.errNegativeStock"));
      return;
    }
    setErr("");
    onSave({ productId: product.id, quantity: delta, notes: form.notes });
  };

  const delta = parseFloat(form.delta) || 0;
  const newQty = parseFloat(product?.qty_on_hand || 0) + delta;

  return (
    <Modal open onClose={onClose} size="sm" title={t("inventory.adjustStock")}>
      <div className="text-md text-muted -mt-1 mb-4">
        {product?.name} · {t("inventory.currentQty")}:{" "}
        <strong>{fmtQty(product?.qty_on_hand)}</strong>
      </div>

      {err && <div className="text-danger text-xs mb-3">{err}</div>}

      <div className="flex flex-col gap-3">
        <Field
          label={
            <>
              {t("inventory.adjustmentQty")}{" "}
              <span className="font-normal">({t("inventory.adjustmentHint")})</span>
            </>
          }
          className="mb-0"
        >
          <Input
            type="number"
            step="any"
            value={form.delta}
            onChange={(e) => set("delta", e.target.value)}
            placeholder="+10 or -5"
          />
        </Field>
        {form.delta && !isNaN(parseFloat(form.delta)) && (
          <div className="bg-canvas rounded-md px-3 py-2 text-md">
            {t("inventory.newQty")}:{" "}
            <strong className={newQty < 0 ? "text-danger" : "text-ink"}>
              {fmtQty(newQty)}
            </strong>
          </div>
        )}
        <Field label={t("inventory.reason")} className="mb-0">
          <Input
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("inventory.reasonPlaceholder")}
          />
        </Field>
      </div>

      <div className="flex gap-2 justify-end mt-5">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("inventory.saving") : t("inventory.applyAdjustment")}
        </Button>
      </div>
    </Modal>
  );
}

// ── Main ────────────────────────────────────────────────────────
export default function Inventory() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const setReorderCount = useInventoryStore((s) => s.setReorderCount);

  const [tab, setTab] = useState("products");
  const [productModal, setProductModal] = useState({ open: false, product: null });
  const [receiveModal, setReceiveModal] = useState({ open: false, product: null });
  const [adjustModal, setAdjustModal] = useState({ open: false, product: null });
  const [expandedId, setExpandedId] = useState(null);
  const [savingP, setSavingP] = useState(false);
  const [savingR, setSavingR] = useState(false);
  const [savingA, setSavingA] = useState(false);

  const { data: products = [], isLoading: loadingP } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: coaGroups = [] } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const categories = coaToCategories(coaGroups, t);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const { data: valuation, isLoading: loadingV } = useQuery({
    queryKey: ["inventory-valuation"],
    queryFn: () => api.get("/inventory/valuation").then((r) => r.data),
    enabled: tab === "valuation",
  });

  const { data: expandedMovements } = useQuery({
    queryKey: ["product-movements", expandedId],
    queryFn: () =>
      api.get(`/products/${expandedId}`).then((r) => r.data.movements),
    enabled: !!expandedId,
  });

  useEffect(() => {
    const count = products.filter((p) => p.needs_reorder).length;
    setReorderCount(count);
  }, [products, setReorderCount]);

  const reorderCount = products.filter((p) => p.needs_reorder).length;

  const createProduct = useMutation({
    mutationFn: (data) => api.post("/products", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setProductModal({ open: false, product: null });
    },
  });

  const updateProduct = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/products/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setProductModal({ open: false, product: null });
    },
  });

  const deleteProduct = useMutation({
    mutationFn: (id) => api.delete(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  const receiveStock = useMutation({
    mutationFn: (data) => api.post("/inventory/receive", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-valuation"] });
      if (receiveModal.product?.id) {
        qc.invalidateQueries({
          queryKey: ["product-movements", receiveModal.product.id],
        });
      }
      setReceiveModal({ open: false, product: null });
    },
  });

  const adjustStock = useMutation({
    mutationFn: (data) => api.post("/inventory/adjust", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-valuation"] });
      if (adjustModal.product?.id) {
        qc.invalidateQueries({
          queryKey: ["product-movements", adjustModal.product.id],
        });
      }
      setAdjustModal({ open: false, product: null });
    },
  });

  const handleProductSave = async (form) => {
    setSavingP(true);
    try {
      if (productModal.product) {
        await updateProduct.mutateAsync({ id: productModal.product.id, ...form });
      } else {
        await createProduct.mutateAsync(form);
      }
    } finally {
      setSavingP(false);
    }
  };

  const handleReceiveSave = async (form) => {
    setSavingR(true);
    try {
      await receiveStock.mutateAsync(form);
    } finally {
      setSavingR(false);
    }
  };

  const handleAdjustSave = async (form) => {
    setSavingA(true);
    try {
      await adjustStock.mutateAsync(form);
    } finally {
      setSavingA(false);
    }
  };

  const handleDelete = async (product) => {
    const ok = await confirmDialog({
      message: t("inventory.confirmDelete", { name: product.name }),
      danger: true,
    });
    if (!ok) return;
    deleteProduct.mutate(product.id);
  };

  const MOVE_TONES = {
    receive: "income",
    sale: "expense",
    adjustment: "payroll",
    return: "brand",
  };
  const moveBadge = (type) => (
    <Badge tone={MOVE_TONES[type] || "payroll"}>
      {t(`inventory.move_${type}`)}
    </Badge>
  );

  const iconBtn =
    "flex items-center justify-center px-2 py-1 rounded border border-line bg-transparent text-secondary cursor-pointer text-md hover:bg-canvas";

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[22px] font-bold text-ink">
            {t("inventory.title")}
            {reorderCount > 0 && (
              <span className="bg-danger text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                {reorderCount}
              </span>
            )}
          </h1>
          <p className="text-md text-muted mt-1">
            {products.length} {t("inventory.productCount")}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-0.5 bg-canvas rounded-lg p-1">
            {["products", "valuation"].map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={cx(
                  "px-4 py-1.5 rounded-md text-md cursor-pointer transition-all",
                  tab === tb
                    ? "bg-brand text-on-brand font-semibold"
                    : "bg-transparent text-secondary",
                )}
              >
                {tb === "products"
                  ? t("inventory.tabProducts")
                  : t("inventory.tabValuation")}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => setProductModal({ open: true, product: null })}
          >
            {t("inventory.addProduct")}
          </Button>
        </div>
      </div>

      {/* Reorder alert */}
      {reorderCount > 0 && tab === "products" && (
        <div className="flex items-center gap-2.5 bg-danger-bg border border-danger rounded-lg px-4 py-2.5 mb-4 text-md text-danger">
          <i className="ti ti-alert-triangle text-base" aria-hidden="true" />
          <strong>
            {reorderCount} {t("inventory.reorderAlert")}
          </strong>
        </div>
      )}

      {/* Products Tab */}
      {tab === "products" && (
        <Card padding="none" className="overflow-x-auto">
          {loadingP ? (
            <div className="p-10 text-center text-muted text-md">
              {t("common.loading")}
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              icon="ti-box"
              title={t("inventory.noProducts")}
              message={t("inventory.noProductsHint")}
              action={
                <Button
                  variant="primary"
                  icon="ti-plus"
                  onClick={() => setProductModal({ open: true, product: null })}
                >
                  {t("inventory.addProduct")}
                </Button>
              }
            />
          ) : (
            <table className="w-full border-collapse text-md min-w-[720px]">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className={cx(TH, "text-left")}>{t("inventory.product")}</th>
                  <th className={cx(TH, "text-right")}>{t("inventory.qty")}</th>
                  <th className={cx(TH, "text-right")}>
                    {t("inventory.unitCost")}
                  </th>
                  <th className={cx(TH, "text-right")}>
                    {t("inventory.stockValue")}
                  </th>
                  <th className={cx(TH, "text-right")}>
                    {t("inventory.sellPrice")}
                  </th>
                  <th className={cx(TH, "text-right")}>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      className={cx(
                        "border-b border-line cursor-pointer transition-colors",
                        expandedId === p.id ? "bg-canvas" : "hover:bg-canvas",
                      )}
                      onClick={() =>
                        setExpandedId(expandedId === p.id ? null : p.id)
                      }
                    >
                      <td className={TD}>
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              background: p.category_color || "var(--text-muted)",
                            }}
                          />
                          <div>
                            <div
                              className={cx(
                                "font-medium",
                                p.is_active ? "text-ink" : "text-muted",
                              )}
                            >
                              {p.name}
                              {!p.is_active && (
                                <span className="ml-1.5 text-[11px] text-muted">
                                  ({t("inventory.inactive")})
                                </span>
                              )}
                            </div>
                            {p.sku && (
                              <div className="text-[11px] text-muted mt-px">
                                SKU: {p.sku}
                              </div>
                            )}
                            {(p.category_name_key || p.category_name) && (
                              <div className="text-[11px] text-muted">
                                {resolveCatName(
                                  p.category_name_key,
                                  p.category_name,
                                  t,
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={cx(TD, "text-right")}>
                        <span
                          className={cx(
                            "font-semibold",
                            p.needs_reorder
                              ? "text-danger bg-danger-bg px-2 py-0.5 rounded"
                              : "text-ink",
                          )}
                        >
                          {fmtQty(p.qty_on_hand)}
                        </span>
                        {p.needs_reorder && (
                          <div className="text-[10px] text-danger mt-0.5">
                            {t("inventory.belowReorder")} {fmtQty(p.reorder_point)}
                          </div>
                        )}
                      </td>
                      <td className={cx(TD, "text-right text-secondary")}>
                        {fmt$(p.unit_cost)}
                      </td>
                      <td className={cx(TD, "text-right font-medium")}>
                        {fmt$(p.stock_value)}
                      </td>
                      <td className={cx(TD, "text-right text-secondary")}>
                        {p.sell_price ? fmt$(p.sell_price) : "—"}
                      </td>
                      <td
                        className={cx(TD, "text-right")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() =>
                              setReceiveModal({ open: true, product: p })
                            }
                            title={t("inventory.receiveStock")}
                            className={iconBtn}
                          >
                            <i className="ti ti-arrow-bar-down" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() =>
                              setAdjustModal({ open: true, product: p })
                            }
                            title={t("inventory.adjustStock")}
                            className={iconBtn}
                          >
                            <i
                              className="ti ti-adjustments-horizontal"
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            onClick={() =>
                              setProductModal({ open: true, product: p })
                            }
                            title={t("common.edit")}
                            className={iconBtn}
                          >
                            <i className="ti ti-edit" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            title={t("common.delete")}
                            className="flex items-center justify-center px-2 py-1 rounded border border-danger bg-transparent text-danger cursor-pointer text-md hover:bg-danger-bg"
                          >
                            <i className="ti ti-trash" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr>
                        <td
                          colSpan={6}
                          className="bg-canvas px-4 pb-4 pt-3 pl-11 border-b border-line"
                        >
                          <div className="text-[11px] font-semibold text-muted mb-2 uppercase tracking-[0.5px]">
                            {t("inventory.stockHistory")}
                          </div>
                          {!expandedMovements ? (
                            <div className="text-xs text-muted">
                              {t("common.loading")}
                            </div>
                          ) : expandedMovements.length === 0 ? (
                            <div className="text-xs text-muted">
                              {t("inventory.noMovements")}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {expandedMovements.map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center gap-3 text-xs"
                                >
                                  {moveBadge(m.movement_type)}
                                  <span
                                    className={cx(
                                      "font-semibold",
                                      parseFloat(m.quantity) > 0
                                        ? "text-income"
                                        : "text-expense",
                                    )}
                                  >
                                    {parseFloat(m.quantity) > 0 ? "+" : ""}
                                    {fmtQty(m.quantity)}
                                  </span>
                                  {m.unit_cost && (
                                    <span className="text-muted">
                                      @ {fmt$(m.unit_cost)}
                                    </span>
                                  )}
                                  {m.notes && (
                                    <span className="text-muted">— {m.notes}</span>
                                  )}
                                  <span className="text-muted ml-auto">
                                    {new Date(m.created_at).toLocaleDateString(
                                      i18n.language === "es" ? "es-PR" : "en-US",
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Valuation Tab */}
      {tab === "valuation" && (
        <div>
          {loadingV ? (
            <Card className="text-center text-muted text-md">
              {t("common.loading")}
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 mb-5">
                <Card>
                  <div className="text-xs text-muted mb-1">
                    {t("inventory.totalStockValue")}
                  </div>
                  <div className="text-[22px] font-bold text-ink">
                    {fmt$(valuation?.total_value)}
                  </div>
                </Card>
                <Card>
                  <div className="text-xs text-muted mb-1">
                    {t("inventory.totalProducts")}
                  </div>
                  <div className="text-[22px] font-bold text-ink">
                    {valuation?.products?.length || 0}
                  </div>
                </Card>
              </div>

              <Card padding="none" className="overflow-x-auto">
                <table className="w-full border-collapse text-md min-w-[720px]">
                  <thead>
                    <tr className="border-b border-line bg-canvas">
                      <th className={cx(TH, "text-left")}>
                        {t("inventory.product")}
                      </th>
                      <th className={cx(TH, "text-left")}>
                        {t("inventory.category")}
                      </th>
                      <th className={cx(TH, "text-right")}>
                        {t("inventory.qty")}
                      </th>
                      <th className={cx(TH, "text-center")}>
                        {t("inventory.method")}
                      </th>
                      <th className={cx(TH, "text-right")}>
                        {t("inventory.unitCost")}
                      </th>
                      <th className={cx(TH, "text-right")}>
                        {t("inventory.value")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation?.products?.map((p) => (
                      <tr key={p.id} className="border-b border-line">
                        <td className={TD}>
                          <div className="font-medium">{p.name}</div>
                          {p.sku && (
                            <div className="text-[11px] text-muted">
                              SKU: {p.sku}
                            </div>
                          )}
                        </td>
                        <td className={cx(TD, "text-secondary")}>
                          {resolveCatName(p.category_name_key, p.category_name, t) ||
                            "—"}
                        </td>
                        <td className={cx(TD, "text-right")}>
                          {fmtQty(p.qty_on_hand)}
                        </td>
                        <td className={cx(TD, "text-center")}>
                          <Badge
                            tone={p.valuation_method === "fifo" ? "income" : "payroll"}
                          >
                            {p.valuation_method.toUpperCase()}
                          </Badge>
                        </td>
                        <td className={cx(TD, "text-right text-secondary")}>
                          {fmt$(p.unit_cost)}
                        </td>
                        <td className={cx(TD, "text-right font-semibold")}>
                          {fmt$(p.stock_value)}
                        </td>
                      </tr>
                    ))}
                    {valuation?.products?.length > 0 && (
                      <tr className="bg-canvas border-t-2 border-line">
                        <td
                          colSpan={5}
                          className={cx(TD, "font-semibold text-right text-secondary")}
                        >
                          {t("inventory.totalValue")}
                        </td>
                        <td className={cx(TD, "font-bold text-right")}>
                          {fmt$(valuation?.total_value)}
                        </td>
                      </tr>
                    )}
                    {(!valuation?.products ||
                      valuation.products.length === 0) && (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-10 text-center text-muted text-md"
                        >
                          {t("inventory.noProducts")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {productModal.open && (
        <ProductModal
          product={productModal.product}
          categories={categories}
          onClose={() => setProductModal({ open: false, product: null })}
          onSave={handleProductSave}
          saving={savingP}
        />
      )}
      {receiveModal.open && receiveModal.product && (
        <ReceiveModal
          product={receiveModal.product}
          accounts={accounts}
          categories={categories}
          onClose={() => setReceiveModal({ open: false, product: null })}
          onSave={handleReceiveSave}
          saving={savingR}
        />
      )}
      {adjustModal.open && adjustModal.product && (
        <AdjustModal
          product={adjustModal.product}
          onClose={() => setAdjustModal({ open: false, product: null })}
          onSave={handleAdjustSave}
          saving={savingA}
        />
      )}
    </div>
  );
}
