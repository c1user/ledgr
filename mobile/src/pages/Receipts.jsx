import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button, EmptyState, PageHeader } from "@abaco/ui";
import { confirmDialog, toast } from "@abaco/ui/feedback";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import useAuthStore from "../store/authStore.js";
import { onResume } from "../native/appLifecycle.js";
import * as haptics from "../native/haptics.js";
import PullToRefresh from "../components/receipts/PullToRefresh.jsx";
import StatusChips from "../components/receipts/StatusChips.jsx";
import SwipeRow from "../components/receipts/SwipeRow.jsx";
import ReceiptCard from "../components/receipts/ReceiptCard.jsx";
import {
  FILTERS,
  FILTER_LABEL_KEYS,
  PAGE_SIZE,
  RECEIPTS_QUERY_KEY,
  parseStatusFilter,
} from "../components/receipts/receiptFormat.js";

const SKELETON_ROWS = [0, 1, 2];

/**
 * Receipts list (ROADMAP-V6 2.8): status chips (?status= preselects),
 * infinite pages of GET /api/receipts?include=url, pull-to-refresh + refresh
 * on resume, swipe actions (Book · Delete) and the "Finish linking"
 * self-repair on half-linked rows.
 */
export default function Receipts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseStatusFilter(searchParams.get("status"));
  const currency = useAuthStore((s) => s.business?.currency) || "USD";

  const {
    data,
    error,
    isPending,
    isError,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: [...RECEIPTS_QUERY_KEY, filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = { limit: PAGE_SIZE, offset: pageParam, include: "url" };
      if (filter !== "all") params.status = filter;
      const res = await api.get("/receipts", { params });
      return Array.isArray(res.data) ? res.data : [];
    },
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      lastPage.length < PAGE_SIZE ? undefined : lastOffset + lastPage.length,
  });

  const rows = useMemo(() => (data?.pages ?? []).flat(), [data]);

  // Signed URLs live one hour: refresh whenever the app comes back.
  useEffect(() => onResume(() => refetch()), [refetch]);

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: RECEIPTS_QUERY_KEY });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/receipts/${id}`),
    onSuccess: (_res, id) => {
      haptics.success();
      toast.success(t("mobile.receipts.deleted"));
      queryClient.setQueriesData({ queryKey: RECEIPTS_QUERY_KEY }, (old) =>
        old?.pages
          ? {
              ...old,
              pages: old.pages.map((p) => p.filter((r) => r.id !== id)),
            }
          : old,
      );
      invalidate();
    },
    onError: (err) => {
      haptics.error();
      toast.error(describeError(err, t).text);
    },
  });

  const finishLink = useMutation({
    mutationFn: (row) =>
      api.put(`/receipts/${row.id}/link`, {
        transactionId: row.transaction_id,
      }),
    onSuccess: () => {
      haptics.success();
      toast.success(t("mobile.review.link.linked"));
      invalidate();
    },
    onError: (err) => {
      const info = describeError(err, t);
      // 409: another transaction already holds it → the list is stale.
      if (info.kind === "conflict") invalidate();
      haptics.error();
      toast.error(info.text);
    },
  });

  const confirmDelete = async (row) => {
    const ok = await confirmDialog({
      message: t("mobile.review.deleteConfirm"),
      confirmLabel: t("mobile.common.delete"),
      danger: true,
    });
    if (ok) remove.mutate(row.id);
  };

  const setFilter = (next) => {
    haptics.tap();
    setSearchParams(next === "all" ? {} : { status: next }, { replace: true });
  };

  const openReceipt = (row) =>
    navigate(`/receipts/${row.id}`, { state: { receipt: row } });

  const actionsFor = (row) => {
    const actions = [];
    if (row.status !== "linked") {
      actions.push({
        key: "book",
        label: t("mobile.review.book.title"),
        icon: "ti-checkbox",
        tone: "brand",
        onClick: () => navigate(`/receipts/${row.id}/review`),
      });
    }
    actions.push({
      key: "delete",
      label: t("mobile.common.delete"),
      icon: "ti-trash",
      tone: "danger",
      onClick: () => confirmDelete(row),
    });
    return actions;
  };

  const chipOptions = FILTERS.map((f) => ({
    value: f,
    label: t(FILTER_LABEL_KEYS[f]),
  }));

  let body;
  if (isPending) {
    body = (
      <ul className="divide-y divide-line rounded-card border border-line bg-surface overflow-hidden">
        {SKELETON_ROWS.map((i) => (
          <li key={i} className="flex items-center gap-3 p-3 animate-pulse">
            <div className="h-14 w-14 shrink-0 rounded-lg bg-sunken" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 rounded bg-sunken" />
              <div className="h-3 w-1/3 rounded bg-sunken" />
              <div className="h-4 w-16 rounded bg-sunken" />
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (isError) {
    body = (
      <EmptyState
        icon="ti-alert-circle"
        title={describeError(error, t).text}
        action={
          <Button
            variant="secondary"
            size="lg"
            icon="ti-refresh"
            onClick={() => refetch()}
          >
            {t("mobile.common.retry")}
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    body =
      filter === "all" ? (
        <EmptyState
          icon="ti-receipt-off"
          title={t("mobile.receipts.empty")}
          message={t("mobile.receipts.emptyHint")}
          action={
            <Button
              variant="primary"
              size="lg"
              icon="ti-scan"
              onClick={() => navigate("/scan")}
            >
              {t("mobile.scan.scanReceipt")}
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon="ti-receipt-off"
          title={t("mobile.common.noResults")}
        />
      );
  } else {
    body = (
      <>
        <ul className="divide-y divide-line rounded-card border border-line bg-surface overflow-hidden">
          {rows.map((row) => (
            <li key={row.id}>
              <SwipeRow actions={actionsFor(row)}>
                <ReceiptCard
                  receipt={row}
                  currency={currency}
                  onOpen={() => openReceipt(row)}
                  onFinishLinking={() => finishLink.mutate(row)}
                  finishing={
                    finishLink.isPending && finishLink.variables?.id === row.id
                  }
                />
              </SwipeRow>
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
              {t("mobile.common.loading")}
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <PullToRefresh
      onRefresh={() => refetch()}
      refreshing={isRefetching && !isFetchingNextPage}
      className="min-h-full"
    >
      <div className="p-4 pb-2">
        <PageHeader title={t("mobile.receipts.title")} className="mb-3" />
      </div>
      <div className="sticky top-0 z-10 bg-canvas px-4 pb-3">
        <StatusChips
          options={chipOptions}
          value={filter}
          onChange={setFilter}
          label={t("common.filters")}
        />
      </div>
      <div className="px-4 pb-4">{body}</div>
    </PullToRefresh>
  );
}
