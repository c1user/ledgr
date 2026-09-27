import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Textarea,
  Toggle,
} from "@abaco/ui";
import cx from "@abaco/ui/cx";
import SplitEditor from "@abaco/ui/SplitEditor";
import { confirmDialog, toast } from "@abaco/ui/feedback";
import { coaToCategories } from "@abaco/locales/coa";
import api from "../lib/api.js";
import { describeError } from "../lib/apiErrors.js";
import { ENTITLEMENTS_QUERY_KEY } from "../lib/useEntitlements.js";
import {
  bookReceipt,
  deleteReceipt,
  filterActiveCoa,
  isCategoryRequiredError,
  makeFmt,
  receiptToForm,
  sanitizeAmountInput,
  saveReview,
  seedSplitsFromLineItems,
  suggestCategory,
  validateBooking,
} from "../lib/booking.js";
import useAuthStore from "../store/authStore.js";
import usePrefsStore from "../store/prefsStore.js";
import * as haptics from "../native/haptics.js";
import ConfidenceBar from "../components/review/ConfidenceBar.jsx";
import LineItemsEditor from "../components/review/LineItemsEditor.jsx";
import AccountPicker from "../components/review/AccountPicker.jsx";
import CategoryPicker from "../components/review/CategoryPicker.jsx";
import LinkExistingSheet from "../components/review/LinkExistingSheet.jsx";
import PickerTrigger from "../components/review/PickerTrigger.jsx";

// Literal maps — never build class names or i18n keys by interpolation.
const STATUS_TONES = {
  pending: "expense",
  reviewed: "payroll",
  linked: "income",
};
const STATUS_KEYS = {
  pending: "receipts.status.pending",
  reviewed: "receipts.status.reviewed",
  linked: "receipts.status.linked",
};
const TYPES = [
  {
    value: "expense",
    key: "common.expense",
    active: "bg-surface text-expense shadow-card",
  },
  {
    value: "income",
    key: "common.income",
    active: "bg-surface text-income shadow-card",
  },
];

// Sticky footers sit inside <main>, directly above the TabBar, which already
// carries the bottom safe-area inset — so they add none of their own (a
// second inset would leave ~34px of dead space above the tabs on a device).

const isImage = (receipt) =>
  !!receipt?.signed_url &&
  !/\.pdf$/i.test(receipt.original_filename || receipt.s3_key || "");

/**
 * Review & book (ROADMAP-V6 2.7): one scrolling page with a sticky CTA.
 * Loads the receipt from location.state (fresh from an upload) or
 * GET /receipts/:id, then hands it to <ReviewForm key={id}> so the form
 * state is initialised once per receipt.
 */
