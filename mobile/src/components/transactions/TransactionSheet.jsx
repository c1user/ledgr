import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Button, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import {
  accountLabel,
  amountParts,
  formatMoney,
  formatTxDate,
} from "./transactionFormat.js";

const AMOUNT = {
  income: "text-income",
  expense: "text-expense",
};
const TYPE_KEYS = {
  income: "common.income",
  expense: "common.expense",
};

function Row({ label, children, wrap = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-md text-muted">{label}</dt>
      <dd
        className={cx(
          "min-w-0 text-right text-md text-ink",
          wrap ? "whitespace-pre-wrap break-words" : "truncate",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Read-only detail sheet for one transaction (ROADMAP-V6 2.15), fed from the
 * list row (no detail fetch): signed amount + type badge, date, funding
 * account, one category line per split, notes, who added it, the original
 * foreign amount, marker badges, "View receipt" when one is attached.
 *   tx: the row | null (null → closed)   currency: business currency
 *   lang: i18n language                  onClose()
 */
export default function TransactionSheet({
  tx,
  currency = "USD",
  lang,
  onClose,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!tx) return null;

  const { sign, tone, value } = amountParts(tx);
  const merchant = tx.merchant || t("dashboard.noMerchant");
  const amount = formatMoney(value, currency, lang) || "—";
  const splits = Array.isArray(tx.splits)
    ? tx.splits.filter((s) => s && typeof s === "object")
    : [];
  const notes = typeof tx.notes === "string" ? tx.notes.trim() : "";
  const original = tx.original_currency
    ? formatMoney(tx.original_amount, tx.original_currency, lang)
    : null;
  const hasMarkers =
    !!tx.reconciliation_id || !!tx.recurring_id || !!tx.is_split;

  return (
    <Modal
      open
      onClose={onClose}
      title={merchant}
      size="md"
      footer={
        <div className="flex w-full flex-col gap-2">
          {tx.receipt_id && (
            <Button
              variant="secondary"
              size="lg"
              full
              icon="ti-receipt"
              onClick={() => {
                onClose?.();
                navigate(`/receipts/${tx.receipt_id}`);
              }}
            >
              {t("mobile.common.viewReceipt")}
            </Button>
          )}
          <Button variant="primary" size="lg" full onClick={onClose}>
            {t("mobile.common.done")}
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className={cx("text-2xl font-semibold", AMOUNT[tone])}>
          {sign}
          {amount}
        </span>
        <Badge tone={tone}>{t(TYPE_KEYS[tone])}</Badge>
      </div>

      <dl className="divide-y divide-line">
        <Row label={t("common.date")}>{formatTxDate(tx.date) || "—"}</Row>
        <Row label={t("common.account")}>{accountLabel(tx, t)}</Row>
        {splits.length === 0 ? (
          <Row label={t("common.category")}>—</Row>
        ) : (
          splits.map((split, i) => (
            <Row
              key={split.id ?? i}
              label={i === 0 ? t("common.category") : ""}
            >
              <span className="inline-flex max-w-full items-center gap-1.5">
                {split.color && (
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: split.color }}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">
                  {split.name_key ? t(split.name_key) : split.name || "—"}
                </span>
                {splits.length > 1 && (
                  <span className="shrink-0 text-muted">
                    {formatMoney(split.amount, currency, lang)}
                  </span>
                )}
              </span>
            </Row>
          ))
        )}
        <Row label={t("common.notes")} wrap>
          {notes || (
            <span className="text-muted">
              {t("mobile.transactions.noNotes")}
            </span>
          )}
        </Row>
        {tx.created_by_name && (
          <Row label={t("mobile.transactions.createdBy")}>
            {tx.created_by_name}
          </Row>
        )}
        {original && (
          <Row label={t("mobile.transactions.original")}>{original}</Row>
        )}
      </dl>

      {hasMarkers && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tx.reconciliation_id && (
            <Badge tone="neutral" icon="ti-lock">
              {t("transactions.reconciled")}
            </Badge>
          )}
          {tx.recurring_id && (
            <Badge tone="neutral" icon="ti-repeat">
              {t("transactions.recurring")}
            </Badge>
          )}
          {tx.is_split && (
            <Badge tone="payroll">{t("transactions.split")}</Badge>
          )}
        </div>
      )}
    </Modal>
  );
}
