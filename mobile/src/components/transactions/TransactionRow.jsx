import { useTranslation } from "react-i18next";
import { Badge } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import {
  amountParts,
  categoryLabel,
  formatMoney,
  formatTxDate,
} from "./transactionFormat.js";

// Literal class maps (no interpolation) so Tailwind sees every token.
const TILE = {
  income: "bg-income-bg text-income",
  expense: "bg-expense-bg text-expense",
};
const TILE_ICON = {
  income: "ti-arrow-down-left",
  expense: "ti-arrow-up-right",
};
const AMOUNT = {
  income: "text-income",
  expense: "text-expense",
};

/**
 * One row of an account's transaction list (ROADMAP-V6 2.15): 36px tone
 * tile, merchant, date · category, marker badges (receipt, reconciled,
 * recurring, split), signed amount in the BUSINESS currency plus the
 * original foreign amount when the row was converted.
 *   tx: a GET /api/transactions row   currency: business currency
 *   lang: i18n language               onPress(): open the detail sheet
 */
export default function TransactionRow({
  tx,
  currency = "USD",
  lang,
  onPress,
}) {
  const { t } = useTranslation();
  const { sign, tone, value } = amountParts(tx);
  const merchant = tx.merchant || t("dashboard.noMerchant");
  const date = formatTxDate(tx.date) || "—";
  const amount = formatMoney(value, currency, lang) || "—";
  const original =
    tx.original_currency && tx.original_currency !== currency
      ? formatMoney(tx.original_amount, tx.original_currency, lang)
      : null;
  const hasBadges =
    !!tx.receipt_id ||
    !!tx.reconciliation_id ||
    !!tx.recurring_id ||
    !!tx.is_split;
  // The icon-only markers (receipt, recurring) are read through the label;
  // the reconciled / split badges already carry their own text.
  const ariaLabel = [
    `${merchant}, ${sign}${amount}, ${date}`,
    tx.receipt_id ? t("mobile.transactions.hasReceipt") : null,
    tx.recurring_id ? t("transactions.recurring") : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      className="flex w-full min-h-[56px] items-center gap-3 p-3 text-left active:bg-sunken"
    >
      <div
        className={cx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          TILE[tone],
        )}
      >
        <i className={cx("ti text-lg", TILE_ICON[tone])} aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-md font-medium text-ink">{merchant}</div>
        <div className="truncate text-xs text-muted">
          {date} · {categoryLabel(tx, t)}
        </div>
        {hasBadges && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tx.receipt_id && (
              <Badge tone="neutral" icon="ti-paperclip" aria-hidden="true" />
            )}
            {tx.reconciliation_id && (
              <Badge tone="neutral" icon="ti-lock">
                {t("transactions.reconciled")}
              </Badge>
            )}
            {tx.recurring_id && (
              <Badge tone="neutral" icon="ti-repeat" aria-hidden="true" />
            )}
            {tx.is_split && (
              <Badge tone="payroll">{t("transactions.split")}</Badge>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        <div className={cx("text-md font-semibold", AMOUNT[tone])}>
          {sign}
          {amount}
        </div>
        {original && <div className="text-xs text-muted">{original}</div>}
      </div>
    </button>
  );
}