export default function ReceiptReview() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const stateReceipt =
    location.state?.receipt && location.state.receipt.id === id
      ? location.state.receipt
      : undefined;

  const query = useQuery({
    queryKey: ["receipts", id],
    queryFn: async () => (await api.get(`/receipts/${id}`)).data,
    initialData: stateReceipt,
    retry: (count, err) => err?.response?.status !== 404 && count < 1,
  });

  // A receipt that no longer exists → back to the list (no setState here).
  useEffect(() => {
    if (!query.isError) return;
    const described = describeError(query.error, t);
    if (described.kind === "notFound") {
      toast.error(described.text);
      navigate("/receipts", { replace: true });
    }
  }, [query.isError, query.error, navigate, t]);

  if (query.isPending) {
    return (
      <div className="p-4">
        <PageHeader title={t("mobile.review.title")} />
        <div className="flex items-center justify-center gap-2 py-12 text-md text-muted">
          <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />
          {t("mobile.common.loading")}
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-4">
        <PageHeader title={t("mobile.review.title")} />
        <EmptyState
          icon="ti-alert-circle"
          title={describeError(query.error, t).text}
          action={
            <Button icon="ti-refresh" onClick={() => query.refetch()}>
              {t("mobile.common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return <ReviewForm key={query.data.id} receipt={query.data} />;
}

function ReviewForm({ receipt }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currency = useAuthStore((s) => s.business?.currency) || "USD";
  const defaultAccountId = usePrefsStore((s) => s.defaultAccountId);
  const lastType = usePrefsStore((s) => s.lastType);
  const setDefaultAccountId = usePrefsStore((s) => s.setDefaultAccountId);
  const setLastType = usePrefsStore((s) => s.setLastType);
  const fmt = useMemo(
    () => makeFmt(i18n.language, currency),
    [i18n.language, currency],
  );

  const isLinked = receipt.status === "linked";

  // ── Form state ──
  const [form, setForm] = useState(() => receiptToForm(receipt));
  const [accountId, setAccountId] = useState(defaultAccountId || "");
  const [type, setType] = useState(
    lastType === "income" ? "income" : "expense",
  );
  const [categoryId, setCategoryId] = useState("");
  const [useSplit, setUseSplit] = useState(false);
  const [splits, setSplits] = useState([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [booked, setBooked] = useState(null); // transaction after success

  const patch = (fields) => setForm((f) => ({ ...f, ...fields }));

  // ── Reference data ──
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await api.get("/accounts")).data,
  });
  const coaQuery = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: async () => (await api.get("/chart-of-accounts")).data,
  });
  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: async () => (await api.get("/rules")).data,
  });

  const accounts = useMemo(
    () =>
      (Array.isArray(accountsQuery.data) ? accountsQuery.data : []).filter(
        (a) => a.is_active !== false,
      ),
    [accountsQuery.data],
  );
  // The remembered default only counts while it is still an active account;
  // a business with a single account gets it preselected.
  const effectiveAccountId = accounts.some((a) => a.id === accountId)
    ? accountId
    : accounts.length === 1
      ? accounts[0].id
      : "";

  const categories = useMemo(
    () =>
      coaToCategories(filterActiveCoa(coaQuery.data), t).filter(
        (c) => c.type === type,
      ),
    [coaQuery.data, t, type],
  );
  const suggestion = useMemo(
    () =>
      suggestCategory(
        Array.isArray(rulesQuery.data) ? rulesQuery.data : [],
        form.merchant,
        notes,
        type,
      ),
    [rulesQuery.data, form.merchant, notes, type],
  );
  const suggestedCategory = useMemo(
    () =>
      suggestion
        ? categories.find((c) => c.id === suggestion.categoryId) || null
        : null,
    [categories, suggestion],
  );
  // Effective category: the user's pick, else the rule suggestion.
  const effectiveCategoryId = categoryId || suggestedCategory?.id || "";
  const selectedCategory =
    categories.find((c) => c.id === effectiveCategoryId) || null;
  const usingSuggestion = !categoryId && !!suggestedCategory;

  const formForApi = () => ({
    ...form,
    accountId: effectiveAccountId,
    type,
    categoryId: effectiveCategoryId,
    useSplit,
    splits,
    notes,
  });

  const invalidateAfterBooking = () => {
    queryClient.invalidateQueries({ queryKey: ["receipts"] });
    queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  // ── Mutations ──
  const book = useMutation({
    mutationFn: () => bookReceipt({ api, receipt, form: formForApi() }),
    onSuccess: ({ transaction }) => {
      invalidateAfterBooking();
      setDefaultAccountId(effectiveAccountId);
      setLastType(type);
      haptics.success();
      toast.success(t("mobile.review.book.booked"));
      setError("");
      setBooked(transaction);
    },
    onError: (err) => {
      haptics.error();
      if (isCategoryRequiredError(err)) {
        setError(t("mobile.review.errors.selectCategory"));
        setCategoryOpen(true);
        return;
      }
      const described = describeError(err, t);
      if (described.kind === "notFound") {
        toast.error(described.text);
        navigate("/receipts", { replace: true });
        return;
      }
      if (described.kind === "network") {
        toast.error(described.text);
        return;
      }
      setError(described.text);
    },
  });

  const save = useMutation({
    mutationFn: () => saveReview({ api, receipt, form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      haptics.success();
      toast.success(t("mobile.review.saved"));
      navigate(isLinked ? `/receipts/${receipt.id}` : "/receipts");
    },
    onError: (err) => {
      haptics.error();
      const described = describeError(err, t);
      if (described.kind === "notFound") {
        toast.error(described.text);
        navigate("/receipts", { replace: true });
        return;
      }
      setError(described.text);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteReceipt({ api, receiptId: receipt.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      haptics.success();
      toast.success(t("mobile.receipts.deleted"));
      navigate("/receipts", { replace: true });
    },
    onError: (err) => {
      haptics.error();
      // 400 when a transaction still references it → the backend's own text.
      toast.error(describeError(err, t).text);
    },
  });

  const busy = book.isPending || save.isPending || remove.isPending;

  // ── Handlers ──
  const handleBook = () => {
    setError("");
    const key = validateBooking(formForApi());
    if (key) {
      haptics.warning();
      setError(t(key));
      if (key === "mobile.review.errors.selectCategory" && !useSplit) {
        setCategoryOpen(true);
      }
      return;
    }
    book.mutate();
  };

  const handleTypeChange = (next) => {
    if (next === type) return;
    haptics.tap();
    setType(next);
    // The category list is type-filtered — reset picks.
    setCategoryId("");
    setSplits((prev) => prev.map((s) => ({ ...s, categoryId: "" })));
  };

  const toggleSplit = () => {
    haptics.tap();
    if (!useSplit && splits.length === 0) {
      setSplits(seedSplitsFromLineItems(form.lineItems));
    }
    setUseSplit((v) => !v);
  };

  const handleDelete = async () => {
    const ok = await confirmDialog({
      message: t("mobile.review.deleteConfirm"),
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const handleLinked = () => {
    setLinkOpen(false);
    navigate(`/receipts/${receipt.id}`);
  };

  // ── Success state ──
  if (booked) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="flex-1 p-4">
          <PageHeader title={t("mobile.review.title")} />
          <Card className="fade-in text-center">
            <i
              className="ti ti-circle-check text-4xl text-income"
              aria-hidden="true"
            />
            <h2 className="mt-2 text-lg font-semibold text-ink">
              {t("mobile.review.book.booked")}
            </h2>
            <p className="mt-1 text-md text-muted">
              {t("mobile.review.book.bookedHint")}
            </p>
            <div className="mt-4 rounded-lg bg-canvas px-3.5 py-3 text-left">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-md font-medium text-ink">
                    {booked.merchant ||
                      form.merchant ||
                      t("receipts.unknownMerchant")}
                  </div>
                  <div className="text-xs text-muted">
                    {form.date || t("receipts.noDate")}
                  </div>
                </div>
                <div
                  className={cx(
                    "shrink-0 text-lg font-semibold",
                    type === "income" ? "text-income" : "text-ink",
                  )}
                >
                  {fmt(booked.total_amount ?? form.total)}
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-surface p-4">
          <Button
            variant="primary"
            size="lg"
            full
            icon="ti-scan"
            onClick={() => navigate("/scan")}
          >
            {t("mobile.common.scanAnother")}
          </Button>
          <Button
            size="lg"
            full
            icon="ti-receipt"
            onClick={() => navigate(`/receipts/${receipt.id}`)}
          >
            {t("mobile.common.viewReceipt")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Review form ──
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 p-4">
        <PageHeader
          title={t("mobile.review.title")}
          actions={
            <Badge tone={STATUS_TONES[receipt.status] || "neutral"}>
              {t(STATUS_KEYS[receipt.status] || "receipts.status.pending")}
            </Badge>
          }
        />

        {isImage(receipt) && (
          <img
            src={receipt.signed_url}
            alt={t("receipts.capturedAlt")}
            className="mb-4 max-h-40 w-full rounded-lg bg-sunken object-contain"
          />
        )}

        <ConfidenceBar value={receipt.ai_confidence} className="mb-4" />

        <Field label={t("mobile.review.merchant")} htmlFor="rv-merchant">
          <Input
            id="rv-merchant"
            value={form.merchant}
            onChange={(e) => patch({ merchant: e.target.value })}
            placeholder={t("receipts.merchantPlaceholder")}
            autoComplete="organization"
            disabled={busy}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("mobile.review.date")} htmlFor="rv-date">
            <Input
              id="rv-date"
              type="date"
              value={form.date}
              onChange={(e) => patch({ date: e.target.value })}
              disabled={busy}
            />
          </Field>
          <Field label={t("mobile.review.total")} htmlFor="rv-total">
            <Input
              id="rv-total"
              type="text"
              inputMode="decimal"
              value={form.total}
              onChange={(e) =>
                patch({ total: sanitizeAmountInput(e.target.value) })
              }
              placeholder="0.00"
              className="text-right"
              disabled={busy}
            />
          </Field>
        </div>

        <LineItemsEditor
          items={form.lineItems}
          onChange={(lineItems) => patch({ lineItems })}
          disabled={busy}
        />

        {isLinked ? (
          <Card
            padding="sm"
            className="mb-4 flex items-start gap-3 bg-brand-light border-0"
            role="note"
          >
            <i
              className="ti ti-link mt-px shrink-0 text-lg text-brand"
              aria-hidden="true"
            />
            <p className="text-md text-ink">
              {t("mobile.review.errors.alreadyLinked")}
            </p>
          </Card>
        ) : (
          <section className="mb-4" aria-labelledby="rv-book-title">
            <h2
              id="rv-book-title"
              className="mb-3 font-display text-base font-semibold text-ink"
            >
              {t("mobile.review.book.title")}
            </h2>

            <Field label={t("mobile.review.book.account")} htmlFor="rv-account">
              <AccountPicker
                id="rv-account"
                accounts={accounts}
                value={effectiveAccountId}
                onChange={setAccountId}
                fmt={fmt}
                disabled={busy}
              />
            </Field>

            <Field label={t("mobile.review.book.type")}>
              <div
                role="radiogroup"
                aria-label={t("mobile.review.book.type")}
                className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1"
              >
                {TYPES.map((opt) => {
                  const selected = opt.value === type;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => handleTypeChange(opt.value)}
                      className={cx(
                        "min-h-[44px] rounded-md text-md font-medium transition-colors",
                        selected ? opt.active : "text-secondary",
                      )}
                    >
                      {t(opt.key)}
                    </button>
                  );
                })}
              </div>
            </Field>

            {!useSplit && (
              <Field
                label={t("mobile.review.book.category")}
                htmlFor="rv-category"
              >
                <PickerTrigger
                  id="rv-category"
                  empty={!selectedCategory}
                  placeholder={t("mobile.review.book.selectCategory")}
                  onClick={() => setCategoryOpen(true)}
                  disabled={busy}
                >
                  {selectedCategory && (
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            selectedCategory.color || "var(--text-muted)",
                        }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{selectedCategory.name}</span>
                      {usingSuggestion && (
                        <Badge
                          tone="brand"
                          icon="ti-sparkles"
                          className="shrink-0"
                        >
                          {t("mobile.review.book.suggested")}
                        </Badge>
                      )}
                    </span>
                  )}
                </PickerTrigger>
              </Field>
            )}

            <div className="mb-4 flex min-h-[44px] items-center gap-3 rounded-lg bg-canvas px-3.5 py-2.5">
              <Toggle
                checked={useSplit}
                onChange={toggleSplit}
                aria-label={t("mobile.review.book.split")}
                disabled={busy}
              />
              <span className="text-md font-medium text-ink">
                {t("mobile.review.book.split")}
              </span>
            </div>

            {useSplit && (
              <div className="mb-4 rounded-lg bg-canvas px-3.5 py-3">
                <div className="text-xs font-medium text-secondary">
                  {t("transactions.splitBreakdown")}
                </div>
                <SplitEditor
                  splits={splits}
                  setSplits={setSplits}
                  totalAmount={form.total}
                  categories={categories}
                  fmt={fmt}
                  t={t}
                />
              </div>
            )}

            <Field label={t("mobile.review.book.notes")} htmlFor="rv-notes">
              <Textarea
                id="rv-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("mobile.review.book.notesPlaceholder")}
                rows={2}
                disabled={busy}
              />
            </Field>
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-danger bg-danger-bg px-3.5 py-2.5 text-md text-danger"
          >
            <i
              className="ti ti-alert-circle mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}

        {/* Secondary actions */}
        <div className="flex flex-col gap-2">
          {!isLinked && (
            <Button
              size="lg"
              full
              icon="ti-clock"
              onClick={() => {
                setError("");
                save.mutate();
              }}
              loading={save.isPending}
              disabled={busy}
            >
              {t("mobile.common.saveForLater")}
            </Button>
          )}
          <Button
            size="lg"
            full
            icon="ti-link"
            onClick={() => setLinkOpen(true)}
            disabled={busy || isLinked}
          >
            {t("mobile.common.linkExisting")}
          </Button>
          <Button
            variant="danger"
            size="lg"
            full
            icon="ti-trash"
            onClick={handleDelete}
            loading={remove.isPending}
            disabled={busy || isLinked}
          >
            {t("mobile.common.delete")}
          </Button>
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-0 border-t border-line bg-surface p-4">
        {isLinked ? (
          <Button
            variant="primary"
            size="lg"
            full
            icon="ti-device-floppy"
            onClick={() => {
              setError("");
              save.mutate();
            }}
            loading={save.isPending}
            disabled={busy}
          >
            {t("mobile.common.save")}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            full
            icon="ti-check"
            onClick={handleBook}
            loading={book.isPending}
            disabled={busy}
          >
            {t("mobile.common.bookTransaction")}
          </Button>
        )}
      </div>

      <CategoryPicker
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        categories={categories}
        value={effectiveCategoryId}
        suggestedId={suggestedCategory?.id}
        onChange={(category) => {
          haptics.tap();
          setCategoryId(category.id);
        }}
      />

      <LinkExistingSheet
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        receiptId={receipt.id}
        total={form.total}
        date={form.date}
        fmt={fmt}
        onLinked={handleLinked}
      />
    </div>
  );
}
