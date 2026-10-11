import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, PageHeader } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import useAuthStore from "../store/authStore.js";
import { onResume } from "../native/appLifecycle.js";
import * as haptics from "../native/haptics.js";
import PullToRefresh from "../components/receipts/PullToRefresh.jsx";
import AccountRow from "../components/accounts/AccountRow.jsx";
import BalanceSummary from "../components/accounts/BalanceSummary.jsx";
import {
  ACCOUNTS_QUERY_KEY,
  BALANCES_QUERY_KEY,
  splitActive,
} from "../components/accounts/accountFormat.js";

/** The Accounts screens never upload, so a 429 gets the neutral copy. */
const ERR_OPTS = { rateLimitedKey: "mobile.common.rateLimited" };

const SKELETON_ROWS = [0, 1, 2];

const LIST_CLASS =
  "divide-y divide-line rounded-card border border-line bg-surface overflow-hidden";

// Same key and shape as ReceiptReview / Settings (they share the cache).
const fetchAccounts = async () => {
  const r = await api.get("/accounts");
  return Array.isArray(r.data) ? r.data : [];
};

const fetchBalances = () =>
  api.get("/accounts/summary/balances").then((r) => r.data);

/**
 * Accounts tab root (ROADMAP-V6 2.15): business-wide balance summary, the
 * active accounts with live balances, a collapsed section for the inactive
 * ones, pull-to-refresh + refresh on resume. Read-only — accounts are
 * added, edited and deactivated on the web. A row opens /accounts/:id.
 */
export default function Accounts() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const businessCurrency = useAuthStore((s) => s.business?.currency) || "USD";
  const [showInactive, setShowInactive] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: fetchAccounts,
  });
  const balancesQuery = useQuery({
    queryKey: BALANCES_QUERY_KEY,
    queryFn: fetchBalances,
  });
  const { refetch: refetchAccounts } = accountsQuery;
  const { refetch: refetchBalances } = balancesQuery;

  // Balances move while the app is in the background (web bookings, the
  // outbox): refresh both whenever it comes back.
  useEffect(
    () =>
      onResume(() => {
        refetchAccounts();
        refetchBalances();
      }),
    [refetchAccounts, refetchBalances],
  );

  const { active, inactive } = useMemo(
    () => splitActive(accountsQuery.data),
    [accountsQuery.data],
  );
  const balances = balancesQuery.data;
  // account_count is a COUNT(*) string over the ACTIVE accounts only.
  const showSummary = !!balances && String(balances.account_count) !== "0";

  const go = (id) => {
    haptics.tap();
    navigate(`/accounts/${id}`);
  };

  const toggleInactive = () => {
    haptics.tap();
    setShowInactive((v) => !v);
  };

  const refreshAll = () => Promise.all([refetchAccounts(), refetchBalances()]);

  let body;
  if (accountsQuery.isPending) {
    body = (
      <ul className={LIST_CLASS}>
        {SKELETON_ROWS.map((i) => (
          <li
            key={i}
            className="flex min-h-[56px] items-center gap-3 p-3 animate-pulse"
          >
            <div className="h-9 w-9 shrink-0 rounded-lg bg-sunken" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/2 rounded bg-sunken" />
              <div className="h-3 w-1/3 rounded bg-sunken" />
            </div>
            <div className="h-4 w-16 rounded bg-sunken" />
          </li>
        ))}
      </ul>
    );
  } else if (accountsQuery.isError && !Array.isArray(accountsQuery.data)) {
    // No cache to fall back on (a failed refetch over cached rows keeps
    // showing them — the Shell's OfflineBanner says why).
    const info = describeError(accountsQuery.error, t, ERR_OPTS);
    const offline = info.kind === "network";
    body = (
      <EmptyState
        icon="ti-alert-circle"
        title={offline ? t("mobile.common.offline") : info.text}
        message={offline ? t("mobile.common.offlineHint") : undefined}
        action={
          <Button
            variant="secondary"
            size="lg"
            icon="ti-refresh"
            onClick={refreshAll}
          >
            {t("mobile.common.retry")}
          </Button>
        }
      />
    );
  } else if (active.length === 0 && inactive.length === 0) {
    body = (
      <EmptyState
        icon="ti-wallet"
        title={t("accounts.noneYet")}
        message={t("mobile.accounts.addOnWeb")}
      />
    );
  } else {
    body = (
      <>
        {active.length > 0 && (
          <ul className={LIST_CLASS}>
            {active.map((a) => (
              <li key={a.id}>
                <AccountRow
                  account={a}
                  lang={i18n.language}
                  onPress={() => go(a.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {inactive.length > 0 && (
          <section className="mt-4">
            <button
              type="button"
              aria-expanded={showInactive}
              onClick={toggleInactive}
              className="flex min-h-[44px] w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted"
            >
              <span>
                {t("mobile.accounts.inactiveSection")} · {inactive.length}
              </span>
              <i
                className={
                  showInactive ? "ti ti-chevron-up" : "ti ti-chevron-down"
                }
                aria-hidden="true"
              />
            </button>
            {showInactive && (
              <ul className={cx(LIST_CLASS, "opacity-50")}>
                {inactive.map((a) => (
                  <li key={a.id}>
                    <AccountRow
                      account={a}
                      lang={i18n.language}
                      inactive
                      onPress={() => go(a.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <PullToRefresh
      onRefresh={refreshAll}
      refreshing={accountsQuery.isRefetching || balancesQuery.isRefetching}
      className="min-h-full"
    >
      <div className="p-4 pb-2">
        <PageHeader
          title={t("accounts.title")}
          subtitle={
            accountsQuery.isPending
              ? undefined
              : t("accounts.count", { count: active.length })
          }
          className="mb-3"
        />
        {showSummary && (
          <BalanceSummary
            balances={balances}
            currency={businessCurrency}
            lang={i18n.language}
          />
        )}
      </div>
      <div className="px-4 pb-4">{body}</div>
    </PullToRefresh>
  );
}
