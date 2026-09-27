import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Badge, Button, EmptyState, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { toast } from "@abaco/ui/feedback";
import api from "../../lib/api.js";
import { describeError } from "../../lib/apiErrors.js";
import { ENTITLEMENTS_QUERY_KEY } from "../../lib/useEntitlements.js";
import * as haptics from "../../native/haptics.js";
import { linkReceipt, rankTransactions } from "../../lib/booking.js";

const AMOUNT_TONE = {
  income: "text-income",
  expense: "text-ink",
};

function TxRow({ tx, fmt, pending, disabled, onClick, t }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex w-full min-h-[56px] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-canvas disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-md font-medium text-ink">
              {tx.merchant || t("dashboard.noMerchant")}
            </span>
            {tx.receipt_id && (
              <Badge tone="neutral" icon="ti-paperclip">
                {t("mobile.review.link.linked")}
              </Badge>
            )}
          </span>
          <span className="block truncate text-[11px] text-muted">
            {dayjs(tx.date).format("D MMM YYYY")}
            {tx.account_name ? ` · ${tx.account_name}` : ""}
          </span>
        </span>
        <span
          className={cx(
            "shrink-0 text-md font-medium",
            AMOUNT_TONE[tx.type] || AMOUNT_TONE.expense,
          )}
        >
          {tx.type === "income" ? "+" : ""}
          {fmt(tx.total_amount)}
        </span>
        {pending ? (
          <i
            className="ti ti-loader-2 animate-spin shrink-0 text-muted"
            aria-hidden="true"
          />
        ) : (
          <i
            className="ti ti-chevron-right shrink-0 text-muted"
            aria-hidden="true"
          />
        )}
      </button>
    </li>
  );
}

/**
 * "Link to an existing transaction": lists GET /transactions?limit=100 ranked
 * by lib/booking.js (amount ±1 % and date ±7 d first), links on tap with
 * PUT /receipts/:id/link (idempotent 200; 409 RECEIPT_LINKED → message).
 *   open, onClose, receiptId, total, date, fmt, onLinked(tx)
 */
export default function LinkExistingSheet({
  open,
  onClose,
  receiptId,
  total,
  date,
  fmt,
  onLinked,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const txQuery = useQuery({
    queryKey: ["transactions", "recent"],
    // The list endpoint answers { transactions, total, limit, offset }.
    queryFn: async () => {
      const { data } = await api.get("/transactions", {
        params: { limit: 100, offset: 0 },
      });
      return Array.isArray(data) ? data : (data?.transactions ?? []);
    },
    enabled: open,
  });

  const { likely, rest } = useMemo(
    () =>
      rankTransactions(
        Array.isArray(txQuery.data) ? txQuery.data : [],
        total,
        date,
      ),
    [txQuery.data, total, date],
  );

  const link = useMutation({
    mutationFn: (tx) =>
      linkReceipt({ api, receiptId, transactionId: tx.id }).then(() => tx),
    onSuccess: (tx) => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
      haptics.success();
      toast.success(t("mobile.review.link.linked"));
      setError("");
      onLinked?.(tx);
    },
    onError: (err) => {
      haptics.error();
      setError(describeError(err, t).text);
    },
  });

  const close = () => {
    if (link.isPending) return;
    setError("");
    onClose();
  };

  const busy = link.isPending;
  const pendingId = busy ? link.variables?.id : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("mobile.review.link.title")}
      size="full"
    >
      <p className="mb-3 text-md text-muted">{t("mobile.review.link.hint")}</p>

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-danger bg-danger-bg px-3.5 py-2.5 text-md text-danger"
        >
          <i
            className="ti ti-alert-circle mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {txQuery.isPending ? (
        <div className="flex items-center gap-2 py-8 justify-center text-md text-muted">
          <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />
          {t("mobile.common.loading")}
        </div>
      ) : txQuery.isError ? (
        <EmptyState
          icon="ti-alert-circle"
          title={describeError(txQuery.error, t).text}
          action={
            <Button icon="ti-refresh" onClick={() => txQuery.refetch()}>
              {t("mobile.common.retry")}
            </Button>
          }
        />
      ) : likely.length + rest.length === 0 ? (
        <EmptyState
          icon="ti-receipt-off"
          title={t("mobile.review.link.noTransactions")}
        />
      ) : (
        <div className="-mx-2 flex flex-col gap-4">
          {likely.length > 0 && (
            <section>
              <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-brand">
                {t("mobile.review.link.suggestedMatches")}
              </h3>
              <ul className="flex flex-col">
                {likely.map((tx) => (
                  <TxRow
                    key={tx.id}
                    tx={tx}
                    fmt={fmt}
                    t={t}
                    pending={pendingId === tx.id}
                    disabled={busy}
                    onClick={() => link.mutate(tx)}
                  />
                ))}
              </ul>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                {t("mobile.review.link.allRecent")}
              </h3>
              <ul className="flex flex-col">
                {rest.map((tx) => (
                  <TxRow
                    key={tx.id}
                    tx={tx}
                    fmt={fmt}
                    t={t}
                    pending={pendingId === tx.id}
                    disabled={busy}
                    onClick={() => link.mutate(tx)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
