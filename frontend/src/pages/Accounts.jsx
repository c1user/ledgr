import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { confirmDialog } from "../store/feedbackStore";
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

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const emptyForm = {
  name: "",
  type: "current",
  currency: "USD",
  currentBalance: "",
};

const accountTypeIcons = {
  current: "ti-building-bank",
  savings: "ti-piggy-bank",
  credit: "ti-credit-card",
  cash: "ti-cash",
  loan: "ti-receipt",
};

// ── Account Modal ─────────────────────────────────────────────
function AccountModal({ onClose, editAccount, t }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    editAccount
      ? {
          name: editAccount.name,
          type: editAccount.type,
          currency: editAccount.currency,
          currentBalance: editAccount.current_balance,
        }
      : emptyForm,
  );
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data) =>
      editAccount
        ? api.put(`/accounts/${editAccount.id}`, data)
        : api.post("/accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("accounts.saveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.name) return setError(t("accounts.errNameRequired"));
    mutation.mutate({
      name: form.name,
      type: form.type,
      currency: form.currency,
      currentBalance: parseFloat(form.currentBalance || 0),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={editAccount ? t("accounts.editTitle") : t("accounts.newTitle")}
    >
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Field
          label={t("accounts.accountName")}
          htmlFor="name"
          className="mb-3.5"
        >
          <Input
            id="name"
            type="text"
            placeholder={t("accounts.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            autoFocus
          />
        </Field>

        <Field
          label={t("accounts.accountType")}
          htmlFor="type"
          className="mb-3.5"
        >
          <Select
            id="type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="current">{t("accounts.typeCurrent")}</option>
            <option value="savings">{t("accounts.typeSavings")}</option>
            <option value="credit">{t("accounts.typeCredit")}</option>
            <option value="cash">{t("accounts.typeCash")}</option>
            <option value="loan">{t("accounts.typeLoan")}</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <Field
            label={t("accounts.openingBalance")}
            hint={editAccount ? t("accounts.currentParenthetical") : undefined}
            htmlFor="currentBalance"
            className="mb-0"
          >
            <Input
              id="currentBalance"
              type="number"
              placeholder="0.00"
              step="0.01"
              value={form.currentBalance}
              onChange={(e) =>
                setForm({ ...form, currentBalance: e.target.value })
              }
            />
          </Field>
          <Field
            label={t("accounts.currency")}
            htmlFor="currency"
            className="mb-0"
          >
            <Select
              id="currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </Select>
          </Field>
        </div>

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t("accounts.saving")
              : editAccount
                ? t("accounts.saveChanges")
                : t("accounts.createAccount")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Accounts Page ────────────────────────────────────────
export default function Accounts() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const queryClient = useQueryClient();
  const currency = business?.currency || "USD";
  const fmt = makeFmt(i18n.language);
  const [showModal, setShowModal] = useState(false);
  const [editAccount, setEditAccount] = useState(null);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const { data: balances } = useQuery({
    queryKey: ["balances"],
    queryFn: () => api.get("/accounts/summary/balances").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });

  const handleClose = () => {
    setShowModal(false);
    setEditAccount(null);
  };

  return (
    <div className="fade-in">
      <PageHeader
        title={t("accounts.title")}
        subtitle={t("accounts.count", { count: accounts?.length || 0 })}
        actions={
          <Button
            variant="primary"
            icon="ti-plus"
            onClick={() => setShowModal(true)}
          >
            {t("accounts.addAccount")}
          </Button>
        }
      />

      {/* Total balance summary */}
      {balances && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 mb-6">
          {[
            {
              label: t("accounts.totalBalance"),
              value: balances.total_balance,
              cls: "text-income",
            },
            {
              label: t("accounts.bank"),
              value: balances.bank_balance,
              cls: "text-payroll",
            },
            {
              label: t("accounts.credit"),
              value: balances.credit_balance,
              cls: "text-expense",
            },
            {
              label: t("accounts.cash"),
              value: balances.cash_balance,
              cls: "text-profit",
            },
          ].map((s) => (
            <Card key={s.label} padding="none" className="px-4 py-3.5">
              <div className="text-[11px] text-muted tracking-[1px] uppercase mb-1.5">
                {s.label}
              </div>
              <div className={cx("text-xl font-semibold", s.cls)}>
                {fmt(s.value, currency)}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Accounts list */}
      {isLoading ? (
        <div className="p-8 text-center text-muted">{t("common.loading")}</div>
      ) : accounts?.length === 0 ? (
        <Card>
          <EmptyState
            icon="ti-building-bank"
            message={t("accounts.noneYet")}
            action={
              <Button variant="primary" onClick={() => setShowModal(true)}>
                {t("accounts.addFirst")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {accounts.map((acc) => (
            <Card
              key={acc.id}
              padding="none"
              className={cx("px-5 py-[18px]", !acc.is_active && "opacity-50")}
            >
              <div className="flex justify-between items-start mb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-payroll-bg">
                    <i
                      className={`ti ${accountTypeIcons[acc.type] || "ti-building-bank"} text-lg text-payroll`}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {acc.name}
                    </div>
                    <div className="text-[11px] text-muted mt-px">
                      {t(`accountTypes.${acc.type}`, acc.type)} · {acc.currency}
                      {!acc.is_active && (
                        <span className="ml-1.5 text-danger text-[10px]">
                          {t("accounts.inactive")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditAccount(acc);
                      setShowModal(true);
                    }}
                    className="p-1 rounded text-muted hover:text-ink cursor-pointer"
                    title={t("common.edit")}
                  >
                    <i className="ti ti-pencil text-[15px]" aria-hidden="true" />
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          message: t("accounts.confirmDeactivate"),
                          confirmLabel: t("accounts.deactivate"),
                          danger: true,
                        })
                      )
                        deleteMutation.mutate(acc.id);
                    }}
                    className="p-1 rounded text-danger cursor-pointer"
                    title={t("accounts.deactivate")}
                  >
                    <i className="ti ti-trash text-[15px]" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Balance */}
              <div className="flex justify-between items-end">
                <div>
                  <div className="text-[11px] text-muted mb-1">
                    {t("accounts.currentBalance")}
                  </div>
                  <div
                    className={cx(
                      "text-[22px] font-semibold",
                      parseFloat(acc.current_balance) >= 0
                        ? "text-income"
                        : "text-expense",
                    )}
                  >
                    {fmt(acc.current_balance, acc.currency)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-muted mb-1">
                    {t("accounts.transactions")}
                  </div>
                  <div className="text-base font-medium text-secondary">
                    {acc.transaction_count || 0}
                  </div>
                </div>
              </div>

              {/* Income / Expense bar */}
              {(parseFloat(acc.total_income) > 0 ||
                parseFloat(acc.total_expenses) > 0) && (
                <div className="mt-3.5 pt-3.5 border-t border-line grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-muted mb-0.5">
                      {t("accounts.totalIn")}
                    </div>
                    <div className="text-xs font-medium text-income">
                      +{fmt(acc.total_income, acc.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted mb-0.5">
                      {t("accounts.totalOut")}
                    </div>
                    <div className="text-xs font-medium text-expense">
                      -{fmt(acc.total_expenses, acc.currency)}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <AccountModal onClose={handleClose} editAccount={editAccount} t={t} />
      )}
    </div>
  );
}
