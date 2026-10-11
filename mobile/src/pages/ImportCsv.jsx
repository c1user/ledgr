import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, EmptyState, Field, Toggle } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { confirmDialog, toast } from "@abaco/ui/feedback";
import {
  IMPORT_LIMITS,
  buildImportRows,
  columnSamples,
  guessImportColumns,
} from "@abaco/csv";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import { useOnline } from "../lib/useOnline.js";
import { unwrapTxPage } from "../lib/transactionsPaging.js";
import {
  PARSE_ERROR_KEYS,
  bodyTooLarge,
  buildImportBody,
  extractRowErrors,
  importRetryOptions,
  isUnconfirmedImportError,
  parseCsvFile,
  pickCsvFile,
  runImport,
} from "../lib/csvImport.js";
import useAuthStore from "../store/authStore.js";
import * as haptics from "../native/haptics.js";
import AccountRow from "../components/accounts/AccountRow.jsx";
import PickerTrigger from "../components/review/PickerTrigger.jsx";
import Segmented from "../components/settings/Segmented.jsx";
import SettingRow from "../components/settings/SettingRow.jsx";
import ColumnPickerSheet from "../components/import/ColumnPickerSheet.jsx";
import ImportSummary from "../components/import/ImportSummary.jsx";
import {
  formatMoney,
  formatReceiptDate,
  toNumber,
} from "../components/receipts/receiptFormat.js";

const ERR_OPTS = { rateLimitedKey: "mobile.common.rateLimited" };
/** Same key/shape as the Accounts tab, ReceiptReview and Settings. */
const ACCOUNTS_QUERY_KEY = ["accounts"];
const PREVIEW_ROWS = 8;
const MAX_ROW_ERRORS = 5;
/**
 * Unconfirmed view: how long Retry stays disabled while the account's
 * transaction count is re-read, so a batch the server is still committing
 * can land — and be seen — before the same rows are sent again. The backend
 * also serialises imports into one account (advisory lock), so the retry's
 * dedupe sees the first batch either way; this is belt and braces that also
 * lets the user compare the counts before tapping Retry.
 */
const RETRY_GRACE_MS = 15_000;
/** How often the unconfirmed view re-reads the count during the grace period. */
const PROBE_INTERVAL_MS = 5_000;

// Literal maps — never build i18n keys or class names by interpolation.
const ROLE_KEYS = {
  date: "transactions.colDate",
  description: "transactions.colDescription",
  amount: "transactions.colAmount",
  debit: "mobile.accounts.import.colDebit",
  credit: "mobile.accounts.import.colCredit",
  notes: "mobile.accounts.import.colNotes",
};
/**
 * Short names for the picker sheet title ("Choose the {{field}} column").
 * The description role is worded "Description" everywhere on this page (the
 * Field label and the collapsed summary), never "Merchant".
 */
const ROLE_SHORT_KEYS = {
  date: "common.date",
  description: "mobile.accounts.import.colDescriptionShort",
  amount: "common.amount",
  debit: "mobile.accounts.import.colDebit",
  credit: "mobile.accounts.import.colCredit",
  notes: "common.notes",
};
const OPTIONAL_ROLES = new Set(["description", "notes"]);
const ROLE_ORDER = {
  single: ["date", "description", "amount", "notes"],
  debitCredit: ["date", "description", "debit", "credit", "notes"],
};
const EMPTY_MAPPING = {
  date: "",
  description: "",
  amount: "",
  debit: "",
  credit: "",
  notes: "",
};

const isMappingComplete = (mapping, mode) =>
  !!mapping.date &&
  (mode === "debitCredit"
    ? !!(mapping.debit && mapping.credit)
    : !!mapping.amount);

const txRangePath = (id, stats) => {
  const params = new URLSearchParams();
  if (stats?.minDate) params.set("from", stats.minDate);
  if (stats?.maxDate) params.set("to", stats.maxDate);
  const qs = params.toString();
  return `/accounts/${id}${qs ? `?${qs}` : ""}`;
};

function SectionTitle({ children }) {
  return (
    <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </h2>
  );
}

