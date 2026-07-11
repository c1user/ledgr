import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { coaToCategories } from "../lib/coaCategories";
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
    <Modal
      open
      onClose={onClose}
      title={editItem ? t("recurring.editTitle") : t("recurring.newTitle")}
    >
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Type toggle */}
        <div className="flex gap-2 mb-4">
          {["expense", "income"].map((txType) => (
            <button
              key={txType}
              type="button"
              onClick={() => setForm({ ...form, type: txType, categoryId: "" })}
              className={cx(
                "flex-1 py-2 rounded-lg border text-md font-medium cursor-pointer transition-colors",
                form.type === txType
                  ? txType === "income"
                    ? "border-income bg-income-bg text-income"
                    : "border-expense bg-expense-bg text-expense"
                  : "border-line bg-transparent text-muted",
              )}
            >
              <i
                className={`ti ${txType === "income" ? "ti-arrow-down-left" : "ti-arrow-up-right"} mr-1.5`}
                aria-hidden="true"
              />
              {t(`common.${txType}`)}
            </button>
          ))}
        </div>

        {/* Amount + Frequency */}
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field label={t("common.amount")} htmlFor="amount" className="mb-0">
            <Input
              id="amount"
              type="number"
              placeholder="0.00"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </Field>
          <Field
            label={t("recurring.frequency")}
            htmlFor="frequency"
            className="mb-0"
          >
            <Select
              id="frequency"
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`recurring.freq_${f}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Start + End date */}
        <div className="grid grid-cols-2 gap-3 mb-3.5">
          <Field
            label={t("recurring.startDate")}
            htmlFor="startDate"
            className="mb-0"
          >
            <Input
              id="startDate"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </Field>
          <Field
            label={t("recurring.endDateOptional")}
            htmlFor="endDate"
            className="mb-0"
          >
            <Input
              id="endDate"
              type="date"
              min={form.startDate}
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
        </div>

        {/* Funding account */}
        <Field
          label={t("recurring.fundingAccount")}
          htmlFor="accountId"
          className="mb-3.5"
        >
          <Select
            id="accountId"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            required
          >
            <option value="">{t("recurring.selectAccount")}</option>
            {accounts?.length > 0 && (
              <optgroup label={t("transactions.bankAccounts")}>
                {accounts.map((a) => (
                  <option key={a.id} value={`acct:${a.id}`}>
                    {a.name}
                  </option>
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
          </Select>
        </Field>

        {/* Category */}
        <Field
          label={t("common.category")}
          htmlFor="categoryId"
          className="mb-3.5"
        >
          <Select
            id="categoryId"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            required
          >
            <option value="">{t("recurring.selectCategory")}</option>
            {categories
              ?.filter((c) => c.type === form.type)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>

        {/* Merchant */}
        <Field
          label={t("transactions.merchantDescription")}
          htmlFor="merchant"
          className="mb-3.5"
        >
          <Input
            id="merchant"
            type="text"
            placeholder={t("recurring.merchantPlaceholder")}
            value={form.merchant}
            onChange={(e) => setForm({ ...form, merchant: e.target.value })}
          />
        </Field>

        {/* Notes */}
        <Field label={t("common.notes")} htmlFor="notes" className="mb-5">
          <Input
            id="notes"
            type="text"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t("recurring.saving")
              : editItem
                ? t("common.save")
                : t("recurring.create")}
          </Button>
        </div>
      </form>
    </Modal>
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
    return <div className="py-2 text-xs text-muted">{t("common.loading")}</div>;
  if (txs.length === 0)
    return (
      <div className="py-2 text-xs text-muted">{t("recurring.noGenerated")}</div>
    );

  return (
    <div className="mt-2 border-t border-line">
      {txs.map((tx) => (
        <div
          key={tx.id}
          className="flex justify-between py-1.5 text-xs text-secondary border-b border-line"
        >
          <span>{dayjs(tx.date).format("MMM D, YYYY")}</span>
          <span className="font-medium">{fmt(tx.total_amount, currency)}</span>
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
    toggleActive.isPending ||
    skip.isPending ||
    generate.isPending ||
    del.isPending;

  // Status pill
  let status = { label: t("recurring.active"), tone: "income" };
  if (!item.is_active)
    status = { label: t("recurring.paused"), tone: "neutral" };
  else if (isDue) status = { label: t("recurring.due"), tone: "expense" };

  return (
    <Card padding="none" className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div
          className={cx(
            "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
            item.type === "income" ? "bg-income-bg" : "bg-expense-bg",
          )}
        >
          <i
            className={cx(
              "ti ti-repeat text-base",
              item.type === "income" ? "text-income" : "text-expense",
            )}
            aria-hidden="true"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink">
              {item.merchant || t("recurring.untitled")}
            </span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <div className="text-xs text-muted mt-0.5">
            {fmt(item.amount, currency)} · {t(`recurring.freq_${item.frequency}`)}
            {" · "}
            {item.category_name_key
              ? t(item.category_name_key)
              : item.category_name}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {item.is_active
              ? `${t("recurring.nextDue")}: ${dayjs(item.next_due).format("MMM D, YYYY")}`
              : item.last_generated
                ? `${t("recurring.lastGenerated")}: ${dayjs(item.last_generated).format("MMM D, YYYY")}`
                : "—"}
            {item.funding_name &&
              ` · ${item.funding_name_key ? t(item.funding_name_key) : item.funding_name}`}
          </div>

          {item.generated_count > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-1.5 p-0 text-xs text-brand cursor-pointer"
            >
              <i
                className={`ti ${expanded ? "ti-chevron-up" : "ti-chevron-down"}`}
                aria-hidden="true"
              />
              {t("recurring.generatedCount", { count: item.generated_count })}
            </button>
          )}
          {expanded && (
            <GeneratedList
              recurringId={item.id}
              fmt={fmt}
              currency={currency}
              t={t}
            />
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 justify-end flex-wrap mt-2.5 pt-2.5 border-t border-line">
        {isDue && (
          <Button
            variant="primary"
            size="sm"
            icon="ti-player-play"
            onClick={() => generate.mutate()}
            disabled={busy}
          >
            {t("recurring.generate")}
          </Button>
        )}
        {item.is_active && (
          <Button
            size="sm"
            icon="ti-player-skip-forward"
            onClick={() => skip.mutate()}
            disabled={busy}
            title={t("recurring.skipHint")}
          >
            {t("recurring.skip")}
          </Button>
        )}
        <Button
          size="sm"
          icon={item.is_active ? "ti-player-pause" : "ti-player-play"}
          onClick={() => toggleActive.mutate()}
          disabled={busy}
        >
          {item.is_active ? t("recurring.pause") : t("recurring.resume")}
        </Button>
        <Button
          size="sm"
          icon="ti-pencil"
          onClick={() => onEdit(item)}
          disabled={busy}
        >
          {t("common.edit")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon="ti-trash"
          onClick={async () => {
            if (
              await confirmDialog({
                message: t("recurring.confirmDelete"),
                danger: true,
              })
            )
              del.mutate();
          }}
          disabled={busy}
        >
          {t("common.delete")}
        </Button>
      </div>
    </Card>
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
    <div className="fade-in max-w-[760px] mx-auto">
      <PageHeader
        title={t("recurring.title")}
        subtitle={t("recurring.count", { count: items.length })}
        actions={
          <>
            <Button
              icon="ti-refresh"
              onClick={() => generateDue.mutate()}
              disabled={dueCount === 0 || generateDue.isPending}
              title={t("recurring.generateDueHint")}
            >
              {dueCount > 0
                ? t("recurring.generateDueCount", { count: dueCount })
                : t("recurring.nothingDue")}
            </Button>
            <Button
              variant="primary"
              icon="ti-plus"
              onClick={() => {
                setEditItem(null);
                setShowModal(true);
              }}
            >
              {t("recurring.new")}
            </Button>
          </>
        }
      />

      {toast && (
        <div className="bg-income-bg text-income rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-check mr-1.5" aria-hidden="true" />
          {toast}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-muted text-sm">
          {t("common.loading")}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="ti-repeat"
            title={t("recurring.noneTitle")}
            message={t("recurring.noneHint")}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditItem(null);
                  setShowModal(true);
                }}
              >
                {t("recurring.addFirst")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
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
