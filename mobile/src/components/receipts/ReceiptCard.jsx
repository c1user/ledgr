import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import {
  STATUS_LABEL_KEYS,
  confidencePct,
  formatMoney,
  formatReceiptDate,
  isHalfLinked,
  isPdf,
  statusTone,
} from "./receiptFormat.js";

const PLACEHOLDER_ICON = {
  pdf: "ti-file-type-pdf",
  image: "ti-receipt",
};

/**
 * One row of the Receipts list: 56px thumbnail (signed_url, placeholder icon
 * when it fails or the file is a PDF), merchant, date · total, status badge,
 * AI confidence. Half-linked rows (transaction_id set, status ≠ linked) get
 * a "Finish linking" strip that repairs the link.
 */
export default function ReceiptCard({
  receipt,
  currency = "USD",
  onOpen,
  onFinishLinking,
  finishing = false,
}) {
  const { t, i18n } = useTranslation();
  const [failedSrc, setFailedSrc] = useState(null);

  const pdf = isPdf(receipt);
  const merchant = receipt.ai_merchant?.trim() || t("receipts.unknownMerchant");
  const date = formatReceiptDate(receipt.ai_date) || t("receipts.noDate");
  const total = formatMoney(receipt.ai_total, currency, i18n.language);
  const pct = confidencePct(receipt.ai_confidence);
  const showImage =
    !pdf && !!receipt.signed_url && failedSrc !== receipt.signed_url;
  const half = isHalfLinked(receipt);
  const statusKey = STATUS_LABEL_KEYS[receipt.status];

  return (
    <div className="bg-surface">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-h-[44px] items-center gap-3 p-3 text-left active:bg-sunken"
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sunken">
          {showImage ? (
            <img
              src={receipt.signed_url}
              alt={merchant}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              onError={() => setFailedSrc(receipt.signed_url)}
            />
          ) : (
            <i
              className={cx(
                "ti text-2xl text-muted",
                pdf ? PLACEHOLDER_ICON.pdf : PLACEHOLDER_ICON.image,
              )}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-md font-medium text-ink">
              {merchant}
            </span>
            {total && (
              <span className="shrink-0 text-md font-semibold text-ink">
                {total}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted">{date}</div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            {statusKey && (
              <Badge tone={statusTone(receipt.status)}>{t(statusKey)}</Badge>
            )}
            {pct !== null && (
              <span className="shrink-0 text-[11px] text-muted">
                {t("receipts.confidencePct", { pct })}
              </span>
            )}
            {receipt.status === "linked" && receipt.transaction_merchant && (
              <span className="truncate text-[11px] text-muted">
                {t("mobile.receipts.linkedTo", {
                  merchant: receipt.transaction_merchant,
                })}
              </span>
            )}
          </div>
        </div>

        <i
          className="ti ti-chevron-right shrink-0 text-muted"
          aria-hidden="true"
        />
      </button>

      {half && (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-brand-light px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink">
            <i
              className="ti ti-alert-triangle shrink-0 text-brand"
              aria-hidden="true"
            />
            <span className="truncate">{t("mobile.receipts.halfLinked")}</span>
          </span>
          <Button
            variant="primary"
            size="sm"
            icon="ti-link"
            loading={finishing}
            onClick={onFinishLinking}
            className="min-h-[44px] shrink-0"
          >
            {t("mobile.common.finishLinking")}
          </Button>
        </div>
      )}
    </div>
  );
}
