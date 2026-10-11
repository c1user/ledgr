import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState } from "@abaco/ui";
import { describeError } from "../../lib/apiErrors.js";
import TransactionRow from "./TransactionRow.jsx";

const ERR_OPTS = { rateLimitedKey: "mobile.common.rateLimited" };
const SKELETON_ROWS = [0, 1, 2];

/**
 * The paged transaction list of one account (ROADMAP-V6 2.15): skeleton →
 * error + Retry → empty (filtered or not) → rows + an infinite-scroll
 * sentinel that loads the next page as it nears the viewport.
 *   rows, total, isPending, isError, error, hasNextPage, isFetchingNextPage,
 *   fetchNextPage      from useAccountTransactions()
 *   onRetry()          refetch after an error
 *   onOpen(tx)         open the detail sheet
 *   currency, lang     business currency + i18n language for the amounts
 *   filtered           true when any URL filter is active (empty-state copy)
 */
export default function TransactionList({
  rows = [],
  total = 0,
  isPending = false,
  isError = false,
  error = null,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  onRetry,
  onOpen,
  currency = "USD",
  lang,
  filtered = false,
}) {
  const { t } = useTranslation();

  // The filtered COUNT is authoritative: once every row is on screen there
  // is nothing left to ask for, whatever the paging state says.
  const canLoadMore = !!hasNextPage && rows.length < total;

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
          fetchNextPage?.();
        }
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, isFetchingNextPage, fetchNextPage]);

  if (isPending) {
    return (
      <ul className="divide-y divide-line rounded-card border border-line bg-surface overflow-hidden">
        {SKELETON_ROWS.map((i) => (
          <li key={i} className="flex items-center gap-3 p-3 animate-pulse">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-sunken" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 rounded bg-sunken" />
              <div className="h-3 w-1/3 rounded bg-sunken" />
            </div>
            <div className="h-4 w-16 rounded bg-sunken" />
          </li>
        ))}
      </ul>
    );
  }

  // Only when there is nothing cached to show: a failed refetch over loaded
  // pages (offline resume, pull-to-refresh) keeps the rows on screen and the
  // Shell's OfflineBanner says why (spec §7).
  if (isError && rows.length === 0) {
    const info = describeError(error, t, ERR_OPTS);
    const offline = info.kind === "network";
    return (
      <EmptyState
        icon="ti-alert-circle"
        title={offline ? t("mobile.common.offline") : info.text}
        message={offline ? t("mobile.common.offlineHint") : undefined}
        action={
          <Button
            variant="secondary"
            size="lg"
            icon="ti-refresh"
            onClick={onRetry}
          >
            {t("mobile.common.retry")}
          </Button>
        }
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="ti-receipt-off"
        title={
          filtered
            ? t("mobile.transactions.noneInRange")
            : t("mobile.transactions.emptyAccount")
        }
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface overflow-hidden">
        {rows.map((tx) => (
          <li key={tx.id}>
            <TransactionRow
              tx={tx}
              currency={currency}
              lang={lang}
              onPress={() => onOpen?.(tx)}
            />
          </li>
        ))}
      </ul>
      <div
        ref={sentinelRef}
        className="flex h-12 items-center justify-center text-xs text-muted"
        aria-live="polite"
      >
        {isFetchingNextPage && (
          <>
            <i
              className="ti ti-loader-2 animate-spin mr-1.5"
              aria-hidden="true"
            />
            {t("mobile.transactions.loadingMore")}
          </>
        )}
      </div>
    </>
  );
}
