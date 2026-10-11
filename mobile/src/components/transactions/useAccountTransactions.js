// Infinite pages of GET /api/transactions?accountId=…&limit=50&offset=… for
// one account (ROADMAP-V6 2.15). The key lives under the ["transactions"]
// prefix, so booking a receipt (ReceiptReview.invalidateAfterBooking) and a
// CSV import refresh it without knowing about this screen.
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import api from "../../lib/api.js";
import {
  mergePages,
  nextOffset,
  txListParams,
  txQueryKey,
  unwrapTxPage,
} from "../../lib/transactionsPaging.js";

/**
 * useAccountTransactions(accountId, filters) → {
 *   rows,            // merged + id-deduped rows of every loaded page
 *   total,           // filtered COUNT from the first page (0 while pending)
 *   isPending, isError, error, isRefetching, isFetchingNextPage,
 *   hasNextPage, fetchNextPage, refetch,
 * }
 * `filters` is the parseTxFilters() result ({ type, from, to }).
 */
export function useAccountTransactions(accountId, filters) {
  const query = useInfiniteQuery({
    queryKey: txQueryKey(accountId, filters),
    initialPageParam: 0,
    enabled: !!accountId,
    queryFn: async ({ pageParam }) =>
      unwrapTxPage(
        (
          await api.get("/transactions", {
            params: txListParams(accountId, filters, pageParam),
          })
        ).data,
      ),
    getNextPageParam: nextOffset,
  });

  const pages = query.data?.pages;
  const rows = useMemo(() => mergePages(pages ?? []), [pages]);
  const total = pages?.[0]?.total ?? 0;

  return {
    rows,
    total,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export default useAccountTransactions;
