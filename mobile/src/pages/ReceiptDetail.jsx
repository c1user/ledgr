import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { confirmDialog, toast } from "@abaco/ui/feedback";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import useAuthStore from "../store/authStore.js";
import * as haptics from "../native/haptics.js";
import { openExternal } from "../native/browser.js";
import PullToRefresh from "../components/receipts/PullToRefresh.jsx";
import ZoomableImage from "../components/receipts/ZoomableImage.jsx";
import {
  RECEIPTS_QUERY_KEY,
  STATUS_LABEL_KEYS,
  confidencePct,
  formatMoney,
  formatReceiptDate,
  isPdf,
  lineItems,
  statusTone,
  toNumber,
} from "../components/receipts/receiptFormat.js";

const IMAGE_BOX = "h-[45dvh] min-h-[220px] w-full rounded-card";

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-md text-muted">{label}</dt>
      <dd
        className={
          strong
            ? "min-w-0 truncate text-right text-md font-semibold text-ink"
            : "min-w-0 truncate text-right text-md text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Receipt detail (ROADMAP-V6 2.8): fresh GET /api/receipts/:id on every
 * mount (the signed URL lives one hour), pinch-zoom image, extracted data,
 * status + linked transaction, "Review & book", "Ask about this merchant",
 * delete. Editing a linked receipt stays on the web.
 */
export default function ReceiptDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const currency = useAuthStore((s) => s.business?.currency) || "USD";
  const [failedSrc, setFailedSrc] = useState(null);

  // The list row the user tapped (also carries transaction_id/_merchant).
  const hint = location.state?.receipt;

  const receiptQuery = useQuery({
    queryKey: ["receipts", id],
    queryFn: async () => (await api.get(`/receipts/${id}`)).data,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const receipt = receiptQuery.data;
  const linked = receipt?.status === "linked";

  // Linked transaction summary: the detail row itself first (GET
  // /receipts/:id returns transaction_id/_merchant), then cached list rows,
  // then the row passed through navigation state, then a scan of the recent
  // transactions (which can miss an old-dated booking — last resort only).
  const linkQuery = useQuery({
    queryKey: ["receipt-transaction", id],
    enabled: linked,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const detail = queryClient.getQueryData(["receipts", id]);
      if (detail?.transaction_id) {
        return {
          id: detail.transaction_id,
          merchant: detail.transaction_merchant,
        };
      }
      const cached = queryClient
        .getQueriesData({ queryKey: RECEIPTS_QUERY_KEY })
        .flatMap(([, d]) => d?.pages ?? [])
        .flat()
        .find((r) => String(r?.id) === String(id));
      if (cached?.transaction_id) {
        return {
          id: cached.transaction_id,
          merchant: cached.transaction_merchant,
        };
      }
      if (hint?.transaction_id && String(hint.id) === String(id)) {
        return { id: hint.transaction_id, merchant: hint.transaction_merchant };
      }
      const res = await api.get("/transactions", {
        params: { limit: 100, offset: 0 },
      });
      // { transactions, total, limit, offset } — see routes/transactions.js
      const rows = Array.isArray(res.data)
        ? res.data
        : (res.data?.transactions ?? []);
      const tx = rows.find((x) => String(x.receipt_id) === String(id));
      return tx ? { id: tx.id, merchant: tx.merchant } : null;
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/receipts/${id}`),
    onSuccess: () => {
      haptics.success();
      toast.success(t("mobile.receipts.deleted"));
      queryClient.removeQueries({ queryKey: ["receipts", id] });
      queryClient.invalidateQueries({ queryKey: RECEIPTS_QUERY_KEY });
      navigate("/receipts", { replace: true });
    },
    onError: (err) => {
      haptics.error();
      toast.error(describeError(err, t).text);
    },
  });

  const goBack = () => {
    if (location.key === "default") navigate("/receipts", { replace: true });
    else navigate(-1);
  };

  const confirmDelete = async () => {
    const ok = await confirmDialog({
      message: t("mobile.review.deleteConfirm"),
      confirmLabel: t("mobile.common.delete"),
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const header = (
    <div className="-ml-2 mb-3 flex items-center gap-1">
      <button
        type="button"
        onClick={goBack}
        aria-label={t("mobile.common.back")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-sunken"
      >
        <i className="ti ti-chevron-left text-xl" aria-hidden="true" />
      </button>
      <h1 className="truncate text-lg font-semibold text-ink">
        {t("mobile.receipts.detail.title")}
      </h1>
    </div>
  );

  if (receiptQuery.isPending) {
    return (
      <div className="p-4">
        {header}
        <div className="animate-pulse space-y-4">
          <div className={cx(IMAGE_BOX, "bg-sunken")} />
          <div className="h-40 rounded-card bg-sunken" />
          <div className="h-14 rounded-card bg-sunken" />
        </div>
      </div>
    );
  }

  if (receiptQuery.isError || !receipt) {
    const info = describeError(receiptQuery.error, t);
    return (
      <div className="p-4">
        {header}
        <EmptyState
          icon={info.kind === "notFound" ? "ti-receipt-off" : "ti-alert-circle"}
          title={info.text}
          action={
            info.kind === "notFound" ? (
              <Button variant="secondary" size="lg" onClick={goBack}>
                {t("mobile.common.back")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                icon="ti-refresh"
                onClick={() => receiptQuery.refetch()}
              >
                {t("mobile.common.retry")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  const pdf = isPdf(receipt);
  const rawMerchant = receipt.ai_merchant?.trim() || "";
  const merchant = rawMerchant || t("receipts.unknownMerchant");
  const date = formatReceiptDate(receipt.ai_date) || t("receipts.noDate");
  const total = formatMoney(receipt.ai_total, currency, i18n.language);
  const pct = confidencePct(receipt.ai_confidence);
  const items = lineItems(receipt);
  const statusKey = STATUS_LABEL_KEYS[receipt.status];
  const imageFailed = !!receipt.signed_url && failedSrc === receipt.signed_url;

  // The Assistant builds the question from mobile.assistant.merchantPrompt
  // (single source for the wording); we only hand it the merchant name.
  const askAboutMerchant = () =>
    navigate("/assistant", { state: { merchant: rawMerchant } });

  let image;
  if (pdf) {
    image = (
      <Card
        padding="md"
        className="flex flex-col items-center gap-3 text-center"
      >
        <i
          className="ti ti-file-type-pdf text-4xl text-muted"
          aria-hidden="true"
        />
        {receipt.original_filename && (
          <div className="max-w-full truncate text-xs text-muted">
            {receipt.original_filename}
          </div>
        )}
        {receipt.signed_url && (
          <Button
            variant="secondary"
            size="lg"
            icon="ti-external-link"
            onClick={() => openExternal(receipt.signed_url)}
          >
            {t("mobile.common.viewReceipt")}
          </Button>
        )}
      </Card>
    );
  } else if (!receipt.signed_url) {
    image = (
      <div
        className={cx(
          IMAGE_BOX,
          "flex items-center justify-center bg-sunken text-md text-muted",
        )}
      >
        {t("mobile.receipts.detail.noImage")}
      </div>
    );
  } else if (imageFailed) {
    image = (
      <div
        className={cx(
          IMAGE_BOX,
          "flex flex-col items-center justify-center gap-3 bg-sunken px-6 text-center text-md text-muted",
        )}
      >
        <i className="ti ti-photo-off text-3xl" aria-hidden="true" />
        <span>{t("mobile.receipts.detail.imageExpired")}</span>
        <Button
          variant="secondary"
          size="lg"
          icon="ti-refresh"
          onClick={() => {
            setFailedSrc(null);
            receiptQuery.refetch();
          }}
        >
          {t("mobile.common.retry")}
        </Button>
      </div>
    );
  } else {
    image = (
      <ZoomableImage
        key={receipt.signed_url}
        src={receipt.signed_url}
        alt={merchant}
        hint={t("mobile.receipts.detail.zoomHint")}
        onError={() => setFailedSrc(receipt.signed_url)}
        className={IMAGE_BOX}
      />
    );
  }

  return (
    <PullToRefresh
      onRefresh={() => receiptQuery.refetch()}
      refreshing={receiptQuery.isRefetching}
      className="min-h-full"
    >
      <div className="flex min-h-full flex-col p-4">
        {header}

        {image}

        <Card padding="md" className="mt-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {t("mobile.receipts.detail.extracted")}
          </h2>
          <dl className="divide-y divide-line">
            <Row label={t("mobile.review.merchant")} value={merchant} />
            <Row label={t("mobile.review.date")} value={date} />
            <Row label={t("mobile.review.total")} value={total ?? "—"} strong />
            <Row
              label={t("mobile.review.confidence")}
              value={pct === null ? "—" : t("receipts.confidencePct", { pct })}
            />
          </dl>

          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
            {t("mobile.review.lineItems")}
          </h3>
          {items.length === 0 ? (
            <p className="py-2 text-md text-muted">
              {t("mobile.review.noneDetected")}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((it, i) => {
                const qty = toNumber(it.quantity);
                const unit = formatMoney(
                  it.unit_price,
                  currency,
                  i18n.language,
                );
                const lineTotal = formatMoney(
                  it.total,
                  currency,
                  i18n.language,
                );
                return (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-3 py-2 text-md"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">
                        {it.description || "—"}
                      </span>
                      {qty !== null && qty !== 1 && unit && (
                        <span className="text-xs text-muted">
                          {qty} × {unit}
                        </span>
                      )}
                    </span>
                    {lineTotal && (
                      <span className="shrink-0 text-ink">{lineTotal}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          padding="md"
          className="mt-4 flex items-center justify-between gap-3"
        >
          <span className="shrink-0 text-md text-muted">
            {t("mobile.receipts.detail.status")}
          </span>
          <div className="flex min-w-0 flex-col items-end gap-1">
            {statusKey && (
              <Badge tone={statusTone(receipt.status)}>{t(statusKey)}</Badge>
            )}
            {linked && (
              <span className="max-w-full truncate text-xs text-muted">
                {linkQuery.isPending
                  ? t("mobile.common.loading")
                  : t("mobile.receipts.linkedTo", {
                      merchant:
                        linkQuery.data?.merchant ||
                        t("receipts.unknownMerchant"),
                    })}
              </span>
            )}
          </div>
        </Card>

        <div className="mt-4 flex flex-col gap-2">
          {rawMerchant && (
            <Button
              variant="secondary"
              size="lg"
              full
              icon="ti-sparkles"
              onClick={askAboutMerchant}
            >
              {t("mobile.common.askAboutMerchant")}
            </Button>
          )}
          <Button
            variant="danger"
            size="lg"
            full
            icon="ti-trash"
            loading={remove.isPending}
            onClick={confirmDelete}
          >
            {t("mobile.common.delete")}
          </Button>
        </div>

        {!linked && (
          <div className="sticky bottom-0 -mx-4 mt-auto border-t border-line bg-canvas px-4 pt-3">
            <Button
              variant="primary"
              size="lg"
              full
              icon="ti-checkbox"
              className="mb-3"
              onClick={() => navigate(`/receipts/${id}/review`)}
            >
              {t("mobile.receipts.detail.reviewAndBook")}
            </Button>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