/** One built row of the preview: merchant · date · signed, toned amount. */
function PreviewRow({ row, currency, lang }) {
  const { t } = useTranslation();
  const income = row.amount > 0;
  return (
    <li className="flex min-h-[44px] items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-md text-ink">
          {row.merchant || t("dashboard.noMerchant")}
        </div>
        <div className="text-xs text-muted">{formatReceiptDate(row.date)}</div>
      </div>
      <span
        className={cx(
          "shrink-0 text-md font-semibold",
          income ? "text-income" : "text-expense",
        )}
      >
        {income ? "+" : "−"}
        {formatMoney(Math.abs(row.amount), currency, lang)}
      </span>
    </li>
  );
}

/**
 * CSV import into a bank account (ROADMAP-V6 2.15, spec §2.11) — route
 * /accounts/:id/import. One scrolling page: target account → file → column
 * mapping (collapsed when auto-guessed) → options → live summary → preview →
 * sticky CTA. ONE atomic POST of ≤ 2000 rows; larger files are refused with
 * a pointer to the web. Three alternative bodies replace the form: the
 * result, the "unconfirmed" view after a network/timeout failure (Retry
 * forces skipDuplicates so nothing books twice) and the backend's row
 * rejections.
 *
 * Leaving with a file loaded asks first. The header button is ours, but the
 * Android Back / browser back run history.back() behind our back (see
 * lib/backButton.js), so once a file is loaded the page pushes a duplicate
 * history entry for its own route (state.importGuard). Popping it keeps this
 * component mounted (same route, state intact); the effect below then asks,
 * and either re-pushes the guard or finishes the exit. The guard is also
 * unwound deliberately by leave(), so a user-initiated exit replaces the
 * original entry and never leaves an empty import page in the stack.
 */
