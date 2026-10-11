import { useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, EmptyState, FilterButton } from "@abaco/ui";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import { useOnline } from "../lib/useOnline.js";
import {
  parseTxFilters,
  serializeTxFilters,
} from "../lib/transactionsPaging.js";
import useAuthStore from "../store/authStore.js";
import { onResume } from "../native/appLifecycle.js";
import * as haptics from "../native/haptics.js";
import PullToRefresh from "../components/receipts/PullToRefresh.jsx";
import StatusChips from "../components/receipts/StatusChips.jsx";
import AccountHero from "../components/accounts/AccountHero.jsx";
import ExportSheet from "../components/transactions/ExportSheet.jsx";
import TransactionList from "../components/transactions/TransactionList.jsx";
import TransactionSheet from "../components/transactions/TransactionSheet.jsx";
import TransactionFilterSheet from "../components/transactions/TransactionFilterSheet.jsx";
import { useAccountTransactions } from "../components/transactions/useAccountTransactions.js";

const ERR_OPTS = { rateLimitedKey: "mobile.common.rateLimited" };
const EMPTY_RANGE = { from: "", to: "" };

/** Same key/shape as the Accounts tab (and ReceiptReview / Settings). */
const ACCOUNTS_KEY = ["accounts"];
const fetchAccounts = async () => {
  const r = await api.get("/accounts");
  return Array.isArray(r.data) ? r.data : [];
};

/**
 * Account detail (ROADMAP-V6 2.15): live header (GET /api/accounts/:id,
 * placeholder = the list row), Import/Export CSV, type chips + date filter
 * sheet driving the URL (?type=&from=&to=, strictly parsed), the paged
 * transaction list and a read-only detail sheet per row. No edit/delete.
 */
