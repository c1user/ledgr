// Pure presentation helpers for the transaction rows and sheet (ROADMAP-V6
// 2.15). GET /api/transactions rows carry NUMERIC columns as strings, DATE
// columns as ISO timestamps, the ledger-derived `splits[]` (revenue/expense
// lines with name_key|name|color|amount) and the funding account as
// account_name (+ account_name_key for ledger accounts). Everything is
// normalised here so the components only render.
import { formatReceiptDate, toNumber } from "../receipts/receiptFormat.js";

export { formatMoney, toNumber } from "../receipts/receiptFormat.js";

const tr = (t, key) => (typeof t === "function" ? t(key) : key);

/** ISO timestamp | "YYYY-MM-DD" | null → "MMM D, YYYY" | null. */
export const formatTxDate = (v) => formatReceiptDate(v);

/**
 * Category line: the first split's name (name_key → t(name_key), i18n COA
 * names) plus " +N" more lines when the transaction is split; "—" when the
 * row has no revenue/expense line at all.
 */
export function categoryLabel(tx, t) {
  const splits = Array.isArray(tx?.splits) ? tx.splits : [];
  const first = splits.find((s) => s && typeof s === "object");
  if (!first) return "—";
  const name = first.name_key ? tr(t, first.name_key) : first.name;
  const extra =
    tx.is_split && splits.length > 1 ? ` +${splits.length - 1}` : "";
  return `${name || "—"}${extra}`;
}

/** Funding account label (ledger accounts carry an i18n name_key). */
export function accountLabel(tx, t) {
  if (tx?.account_name_key) return tr(t, tx.account_name_key);
  return tx?.account_name || "—";
}

/**
 * Sign, tone and numeric value for an amount: income "+" / expense "−"
 * (U+2212), toned text-income / text-expense. `value` is null when the row
 * carries no usable amount.
 */
export function amountParts(tx) {
  const income = tx?.type === "income";
  return {
    sign: income ? "+" : "−",
    tone: income ? "income" : "expense",
    value: toNumber(tx?.total_amount),
  };
}