export default function ImportCsv() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const currency = useAuthStore((s) => s.business?.currency) || "USD";
  const online = useOnline();
  const lang = i18n.language;

  // ── State ──
  const [file, setFile] = useState(null); // { name, fields, data, samples }
  const [fileError, setFileError] = useState(null); // { key, params }
  const [picking, setPicking] = useState(false);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [mode, setMode] = useState("single");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [pickerRole, setPickerRole] = useState(null);
  const [negate, setNegate] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [forcedSkip, setForcedSkip] = useState(false);
  const [view, setView] = useState("form"); // form | result | unconfirmed | rowErrors
  const [result, setResult] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  // Unconfirmed view: Retry is held back for a grace period while the
  // account's count is re-read (RETRY_GRACE_MS); `sent` remembers what left
  // the phone so the user can compare before / sent / now.
  const [graceOver, setGraceOver] = useState(false);
  const [sent, setSent] = useState({ before: null, count: 0 });

  // ── Target account (the Accounts tab's cache; fetched on a cold deep link) ──
  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const r = await api.get("/accounts");
      return Array.isArray(r.data) ? r.data : [];
    },
  });
  const account = useMemo(
    () =>
      (Array.isArray(accountsQuery.data) ? accountsQuery.data : []).find(
        (a) => a.id === id,
      ) || null,
    [accountsQuery.data, id],
  );
  const isActive = !!account && account.is_active !== false;

  // ── Derived rows (pure, recomputed on every mapping/option change) ──
  // In-file repeats are dropped only while "Skip duplicates" is on: with it
  // off, two identical same-day charges are both legitimate and both sent
  // (the web import keeps them too).
  const built = useMemo(
    () =>
      file
        ? buildImportRows(file.data, mapping, {
            negate,
            mode,
            dedupeInFile: skipDuplicates,
          })
        : null,
    [file, mapping, negate, mode, skipDuplicates],
  );
  const rows = built?.rows ?? [];
  const body = useMemo(
    () => (built ? buildImportBody(id, built.rows, skipDuplicates) : null),
    [built, id, skipDuplicates],
  );
  const tooLarge = useMemo(() => (body ? bodyTooLarge(body) : false), [body]);
  const warnings = useMemo(
    () =>
      built
        ? tooLarge
          ? [...built.warnings, "bodyTooLarge"]
          : built.warnings
        : [],
    [built, tooLarge],
  );
  const mappingComplete = isMappingComplete(mapping, mode);

  // ── Mutation: one atomic batch ──
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["balances"] });
  }, [queryClient]);
  const mutation = useMutation({
    mutationFn: (payload) => runImport(api, payload),
    retry: 0,
    onSuccess: (data) => {
      haptics.success();
      invalidateAll();
      setResult(data || {});
      setView("result");
    },
    onError: (err) => {
      haptics.error();
      // No response, a client timeout or a gateway 5xx: the batch may well
      // have committed. Refresh whatever the user sees next (however they
      // leave this page) and let them check before sending the rows again.
      if (isUnconfirmedImportError(err)) {
        invalidateAll();
        setGraceOver(false); // the effect below re-arms the timer
        setView("unconfirmed");
        return;
      }
      const errs = extractRowErrors(err);
      if (errs.length > 0) {
        setRowErrors(errs);
        setView("rowErrors");
        return;
      }
      toast.error(describeError(err, t, ERR_OPTS).text);
    },
  });
  const isPending = mutation.isPending;
  const canImport =
    online &&
    !isPending &&
    rows.length > 0 &&
    rows.length <= IMPORT_LIMITS.maxRows &&
    mappingComplete &&
    !tooLarge;

  // ── Unconfirmed view: did the batch land? ──
  // Retry waits out a grace period while the account's transaction count is
  // re-read a few times (GET /transactions?accountId&limit=1 → total), so a
  // batch the server was still committing shows up before the rows go again.
  const probing = view === "unconfirmed";
  useEffect(() => {
    if (!probing) return undefined;
    const timer = setTimeout(() => setGraceOver(true), RETRY_GRACE_MS);
    return () => clearTimeout(timer);
  }, [probing]);
  const probe = useQuery({
    queryKey: ["transactions", "account", id, "import-probe"],
    queryFn: async () => {
      const r = await api.get("/transactions", {
        params: { accountId: id, limit: 1, offset: 0 },
      });
      return unwrapTxPage(r.data).total;
    },
    enabled: probing,
    staleTime: 0,
    gcTime: 0,
    retry: 0,
    refetchInterval: probing && !graceOver ? PROBE_INTERVAL_MS : false,
  });
  const checking = probing && (!graceOver || probe.isFetching);

  // ── Leave guard (see the component comment) ──
  const guardRef = useRef(false); // our duplicate entry is on top of history
  const leaveRef = useRef(null); // { to } while leave() unwinds the guard
  const mountedRef = useRef(false);
  const latest = useRef({ file: null, view: "form", isPending: false });
  useEffect(() => {
    latest.current = { file, view, isPending };
  }, [file, view, isPending]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const here = location.pathname + location.search;
  const pushGuard = () => {
    if (guardRef.current) return;
    guardRef.current = true;
    navigate(here, { state: { importGuard: true } });
  };
  const goBack = () => {
    if (location.key === "default") {
      navigate(`/accounts/${id}`, { replace: true });
    } else {
      navigate(-1);
    }
  };
  /** Exit: to a path (replacing this page) or one step back. */
  const leave = (to = null) => {
    if (guardRef.current) {
      leaveRef.current = { to };
      navigate(-1); // pops the guard; the effect finishes the exit
      return;
    }
    if (to) navigate(to, { replace: true });
    else goBack();
  };

  useEffect(() => {
    if (!guardRef.current || location.state?.importGuard) return;
    // The guard entry was just popped: by leave(), or by Android/browser Back.
    guardRef.current = false;
    const intent = leaveRef.current;
    leaveRef.current = null;
    const target = location.pathname + location.search;
    const finish = () => {
      if (!mountedRef.current) return;
      if (intent?.to) navigate(intent.to, { replace: true });
      else if (location.key === "default") {
        navigate(`/accounts/${id}`, { replace: true });
      } else navigate(-1);
    };
    const repush = () => {
      if (!mountedRef.current) return;
      guardRef.current = true;
      navigate(target, { state: { importGuard: true } });
    };
    if (intent) {
      finish();
      return;
    }
    const { file: f, view: v, isPending: p } = latest.current;
    if (p) {
      repush(); // Back is ignored while the batch is in flight
      return;
    }
    if (v === "rowErrors") {
      // Back from the rejection list returns to the form (the mapping is
      // kept), exactly like the view's own Back button.
      setView("form");
      repush();
      return;
    }
    if (v === "unconfirmed") {
      invalidateAll(); // the batch may have committed — same as Done
      finish();
      return;
    }
    if (!f || v === "result") {
      finish();
      return;
    }
    confirmDialog({
      message: t("mobile.accounts.import.discard"),
      confirmLabel: t("mobile.common.back"),
      danger: true,
    }).then((ok) => (ok ? finish() : repush()));
  }, [location, navigate, id, t, invalidateAll]);

  const onBack = () => {
    if (isPending) return;
    if (view === "rowErrors") {
      setView("form"); // same as the view's own Back button
      return;
    }
    if (view === "unconfirmed") {
      invalidateAll(); // the batch may have committed — same as Done
      leave();
      return;
    }
    if (!file || view === "result") {
      leave();
      return;
    }
    confirmDialog({
      message: t("mobile.accounts.import.discard"),
      confirmLabel: t("mobile.common.back"),
      danger: true,
    }).then((ok) => {
      if (ok) leave();
    });
  };

  // ── Handlers ──
  const pick = async () => {
    if (picking || isPending) return;
    setPicking(true);
    try {
      const picked = await pickCsvFile();
      if (!picked) return;
      const { fields, data } = await parseCsvFile(picked);
      const { mode: guessedMode, ...guessed } = guessImportColumns(fields);
      setMapping(guessed);
      setMode(guessedMode);
      setMappingOpen(!isMappingComplete(guessed, guessedMode));
      setFile({
        name: picked.name || "file.csv",
        fields,
        data,
        samples: columnSamples(data, fields),
      });
      setFileError(null);
      setResult(null);
      setRowErrors([]);
      setView("form");
      pushGuard();
    } catch (err) {
      setFile(null);
      setFileError({
        key: PARSE_ERROR_KEYS[err?.reason] || PARSE_ERROR_KEYS.parse,
        params: { count: err?.count, max: IMPORT_LIMITS.maxRows },
      });
    } finally {
      setPicking(false);
    }
  };

  const selectColumn = (role, field) => {
    setMapping((m) => {
      const next = { ...m };
      if (field) {
        // A header serves one role at a time.
        for (const k of Object.keys(next)) {
          if (k !== role && next[k] === field) next[k] = "";
        }
      }
      next[role] = field;
      return next;
    });
  };

  const changeMode = (next) => {
    if (next === mode) return;
    haptics.tap();
    setMode(next);
  };

  const submit = () => {
    if (!canImport || !body) return;
    // The list row's COUNT(*) before this batch (the same count GET
    // /transactions?accountId reports), for the unconfirmed view.
    setSent({
      before: toNumber(account?.transaction_count),
      count: body.rows.length,
    });
    mutation.mutate(body);
  };

  const retry = () => {
    if (checking || !online) return;
    const next = importRetryOptions(mutation.error, { skipDuplicates });
    setSkipDuplicates(next.skipDuplicates);
    setForcedSkip(!!next.forcedSkip);
    setView("form");
    // Forced skip also keeps in-file repeats out, like the toggle does.
    const resent = buildImportRows(file.data, mapping, {
      negate,
      mode,
      dedupeInFile: next.skipDuplicates,
    }).rows;
    setSent((s) => ({ ...s, count: resent.length }));
    mutation.mutate(buildImportBody(id, resent, next.skipDuplicates));
  };

  const header = (
    <div className="-ml-2 mb-3 flex items-center gap-1">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("mobile.common.back")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-sunken"
      >
        <i className="ti ti-chevron-left text-xl" aria-hidden="true" />
      </button>
      <h1 className="truncate text-lg font-semibold text-ink">
        {t("mobile.accounts.import.title")}
      </h1>
    </div>
  );

  const backAction = (
    <Button variant="secondary" size="lg" onClick={goBack}>
      {t("mobile.common.back")}
    </Button>
  );

  // ── Target account gates ──
  if (!account && accountsQuery.isPending) {
    return (
      <div className="p-4">
        {header}
        <div className="animate-pulse space-y-4">
          <div className="h-14 rounded-card bg-sunken" />
          <div className="h-12 rounded-card bg-sunken" />
        </div>
      </div>
    );
  }
  if (!account && accountsQuery.isError) {
    return (
      <div className="p-4">
        {header}
        <EmptyState
          icon="ti-alert-circle"
          title={describeError(accountsQuery.error, t, ERR_OPTS).text}
          action={
            <Button
              variant="secondary"
              size="lg"
              icon="ti-refresh"
              onClick={() => accountsQuery.refetch()}
            >
              {t("mobile.common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (!account) {
    return (
      <div className="p-4">
        {header}
        <EmptyState
          icon="ti-alert-circle"
          title={t("mobile.accounts.notFound")}
          action={backAction}
        />
      </div>
    );
  }
  if (!isActive) {
    return (
      <div className="p-4">
        {header}
        <EmptyState
          icon="ti-wallet-off"
          title={t("mobile.accounts.import.inactiveAccount")}
          action={backAction}
        />
      </div>
    );
  }

  // ── Result view ──
  if (view === "result") {
    const imported = Number(result?.imported) || 0;
    const skipped = Number(result?.skipped) || 0;
    const total = Number(result?.total) || 0;
    const nothing = imported === 0 && skipped > 0 && skipped === total;
    return (
      <div className="flex min-h-full flex-col p-4">
        {header}
        <Card padding="md" className="fade-in text-center">
          <i
            className={cx(
              "ti text-5xl",
              nothing
                ? "ti-info-circle text-brand"
                : "ti-circle-check text-income",
            )}
            aria-hidden="true"
          />
          <h2 className="mt-2 text-lg font-semibold text-ink">
            {t("transactions.importResult", { imported, skipped })}
          </h2>
          {nothing ? (
            <p className="mt-1 text-md text-muted">
              {t("mobile.accounts.import.nothingImported")}
            </p>
          ) : (
            skipped > 0 && (
              <p className="mt-1 text-md text-muted">
                {t("mobile.accounts.import.skippedHint")}
              </p>
            )
          )}
        </Card>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            full
            icon="ti-list"
            onClick={() => leave(txRangePath(id, built?.stats))}
          >
            {t("mobile.accounts.import.viewTransactions")}
          </Button>
          {/* Done goes BACK to the account entry already in history (a path
              would replace this page with a second copy of it, so Back from
              the account would appear to do nothing). */}
          <Button size="lg" full onClick={() => leave()}>
            {t("mobile.common.done")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Unconfirmed view (network / timeout / gateway 5xx after the POST left) ──
  if (view === "unconfirmed") {
    const { before, count: sentCount } = sent;
    const now = typeof probe.data === "number" ? probe.data : null;
    return (
      <div className="flex min-h-full flex-col p-4">
        {header}
        <Card padding="md" className="text-center">
          <i
            className="ti ti-help-circle text-5xl text-muted"
            aria-hidden="true"
          />
          <h2 className="mt-2 text-lg font-semibold text-ink">
            {t("mobile.accounts.import.unconfirmed")}
          </h2>
          <p className="mt-1 text-md text-muted">
            {t("mobile.accounts.import.retrySafe")}
          </p>
          {/* before + sent = now means the batch landed; the user can tell
              before deciding to Retry (which only books what is missing). */}
          <dl
            className="mt-3 divide-y divide-line rounded-lg bg-sunken px-3 text-left text-sm"
            aria-live="polite"
          >
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-muted">
                {t("mobile.accounts.import.rowsSent")}
              </dt>
              <dd className="font-medium text-ink tabular-nums">{sentCount}</dd>
            </div>
            {before !== null && (
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted">
                  {t("mobile.accounts.import.countBefore")}
                </dt>
                <dd className="font-medium text-ink tabular-nums">{before}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-muted">
                {t("mobile.accounts.import.countNow")}
              </dt>
              <dd className="font-medium text-ink tabular-nums">
                {now === null ? "—" : now}
              </dd>
            </div>
          </dl>
          {checking && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
              <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />
              {t("mobile.accounts.import.checking")}
            </p>
          )}
        </Card>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            full
            icon="ti-refresh"
            disabled={!online || checking}
            onClick={retry}
          >
            {t("mobile.common.retry")}
          </Button>
          {!online && (
            <p className="text-center text-xs text-muted">
              {t("mobile.accounts.import.offline")}
            </p>
          )}
          <Button
            size="lg"
            full
            onClick={() => {
              invalidateAll(); // the batch may have committed
              leave();
            }}
          >
            {t("mobile.common.done")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Row-error view (400 "Some rows are invalid"); the mapping is kept ──
  if (view === "rowErrors") {
    return (
      <div className="flex min-h-full flex-col p-4">
        {header}
        <Card padding="md">
          <div className="flex items-center gap-2 text-expense">
            <i className="ti ti-alert-circle text-2xl" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {t("mobile.accounts.import.rowErrors", {
                count: rowErrors.length,
              })}
            </h2>
          </div>
          <ul className="mt-2 divide-y divide-line text-md text-ink">
            {rowErrors.slice(0, MAX_ROW_ERRORS).map((e, i) => (
              <li key={`${e.row}-${i}`} className="py-2">
                {t("mobile.accounts.import.rowError", {
                  row: e.row,
                  error: e.error,
                })}
              </li>
            ))}
          </ul>
        </Card>
        <div className="mt-4">
          <Button
            size="lg"
            full
            icon="ti-chevron-left"
            onClick={() => setView("form")}
          >
            {t("mobile.common.back")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Form ──
  const unmapped = t("transactions.importUnmapped");
  const columnsSummary =
    mode === "debitCredit"
      ? t("mobile.accounts.import.columnsSummaryDebitCredit", {
          date: mapping.date,
          description: mapping.description || unmapped,
          debit: mapping.debit,
          credit: mapping.credit,
        })
      : t("mobile.accounts.import.columnsSummary", {
          date: mapping.date,
          description: mapping.description || unmapped,
          amount: mapping.amount,
        });

  return (
    <>
      <div className="flex min-h-full flex-col p-4">
        {header}

        {/* 1. Target */}
        <section className="mb-4">
          <SectionTitle>{t("transactions.importAccount")}</SectionTitle>
          <Card padding="none" className="overflow-hidden">
            <AccountRow as="div" account={account} lang={lang} />
          </Card>
        </section>

        {/* 2. File */}
        <section className="mb-4">
          {!file ? (
            <Button
              variant="primary"
              size="lg"
              full
              icon="ti-file-upload"
              loading={picking}
              onClick={pick}
            >
              {t("mobile.accounts.import.chooseFile")}
            </Button>
          ) : (
            <Card padding="sm" className="flex items-center gap-3">
              <i
                className="ti ti-file-type-csv shrink-0 text-2xl text-brand"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-md font-medium text-ink">
                  {file.name}
                </div>
                <div className="text-xs text-muted">
                  {t("transactions.importParsedRows", {
                    count: file.data.length,
                  })}
                </div>
              </div>
              <Button
                size="md"
                className="min-h-[44px] shrink-0"
                loading={picking}
                disabled={isPending}
                onClick={pick}
              >
                {t("mobile.accounts.import.changeFile")}
              </Button>
            </Card>
          )}
          {fileError && (
            <p role="alert" className="mt-2 text-sm text-expense">
              {t(fileError.key, fileError.params)}
            </p>
          )}
        </section>

        {file && (
          <>
            {/* 3. Columns */}
            <section className="mb-4">
              <SectionTitle>{t("transactions.mapColumns")}</SectionTitle>
              <Card padding="md">
                {!mappingOpen && mappingComplete ? (
                  <div className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 text-sm text-ink">
                      {columnsSummary}
                    </p>
                    <Button
                      size="md"
                      className="min-h-[44px] shrink-0"
                      disabled={isPending}
                      onClick={() => setMappingOpen(true)}
                    >
                      {t("mobile.accounts.import.change")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Field label={t("mobile.accounts.import.amountMode")}>
                      <Segmented
                        value={mode}
                        onChange={changeMode}
                        ariaLabel={t("mobile.accounts.import.amountMode")}
                        options={[
                          {
                            value: "single",
                            label: t("mobile.accounts.import.amountSingle"),
                          },
                          {
                            value: "debitCredit",
                            label: t(
                              "mobile.accounts.import.amountDebitCredit",
                            ),
                          },
                        ]}
                      />
                    </Field>
                    {ROLE_ORDER[mode].map((role) => (
                      <Field
                        key={role}
                        label={t(ROLE_KEYS[role])}
                        htmlFor={`import-col-${role}`}
                        required={!OPTIONAL_ROLES.has(role)}
                        className="mb-3"
                      >
                        <PickerTrigger
                          id={`import-col-${role}`}
                          empty={!mapping[role]}
                          placeholder={unmapped}
                          disabled={isPending}
                          onClick={() => setPickerRole(role)}
                        >
                          {mapping[role]}
                        </PickerTrigger>
                      </Field>
                    ))}
                  </>
                )}
              </Card>
            </section>

            {/* 4. Options */}
            <Card
              padding="none"
              className="mb-4 overflow-hidden divide-y divide-line"
            >
              <SettingRow
                label={t("transactions.negateAmounts")}
                hint={t("mobile.accounts.import.flipHint")}
                control={
                  <Toggle
                    checked={negate}
                    onChange={() => {
                      haptics.tap();
                      setNegate((v) => !v);
                    }}
                    disabled={isPending}
                    aria-label={t("transactions.negateAmounts")}
                  />
                }
              />
              <SettingRow
                label={t("transactions.skipDuplicates")}
                hint={t(
                  forcedSkip
                    ? "mobile.accounts.import.retrySafe"
                    : "mobile.accounts.import.skipDuplicatesHint",
                )}
                control={
                  <Toggle
                    checked={skipDuplicates}
                    onChange={() => {
                      haptics.tap();
                      setSkipDuplicates((v) => !v);
                    }}
                    disabled={forcedSkip || isPending}
                    aria-label={t("transactions.skipDuplicates")}
                  />
                }
              />
            </Card>

            {/* 5. Summary */}
            {mappingComplete && built && (
              <div className="mb-4">
                <ImportSummary
                  stats={built.stats}
                  warnings={warnings}
                  skipped={built.skipped}
                  currency={currency}
                  lang={lang}
                />
              </div>
            )}

            {/* 6. Preview */}
            {mappingComplete && rows.length > 0 && (
              <section className="mb-4">
                <SectionTitle>
                  {t("mobile.accounts.import.previewTitle")}
                </SectionTitle>
                <Card padding="none" className="overflow-hidden">
                  <ul className="divide-y divide-line">
                    {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                      <PreviewRow
                        key={`${row.date}-${i}`}
                        row={row}
                        currency={currency}
                        lang={lang}
                      />
                    ))}
                  </ul>
                  {rows.length > PREVIEW_ROWS && (
                    <p className="border-t border-line px-3 py-2 text-xs text-muted">
                      {t("mobile.accounts.import.andMore", {
                        count: rows.length - PREVIEW_ROWS,
                      })}
                    </p>
                  )}
                </Card>
                <p className="mt-2 text-xs text-muted">
                  {t("transactions.importWillImport", { count: rows.length })}
                </p>
              </section>
            )}

            {/* 7. Sticky CTA */}
            <div className="sticky bottom-0 -mx-4 mt-auto border-t border-line bg-canvas px-4 pt-3">
              <Button
                variant="primary"
                size="lg"
                full
                icon="ti-upload"
                loading={isPending}
                disabled={!canImport}
                className="mb-3"
                onClick={submit}
              >
                {isPending
                  ? t("transactions.importing")
                  : t("transactions.runImport")}
              </Button>
              {!online && (
                <p className="mb-3 text-xs text-muted">
                  {t("mobile.accounts.import.offline")}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <ColumnPickerSheet
        open={!!pickerRole}
        title={
          pickerRole
            ? t("mobile.accounts.import.pickColumn", {
                field: t(ROLE_SHORT_KEYS[pickerRole]),
              })
            : ""
        }
        fields={file?.fields ?? []}
        samples={file?.samples}
        value={pickerRole ? mapping[pickerRole] : ""}
        allowNone={pickerRole ? OPTIONAL_ROLES.has(pickerRole) : false}
        onSelect={(field) => pickerRole && selectColumn(pickerRole, field)}
        onClose={() => setPickerRole(null)}
      />
    </>
  );
}