export default function AccountDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const businessCurrency = useAuthStore((s) => s.business?.currency) || "USD";
  const online = useOnline();
  const lang = i18n.language;

  const filters = useMemo(() => parseTxFilters(searchParams), [searchParams]);
  const filtered = !!(filters.type || filters.from || filters.to);

  const [selected, setSelected] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_RANGE);

  // The list row carries transaction_count / total_income / total_expenses,
  // which the detail endpoint lacks. Same key as the Accounts tab, so a warm
  // cache answers instantly and a cold deep link still fills the hero.
  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: fetchAccounts,
    select: (rows) => rows.find((a) => a.id === id),
  });
  const listRow = accountsQuery.data;

  // Live balance / is_active / currency / type / name on every mount.
  const accountQuery = useQuery({
    queryKey: ["accounts", id],
    queryFn: () => api.get(`/accounts/${id}`).then((r) => r.data),
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: listRow,
  });
  const account = accountQuery.data;
  const isActive = account?.is_active !== false;

  const tx = useAccountTransactions(id, filters);

  const refetchAccount = accountQuery.refetch;
  const refetchList = tx.refetch;
  const refetchAccounts = accountsQuery.refetch;
  useEffect(
    () =>
      onResume(() => {
        refetchAccount();
        refetchList();
      }),
    [refetchAccount, refetchList],
  );

  const refreshAll = () =>
    Promise.all([refetchAccount(), refetchList(), refetchAccounts()]);

  const goBack = () => {
    if (location.key === "default") navigate("/accounts", { replace: true });
    else navigate(-1);
  };

  const writeFilters = (next) =>
    setSearchParams(serializeTxFilters(next), { replace: true });

  const setType = (value) => {
    haptics.tap();
    writeFilters({ ...filters, type: value === "all" ? "" : value });
  };

  const openFilters = () => {
    setDraft({ from: filters.from, to: filters.to });
    setFiltersOpen(true);
  };

  const applyFilters = ({ from, to }) => {
    writeFilters({ ...filters, from, to });
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    writeFilters({ ...filters, from: "", to: "" });
    setDraft(EMPTY_RANGE);
    setFiltersOpen(false);
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
        {account?.name || listRow?.name || ""}
      </h1>
    </div>
  );

  if (!account && accountQuery.isPending) {
    return (
      <div className="p-4">
        {header}
        <div className="animate-pulse space-y-3">
          <Card padding="md" className="h-36" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-12 rounded-xl bg-sunken" />
            <div className="h-12 rounded-xl bg-sunken" />
          </div>
          <div className="h-40 rounded-card bg-sunken" />
        </div>
      </div>
    );
  }

  if (!account) {
    const info = describeError(accountQuery.error, t, ERR_OPTS);
    const notFound = info.kind === "notFound";
    const offline = info.kind === "network";
    let title = info.text;
    if (notFound) title = t("mobile.accounts.notFound");
    else if (offline) title = t("mobile.common.offline");
    return (
      <div className="p-4">
        {header}
        <EmptyState
          icon="ti-alert-circle"
          title={title}
          message={offline ? t("mobile.common.offlineHint") : undefined}
          action={
            notFound ? (
              <Button variant="secondary" size="lg" onClick={goBack}>
                {t("mobile.common.back")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                icon="ti-refresh"
                onClick={() => refetchAccount()}
              >
                {t("mobile.common.retry")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  const chipOptions = [
    { value: "all", label: t("common.all") },
    { value: "income", label: t("common.income") },
    { value: "expense", label: t("common.expense") },
  ];
  const dateFilterCount = (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  return (
    <>
      <PullToRefresh
        onRefresh={refreshAll}
        refreshing={
          (accountQuery.isRefetching || tx.isRefetching) &&
          !tx.isFetchingNextPage
        }
        className="min-h-full"
      >
        <div className="p-4 pb-2">
          {header}
          <AccountHero account={account} listRow={listRow} lang={lang} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              full
              icon="ti-upload"
              disabled={!isActive}
              onClick={() => navigate(`/accounts/${id}/import`)}
            >
              {t("mobile.accounts.importCsv")}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              full
              icon="ti-download"
              disabled={!online}
              onClick={() => setExportOpen(true)}
            >
              {t("mobile.accounts.exportCsv")}
            </Button>
          </div>
          {!isActive && (
            <p className="mt-1 text-xs text-muted">
              {t("mobile.accounts.importInactiveHint")}
            </p>
          )}
        </div>

        <div className="sticky top-0 z-10 flex items-center gap-2 bg-canvas px-4 pb-3">
          {/* StatusChips bleeds -mx-4 to scroll edge to edge; the wrapper
              clips it so the row stays clear of the filter button. */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <StatusChips
              options={chipOptions}
              value={filters.type || "all"}
              onChange={setType}
              label={t("common.filters")}
            />
          </div>
          <FilterButton
            count={dateFilterCount}
            label={t("common.filters")}
            size="md"
            className="min-h-[44px] shrink-0"
            onClick={openFilters}
          />
        </div>

        <div className="px-4 pb-4">
          {!tx.isPending && !tx.isError && (
            <p className="mb-2 text-xs text-muted">
              {t("transactions.totalCount", { count: tx.total })}
            </p>
          )}
          <TransactionList
            rows={tx.rows}
            total={tx.total}
            isPending={tx.isPending}
            isError={tx.isError}
            error={tx.error}
            hasNextPage={tx.hasNextPage}
            isFetchingNextPage={tx.isFetchingNextPage}
            fetchNextPage={tx.fetchNextPage}
            onRetry={() => refetchList()}
            onOpen={setSelected}
            currency={businessCurrency}
            lang={lang}
            filtered={filtered}
          />
        </div>
      </PullToRefresh>

      <TransactionFilterSheet
        open={filtersOpen}
        draft={draft}
        onChange={setDraft}
        onApply={applyFilters}
        onClear={clearFilters}
        onClose={() => setFiltersOpen(false)}
      />
      <TransactionSheet
        tx={selected}
        currency={businessCurrency}
        lang={lang}
        onClose={() => setSelected(null)}
      />
      <ExportSheet
        open={exportOpen}
        account={account}
        filters={filters}
        total={tx.total}
        currency={businessCurrency}
        onClose={() => setExportOpen(false)}
      />
    </>
  );
}
