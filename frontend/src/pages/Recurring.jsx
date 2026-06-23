import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { coaToCategories } from "../lib/coaCategories";

const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "yearly"];

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const today = () => dayjs().format("YYYY-MM-DD");

const makeEmptyForm = () => ({
  accountId: "", // prefixed "acct:<id>" | "coa:<id>"
  categoryId: "",
  type: "expense",
  merchant: "",
  amount: "",
  frequency: "monthly",
  startDate: today(),
  endDate: "",
  notes: "",
  isActive: true,
});

// Derive the asset/liability ledger accounts that can fund a recurring entry,
// excluding the COA "twin" of each operational account (same logic as the
// transaction form).
function deriveLedgerAccounts(coaGroups, accounts, t) {
  if (!coaGroups) return [];
  const twinIds = new Set(
    (accounts || []).map((a) => a.coa_account_id).filter(Boolean),
  );
  const out = [];
  const walk = (acc) => {
    if (!twinIds.has(acc.id))
      out.push({
        id: acc.id,
        name: acc.name_key ? t(acc.name_key) : acc.name,
        code: acc.code,
      });
    acc.children?.forEach(walk);
  };
  for (const g of coaGroups) {
    if (g.account_type === "asset" || g.account_type === "liability")
      g.accounts.forEach(walk);
  }
  return out;
}

