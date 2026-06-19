import { useState, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import useInventoryStore from "../store/inventoryStore";

// ── helpers ────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt$ = (n) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtQty = (n) =>
  n == null ? "0" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });

const INPUT = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-color)",
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  fontSize: 13,
  boxSizing: "border-box",
};

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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: 24, width: 500, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border-color)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {product ? t("inventory.editProduct") : t("inventory.newProduct")}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20 }}>×</button>
        </div>

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.productName")} *</label>
            <input style={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("inventory.productNamePlaceholder")} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.sku")}</label>
            <input style={INPUT} value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="SKU-001" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.category")}</label>
            <select style={INPUT} value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">{t("inventory.noCategory")}</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.unitCost")}</label>
            <input style={INPUT} type="number" min="0" step="0.01" value={form.unitCost} onChange={(e) => set("unitCost", e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.sellPrice")}</label>
            <input style={INPUT} type="number" min="0" step="0.01" value={form.sellPrice} onChange={(e) => set("sellPrice", e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.reorderPoint")}</label>
            <input style={INPUT} type="number" min="0" step="1" value={form.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.valuationMethod")}</label>
            <select style={INPUT} value={form.valuationMethod} onChange={(e) => set("valuationMethod", e.target.value)}>
              <option value="avg">{t("inventory.avgCost")}</option>
              <option value="fifo">{t("inventory.fifo")}</option>
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.description")}</label>
            <textarea style={{ ...INPUT, resize: "vertical", minHeight: 60 }} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          {product && (
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
              <label htmlFor="isActive" style={{ fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>{t("inventory.active")}</label>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border-color)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>
            {t("common.cancel")}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--brand)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            {saving ? t("inventory.saving") : product ? t("inventory.saveChanges") : t("inventory.createProduct")}
          </button>
        </div>
      </div>
    </div>
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
    setErr("");
    onSave({ ...form, productId: product.id });
  };

  const total =
    form.quantity && form.unitCost
      ? (parseFloat(form.quantity) * parseFloat(form.unitCost)).toFixed(2)
      : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: 24, width: 420, maxWidth: "95vw", border: "1px solid var(--border-color)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("inventory.receiveStock")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{product?.name}</div>

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.quantity")} *</label>
              <input style={INPUT} type="number" min="0.001" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.unitCostReceive")}</label>
              <input style={INPUT} type="number" min="0" step="0.01" value={form.unitCost} onChange={(e) => set("unitCost", e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {total != null && (
            <div style={{ background: "var(--bg-secondary)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
              {t("inventory.totalCost")}: <strong>{fmt$(total)}</strong>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.notes")}</label>
            <input style={INPUT} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("inventory.notesPlaceholder")} />
          </div>

          <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={form.createTransaction} onChange={(e) => set("createTransaction", e.target.checked)} />
              {t("inventory.createPurchaseTx")}
            </label>
          </div>

          {form.createTransaction && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.date")}</label>
                <input style={INPUT} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.account")}</label>
                <select style={INPUT} value={form.accountId} onChange={(e) => set("accountId", e.target.value)}>
                  <option value="">{t("inventory.selectAccount")}</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.expenseCategory")}</label>
                <select style={INPUT} value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">{t("inventory.noCategoryTx")}</option>
                  {categories?.filter((c) => c.type === "expense").map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border-color)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>
            {t("common.cancel")}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--brand)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            {saving ? t("inventory.saving") : t("inventory.receiveStock")}
          </button>
        </div>
      </div>
    </div>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--bg-primary)", borderRadius: 10, padding: 24, width: 380, maxWidth: "95vw", border: "1px solid var(--border-color)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("inventory.adjustStock")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          {product?.name} · {t("inventory.currentQty")}: <strong>{fmtQty(product?.qty_on_hand)}</strong>
        </div>

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              {t("inventory.adjustmentQty")} <span style={{ fontWeight: 400 }}>({t("inventory.adjustmentHint")})</span>
            </label>
            <input style={INPUT} type="number" step="any" value={form.delta} onChange={(e) => set("delta", e.target.value)} placeholder="+10 or -5" />
          </div>
          {form.delta && !isNaN(parseFloat(form.delta)) && (
            <div style={{ background: "var(--bg-secondary)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
              {t("inventory.newQty")}: <strong style={{ color: newQty < 0 ? "var(--danger)" : "var(--text-primary)" }}>{fmtQty(newQty)}</strong>
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{t("inventory.reason")}</label>
            <input style={INPUT} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("inventory.reasonPlaceholder")} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border-color)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>
            {t("common.cancel")}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--brand)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            {saving ? t("inventory.saving") : t("inventory.applyAdjustment")}
          </button>
        </div>
      </div>
    </div>
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

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

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
    queryFn: () => api.get(`/products/${expandedId}`).then((r) => r.data.movements),
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
        qc.invalidateQueries({ queryKey: ["product-movements", receiveModal.product.id] });
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
        qc.invalidateQueries({ queryKey: ["product-movements", adjustModal.product.id] });
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

  const handleDelete = (product) => {
    if (!window.confirm(t("inventory.confirmDelete", { name: product.name }))) return;
    deleteProduct.mutate(product.id);
  };

  const tabStyle = (active) => ({
    padding: "6px 16px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    background: active ? "var(--brand)" : "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
    transition: "all 0.15s",
  });

  const moveBadge = (type) => {
    const map = {
      receive: { bg: "rgba(56,161,105,0.15)", color: "#276749" },
      sale: { bg: "rgba(229,62,62,0.1)", color: "#c53030" },
      adjustment: { bg: "rgba(79,142,247,0.1)", color: "#2b6cb0" },
      return: { bg: "rgba(128,90,213,0.12)", color: "#553c9a" },
    };
    const s = map[type] || map.adjustment;
    return (
      <span style={{ padding: "2px 7px", borderRadius: 4, fontWeight: 500, fontSize: 11, background: s.bg, color: s.color }}>
        {t(`inventory.move_${type}`)}
      </span>
    );
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            {t("inventory.title")}
            {reorderCount > 0 && (
              <span style={{ background: "#e53e3e", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 10 }}>
                {reorderCount}
              </span>
            )}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            {products.length} {t("inventory.productCount")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2, background: "var(--bg-secondary)", borderRadius: 8, padding: 4 }}>
            <button style={tabStyle(tab === "products")} onClick={() => setTab("products")}>{t("inventory.tabProducts")}</button>
            <button style={tabStyle(tab === "valuation")} onClick={() => setTab("valuation")}>{t("inventory.tabValuation")}</button>
          </div>
          <button
            onClick={() => setProductModal({ open: true, product: null })}
            style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "var(--brand)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}
          >
            <i className="ti ti-plus" aria-hidden="true" />
            {t("inventory.addProduct")}
          </button>
        </div>
      </div>

      {/* Reorder alert */}
      {reorderCount > 0 && tab === "products" && (
        <div style={{ background: "rgba(229,62,62,0.08)", border: "1px solid rgba(229,62,62,0.25)", borderRadius: 8, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#c53030" }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 16 }} aria-hidden="true" />
          <strong>{reorderCount} {t("inventory.reorderAlert")}</strong>
        </div>
      )}

      {/* Products Tab */}
      {tab === "products" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loadingP ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</div>
          ) : products.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <i className="ti ti-box" style={{ fontSize: 40, color: "var(--text-muted)", display: "block", marginBottom: 12 }} aria-hidden="true" />
              <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{t("inventory.noProducts")}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("inventory.noProductsHint")}</div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-secondary)" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.product")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.qty")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.unitCost")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.stockValue")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.sellPrice")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      style={{ borderBottom: "1px solid var(--border-color)", cursor: "pointer", background: expandedId === p.id ? "var(--bg-secondary)" : "transparent", transition: "background 0.1s" }}
                      onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    >
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.category_color || "var(--text-muted)", flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 500, color: p.is_active ? "var(--text-primary)" : "var(--text-muted)" }}>
                              {p.name}
                              {!p.is_active && (
                                <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>({t("inventory.inactive")})</span>
                              )}
                            </div>
                            {p.sku && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>SKU: {p.sku}</div>}
                            {p.category_name && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.category_name}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <span style={{
                          fontWeight: 600,
                          color: p.needs_reorder ? "#e53e3e" : "var(--text-primary)",
                          background: p.needs_reorder ? "rgba(229,62,62,0.1)" : "transparent",
                          padding: p.needs_reorder ? "2px 8px" : "0",
                          borderRadius: 4,
                        }}>
                          {fmtQty(p.qty_on_hand)}
                        </span>
                        {p.needs_reorder && (
                          <div style={{ fontSize: 10, color: "#e53e3e", marginTop: 2 }}>
                            {t("inventory.belowReorder")} {fmtQty(p.reorder_point)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--text-secondary)" }}>{fmt$(p.unit_cost)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 500 }}>{fmt$(p.stock_value)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--text-secondary)" }}>{p.sell_price ? fmt$(p.sell_price) : "—"}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => setReceiveModal({ open: true, product: p })}
                            title={t("inventory.receiveStock")}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border-color)", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}
                          >
                            <i className="ti ti-arrow-bar-down" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => setAdjustModal({ open: true, product: p })}
                            title={t("inventory.adjustStock")}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border-color)", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}
                          >
                            <i className="ti ti-adjustments-horizontal" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => setProductModal({ open: true, product: p })}
                            title={t("common.edit")}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border-color)", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}
                          >
                            <i className="ti ti-edit" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            title={t("common.delete")}
                            style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(229,62,62,0.3)", background: "transparent", cursor: "pointer", fontSize: 13, color: "#e53e3e" }}
                          >
                            <i className="ti ti-trash" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--bg-secondary)", padding: "12px 16px 16px 44px", borderBottom: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {t("inventory.stockHistory")}
                          </div>
                          {!expandedMovements ? (
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("common.loading")}</div>
                          ) : expandedMovements.length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("inventory.noMovements")}</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {expandedMovements.map((m) => (
                                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                                  {moveBadge(m.movement_type)}
                                  <span style={{ fontWeight: 600, color: parseFloat(m.quantity) > 0 ? "#276749" : "#c53030" }}>
                                    {parseFloat(m.quantity) > 0 ? "+" : ""}{fmtQty(m.quantity)}
                                  </span>
                                  {m.unit_cost && <span style={{ color: "var(--text-muted)" }}>@ {fmt$(m.unit_cost)}</span>}
                                  {m.notes && <span style={{ color: "var(--text-muted)" }}>— {m.notes}</span>}
                                  <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>
                                    {new Date(m.created_at).toLocaleDateString(i18n.language === "es" ? "es-PR" : "en-US")}
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
        </div>
      )}

      {/* Valuation Tab */}
      {tab === "valuation" && (
        <div>
          {loadingV ? (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 20 }}>
                <div className="card">
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{t("inventory.totalStockValue")}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt$(valuation?.total_value)}</div>
                </div>
                <div className="card">
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{t("inventory.totalProducts")}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{valuation?.products?.length || 0}</div>
                </div>
              </div>

              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-secondary)" }}>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.product")}</th>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.category")}</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.qty")}</th>
                      <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.method")}</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.unitCost")}</th>
                      <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--text-muted)", fontSize: 12 }}>{t("inventory.value")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation?.products?.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                        <td style={{ padding: "11px 16px" }}>
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          {p.sku && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>SKU: {p.sku}</div>}
                        </td>
                        <td style={{ padding: "11px 16px", color: "var(--text-secondary)" }}>{p.category_name || "—"}</td>
                        <td style={{ padding: "11px 16px", textAlign: "right" }}>{fmtQty(p.qty_on_hand)}</td>
                        <td style={{ padding: "11px 16px", textAlign: "center" }}>
                          <span style={{
                            fontSize: 11, padding: "2px 7px", borderRadius: 4, fontWeight: 500,
                            background: p.valuation_method === "fifo" ? "rgba(56,161,105,0.15)" : "rgba(79,142,247,0.1)",
                            color: p.valuation_method === "fifo" ? "#276749" : "#2b6cb0",
                          }}>
                            {p.valuation_method.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text-secondary)" }}>{fmt$(p.unit_cost)}</td>
                        <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 600 }}>{fmt$(p.stock_value)}</td>
                      </tr>
                    ))}
                    {valuation?.products?.length > 0 && (
                      <tr style={{ background: "var(--bg-secondary)", borderTop: "2px solid var(--border-color)" }}>
                        <td colSpan={5} style={{ padding: "11px 16px", fontWeight: 600, textAlign: "right", color: "var(--text-secondary)" }}>
                          {t("inventory.totalValue")}
                        </td>
                        <td style={{ padding: "11px 16px", fontWeight: 700, textAlign: "right" }}>{fmt$(valuation?.total_value)}</td>
                      </tr>
                    )}
                    {(!valuation?.products || valuation.products.length === 0) && (
                      <tr>
                        <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                          {t("inventory.noProducts")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
