import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import cx from "../lib/cx";
import useAuthStore from "../store/authStore";
import { Badge, Button } from "./ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// Right-hand drawer for one category (a revenue/expense COA account): its
// all-time totals, the most recent postings, and a jump to the ledger
// filtered to it. Same shape as the vendor drawer in Vendors.jsx.
// `category` is the {id, name, type, color, parent_name} shape produced by
// lib/coaCategories.js.
export default function CategoryDrawer({ category, onClose, onEdit }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currency = useAuthStore((s) => s.business?.currency) || "USD";
  const fmt = makeFmt(i18n.language);

  const { data, isLoading } = useQuery({
    queryKey: ["category-transactions", category.id],
    queryFn: () =>
      api
        .get(`/chart-of-accounts/${category.id}/transactions`)
        .then((r) => r.data),
  });
  const txs = data?.transactions || [];
  const summary = data?.summary;
  const isIncome = category.type === "income";
  const tone = isIncome ? "income" : "expense";

  const accountName = (tx) =>
    tx.account_name_key ? t(tx.account_name_key) : tx.account_name;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-[150]" />
      {/* Panel */}
      <div
        className="fade-in fixed top-0 right-0 bottom-0 w-[400px] max-w-full bg-surface border-l border-line z-[151] flex flex-col overflow-hidden"
        role="dialog"
        aria-label={category.name}
      >
        {/* Header */}
        <div className="flex justify-between items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: category.color }}
            />
            <div className="min-w-0">
              <div className="text-base font-bold text-ink truncate">
                {category.name}
              </div>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <Badge tone={tone}>
                  {t(isIncome ? "common.income" : "common.expense")}
                </Badge>
                {category.parent_name && (
                  <span className="text-[11px] text-muted">
                    {t("categories.under", { parent: category.parent_name })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            icon="ti-x"
            onClick={onClose}
            aria-label={t("common.close")}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {/* All-time totals */}
          <div className="grid grid-cols-2 gap-2.5 mb-2">
            <div className="bg-canvas rounded-lg px-3.5 py-2.5">
              <div className="text-[11px] text-muted mb-0.5">
                {t("categories.totalAmount")}
              </div>
              <div
                className={cx(
                  "text-base font-bold",
                  isIncome ? "text-income" : "text-expense",
                )}
              >
                {isLoading ? "…" : fmt(summary?.total, currency)}
              </div>
            </div>
            <div className="bg-canvas rounded-lg px-3.5 py-2.5">
              <div className="text-[11px] text-muted mb-0.5">
                {t("categories.txCount")}
              </div>
              <div className="text-base font-bold text-ink">
                {isLoading ? "…" : (summary?.count ?? 0)}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-muted mb-5 min-h-[16px]">
            {summary?.includes_subcategories &&
              t("categories.includesSubcategories")}
          </div>

          {onEdit && (
            <Button icon="ti-pencil" onClick={onEdit} full className="mb-5">
              {t("common.edit")}
            </Button>
          )}

          {/* Recent transactions */}
          <div className="text-[11px] font-semibold text-muted tracking-[0.5px] mb-2.5 uppercase">
            {t("categories.recentTransactions")}
          </div>

          {isLoading ? (
            <div className="text-md text-muted">{t("common.loading")}</div>
          ) : txs.length === 0 ? (
            <div className="text-md text-muted">
              {t("categories.noTransactions")}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {txs.map((tx) => (
                <div
                  key={tx.id}
                  className="flex justify-between items-start px-2.5 py-2 bg-canvas rounded-md"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-ink truncate">
                      {tx.merchant || "—"}
                      {tx.is_split && (
                        <span className="text-[10px] bg-payroll-bg text-payroll px-1.5 rounded-sm ml-1.5 font-normal">
                          {t("transactions.split")}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-px truncate">
                      {dayjs(tx.date).format("MMM D, YYYY")}
                      {accountName(tx) && ` · ${accountName(tx)}`}
                    </div>
                  </div>
                  <div
                    className={cx(
                      "text-xs font-semibold ml-2 shrink-0",
                      tx.type === "income" ? "text-income" : "text-expense",
                    )}
                  >
                    {tx.type === "income" ? "+" : "-"}
                    {fmt(tx.category_amount, currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Jump to the ledger filtered to this category */}
        <div className="px-5 py-3 border-t border-line shrink-0">
          <Button
            icon="ti-arrows-up-down"
            full
            onClick={() => navigate(`/transactions?categoryId=${category.id}`)}
          >
            {t("categories.viewAllTransactions")}
          </Button>
        </div>
      </div>
    </>
  );
}