// ── Create / edit modal ──────────────────────────────────────
function RecurringModal({
  onClose,
  accounts,
  ledgerAccounts,
  categories,
  editItem,
  t,
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => {
    if (editItem) {
      return {
        accountId: editItem.funding_coa_id
          ? `coa:${editItem.funding_coa_id}`
          : `acct:${editItem.account_id}`,
        categoryId: editItem.category_account_id || "",
        type: editItem.type,
        merchant: editItem.merchant || "",
        amount: String(editItem.amount),
        frequency: editItem.frequency,
        startDate: editItem.start_date,
        endDate: editItem.end_date || "",
        notes: editItem.notes || "",
        isActive: editItem.is_active,
      };
    }
    return makeEmptyForm();
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data) =>
      editItem
        ? api.put(`/recurring/${editItem.id}`, data)
        : api.post("/recurring", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("recurring.saveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.accountId) return setError(t("recurring.errSelectAccount"));
    if (!form.categoryId) return setError(t("recurring.errSelectCategory"));
    if (!form.amount || parseFloat(form.amount) <= 0)
      return setError(t("recurring.errValidAmount"));

    const isLedger = form.accountId.startsWith("coa:");
    const fundingId = form.accountId.replace(/^(coa|acct):/, "");

    mutation.mutate({
      ...(isLedger ? { fundingCoaId: fundingId } : { accountId: fundingId }),
      categoryId: form.categoryId,
      type: form.type,
      merchant: form.merchant || undefined,
      amount: parseFloat(form.amount),
      frequency: form.frequency,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      notes: form.notes || undefined,
      isActive: form.isActive,
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
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
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
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            {editItem ? t("recurring.editTitle") : t("recurring.newTitle")}
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
            <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Type toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {["expense", "income"].map((txType) => (
              <button
                key={txType}
                type="button"
                onClick={() => setForm({ ...form, type: txType, categoryId: "" })}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 8,
                  border: "0.5px solid",
                  borderColor:
                    form.type === txType
                      ? txType === "income"
                        ? "var(--income)"
                        : "var(--expense)"
                      : "var(--border-color)",
                  background:
                    form.type === txType
                      ? txType === "income"
                        ? "var(--income-bg)"
                        : "var(--expense-bg)"
                      : "transparent",
                  color:
                    form.type === txType
                      ? txType === "income"
                        ? "var(--income)"
                        : "var(--expense)"
                      : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <i
                  className={`ti ${txType === "income" ? "ti-arrow-down-left" : "ti-arrow-up-right"}`}
                  style={{ marginRight: 6 }}
                  aria-hidden="true"
                />
                {t(`common.${txType}`)}
              </button>
            ))}
          </div>

          {/* Amount + Frequency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label className="label" htmlFor="amount">{t("common.amount")}</label>
              <input
                id="amount"
                className="input"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="frequency">{t("recurring.frequency")}</label>
              <select
                id="frequency"
                className="input"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{t(`recurring.freq_${f}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Start + End date */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label className="label" htmlFor="startDate">{t("recurring.startDate")}</label>
              <input
                id="startDate"
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="endDate">{t("recurring.endDateOptional")}</label>
              <input
                id="endDate"
                className="input"
                type="date"
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>

          {/* Funding account */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="accountId">{t("recurring.fundingAccount")}</label>
            <select
              id="accountId"
              className="input"
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              required
            >
              <option value="">{t("recurring.selectAccount")}</option>
              {accounts?.length > 0 && (
                <optgroup label={t("transactions.bankAccounts")}>
                  {accounts.map((a) => (
                    <option key={a.id} value={`acct:${a.id}`}>{a.name}</option>
                  ))}
                </optgroup>
              )}
              {ledgerAccounts?.length > 0 && (
                <optgroup label={t("transactions.ledgerAccounts")}>
                  {ledgerAccounts.map((a) => (
                    <option key={a.id} value={`coa:${a.id}`}>
                      {a.code ? `${a.code} · ${a.name}` : a.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Category */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="categoryId">{t("common.category")}</label>
            <select
              id="categoryId"
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              required
            >
              <option value="">{t("recurring.selectCategory")}</option>
              {categories
                ?.filter((c) => c.type === form.type)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>

          {/* Merchant */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="merchant">{t("transactions.merchantDescription")}</label>
            <input
              id="merchant"
              className="input"
              type="text"
              placeholder={t("recurring.merchantPlaceholder")}
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label className="label" htmlFor="notes">{t("common.notes")}</label>
            <input
              id="notes"
              className="input"
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending
                ? t("recurring.saving")
                : editItem
                  ? t("common.save")
                  : t("recurring.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Generated-transactions expand ────────────────────────────
function GeneratedList({ recurringId, fmt, currency, t }) {
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["recurring-txs", recurringId],
    queryFn: () =>
      api.get(`/recurring/${recurringId}/transactions`).then((r) => r.data),
  });

  if (isLoading)
    return (
      <div style={{ padding: "8px 0", fontSize: 12, color: "var(--text-muted)" }}>
        {t("common.loading")}
      </div>
    );
  if (txs.length === 0)
    return (
      <div style={{ padding: "8px 0", fontSize: 12, color: "var(--text-muted)" }}>
        {t("recurring.noGenerated")}
      </div>
    );

  return (
    <div style={{ marginTop: 8, borderTop: "0.5px solid var(--border-color)" }}>
      {txs.map((tx) => (
        <div
          key={tx.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            fontSize: 12,
            color: "var(--text-secondary)",
            borderBottom: "0.5px solid var(--border-color)",
          }}
        >
          <span>{dayjs(tx.date).format("MMM D, YYYY")}</span>
          <span style={{ fontWeight: 500 }}>{fmt(tx.total_amount, currency)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Template card ────────────────────────────────────────────
function RecurringCard({ item, fmt, currency, onEdit, t }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const isDue = item.is_active && item.next_due <= today();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["recurring"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-txs", item.id] });
  };

  const toggleActive = useMutation({
    mutationFn: () =>
      api.patch(`/recurring/${item.id}/active`, { isActive: !item.is_active }),
    onSuccess: invalidate,
  });
  const skip = useMutation({
    mutationFn: () => api.post(`/recurring/${item.id}/skip`),
    onSuccess: invalidate,
  });
  const generate = useMutation({
    mutationFn: () => api.post(`/recurring/${item.id}/generate`),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/recurring/${item.id}`),
    onSuccess: invalidate,
  });

  const busy =
    toggleActive.isPending || skip.isPending || generate.isPending || del.isPending;

  // Status pill
  let status = { label: t("recurring.active"), bg: "var(--income-bg)", color: "var(--income)" };
  if (!item.is_active)
    status = { label: t("recurring.paused"), bg: "var(--bg-secondary)", color: "var(--text-muted)" };
  else if (isDue)
    status = { label: t("recurring.due"), bg: "var(--expense-bg)", color: "var(--expense)" };

  const iconBg = item.type === "income" ? "var(--income-bg)" : "var(--expense-bg)";
  const iconColor = item.type === "income" ? "var(--income)" : "var(--expense)";

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: iconBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <i className="ti ti-repeat" style={{ fontSize: 16, color: iconColor }} aria-hidden="true" />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
              {item.merchant || t("recurring.untitled")}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 3,
                background: status.bg,
                color: status.color,
                fontWeight: 500,
              }}
            >
              {status.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {fmt(item.amount, currency)} · {t(`recurring.freq_${item.frequency}`)}
            {" · "}
            {item.category_name_key ? t(item.category_name_key) : item.category_name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {item.is_active
              ? `${t("recurring.nextDue")}: ${dayjs(item.next_due).format("MMM D, YYYY")}`
              : item.last_generated
                ? `${t("recurring.lastGenerated")}: ${dayjs(item.last_generated).format("MMM D, YYYY")}`
                : "—"}
            {item.funding_name && ` · ${item.funding_name_key ? t(item.funding_name_key) : item.funding_name}`}
          </div>

          {item.generated_count > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                marginTop: 6,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--brand)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <i className={`ti ${expanded ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden="true" />
              {t("recurring.generatedCount", { count: item.generated_count })}
            </button>
          )}
          {expanded && (
            <GeneratedList recurringId={item.id} fmt={fmt} currency={currency} t={t} />
          )}
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: 6,
          justifyContent: "flex-end",
          flexWrap: "wrap",
          marginTop: 10,
          paddingTop: 10,
          borderTop: "0.5px solid var(--border-color)",
        }}
      >
        {isDue && (
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: "5px 10px" }}
            onClick={() => generate.mutate()}
            disabled={busy}
          >
            <i className="ti ti-player-play" aria-hidden="true" /> {t("recurring.generate")}
          </button>
        )}
        {item.is_active && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "5px 10px" }}
            onClick={() => skip.mutate()}
            disabled={busy}
            title={t("recurring.skipHint")}
          >
            <i className="ti ti-player-skip-forward" aria-hidden="true" /> {t("recurring.skip")}
          </button>
        )}
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "5px 10px" }}
          onClick={() => toggleActive.mutate()}
          disabled={busy}
        >
          <i className={`ti ${item.is_active ? "ti-player-pause" : "ti-player-play"}`} aria-hidden="true" />{" "}
          {item.is_active ? t("recurring.pause") : t("recurring.resume")}
        </button>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "5px 10px" }}
          onClick={() => onEdit(item)}
          disabled={busy}
        >
          <i className="ti ti-pencil" aria-hidden="true" /> {t("common.edit")}
        </button>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "5px 10px", color: "var(--danger)" }}
          onClick={() => {
            if (window.confirm(t("recurring.confirmDelete"))) del.mutate();
          }}
          disabled={busy}
        >
          <i className="ti ti-trash" aria-hidden="true" /> {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function Recurring() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const queryClient = useQueryClient();
  const currency = business?.currency || "USD";
  const fmt = makeFmt(i18n.language);

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [toast, setToast] = useState(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.get("/recurring").then((r) => r.data),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });
  const { data: coaGroups } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });

  const categories = useMemo(() => coaToCategories(coaGroups, t), [coaGroups, t]);
  const ledgerAccounts = useMemo(
    () => deriveLedgerAccounts(coaGroups, accounts, t),
    [coaGroups, accounts, t],
  );

  const dueCount = items.filter(
    (i) => i.is_active && i.next_due <= today(),
  ).length;

  const generateDue = useMutation({
    mutationFn: () => api.post("/recurring/generate-due"),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      const n = res.data?.generated_count || 0;
      setToast(
        n > 0
          ? t("recurring.generatedToast", { count: n })
          : t("recurring.nothingDueToast"),
      );
      setTimeout(() => setToast(null), 3000);
    },
  });

  const handleClose = () => {
    setShowModal(false);
    setEditItem(null);
  };
  const handleEdit = (item) => {
    setEditItem(item);
    setShowModal(true);
  };

  return (
    <div className="fade-in" style={{ maxWidth: 760, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            {t("recurring.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("recurring.count", { count: items.length })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => generateDue.mutate()}
            disabled={dueCount === 0 || generateDue.isPending}
            title={t("recurring.generateDueHint")}
          >
            <i className="ti ti-refresh" aria-hidden="true" />{" "}
            {dueCount > 0
              ? t("recurring.generateDueCount", { count: dueCount })
              : t("recurring.nothingDue")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditItem(null);
              setShowModal(true);
            }}
          >
            <i className="ti ti-plus" aria-hidden="true" /> {t("recurring.new")}
          </button>
        </div>
      </div>

      {toast && (
        <div
          className="card"
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "var(--income)",
            background: "var(--income-bg)",
          }}
        >
          <i className="ti ti-check" style={{ marginRight: 6 }} aria-hidden="true" />
          {toast}
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          {t("common.loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 60, textAlign: "center" }}>
          <i className="ti ti-repeat" style={{ fontSize: 36, color: "var(--text-muted)" }} aria-hidden="true" />
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", margin: "12px 0 6px" }}>
            {t("recurring.noneTitle")}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            {t("recurring.noneHint")}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditItem(null);
              setShowModal(true);
            }}
          >
            {t("recurring.addFirst")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => (
            <RecurringCard
              key={item.id}
              item={item}
              fmt={fmt}
              currency={currency}
              onEdit={handleEdit}
              t={t}
            />
          ))}
        </div>
      )}

      {showModal && (
        <RecurringModal
          onClose={handleClose}
          accounts={accounts}
          ledgerAccounts={ledgerAccounts}
          categories={categories}
          editItem={editItem}
          t={t}
        />
      )}
    </div>
  );
}
