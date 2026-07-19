import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { confirmDialog } from "../store/feedbackStore";
import dayjs from "dayjs";
import Papa from "papaparse";
import cx from "../lib/cx";
import {
  Button,
  Card,
  Badge,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Toggle,
} from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// ECB-backed currencies supported by the Frankfurter rate API
const CURRENCIES = [
  "AUD",
  "BGN",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "ZAR",
];

const makeEmptyForm = (baseCurrency) => ({
  accountId: "",
  date: dayjs().format("YYYY-MM-DD"),
  merchant: "",
  totalAmount: "",
  type: "expense",
  notes: "",
  categoryId: "",
  vendorId: "",
  splits: [],
  currency: baseCurrency || "USD",
  originalAmount: "",
  exchangeRate: "1",
  withholdingAmount: "",
  projectId: "",
});

// Small chip used for split/auto-categorized/recurring/vendor markers.
function Chip({ tone = "neutral", icon, children, className }) {
  const tones = {
    neutral: "bg-canvas text-secondary",
    brand: "bg-brand-light text-brand",
    income: "bg-income-bg text-income",
    payroll: "bg-payroll-bg text-payroll",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center text-[10px] px-1.5 py-px rounded-sm",
        tones[tone],
        className,
      )}
    >
      {icon && <i className={cx("ti", icon, "text-[9px] mr-0.5")} aria-hidden="true" />}
      {children}
    </span>
  );
}

function SplitEditor({ splits, setSplits, totalAmount, categories, fmt, t }) {
  const remaining =
    parseFloat(totalAmount || 0) -
    splits.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

  const addSplit = () =>
    setSplits([...splits, { categoryId: "", amount: "", notes: "" }]);

  const updateSplit = (i, field, value) =>
    setSplits(
      splits.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    );

  const removeSplit = (i) => setSplits(splits.filter((_, idx) => idx !== i));

  return (
    <div className="mt-2">
      {splits.map((split, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_110px_auto] gap-2 mb-2 items-center"
        >
          <Select
            value={split.categoryId}
            onChange={(e) => updateSplit(i, "categoryId", e.target.value)}
          >
            <option value="">{t("transactions.selectCategory")}</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            placeholder="0.00"
            value={split.amount}
            onChange={(e) => updateSplit(i, "amount", e.target.value)}
            step="0.01"
            min="0"
          />
          <button
            type="button"
            onClick={() => removeSplit(i)}
            className="flex items-center justify-center w-[30px] h-[30px] rounded-md bg-danger-bg text-danger cursor-pointer"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between mt-2">
        <Button size="sm" icon="ti-plus" onClick={addSplit}>
          {t("transactions.addSplitLine")}
        </Button>
        <div
          className={cx(
            "text-xs font-medium",
            Math.abs(remaining) < 0.01 ? "text-income" : "text-expense",
          )}
        >
          {Math.abs(remaining) < 0.01
            ? t("transactions.splitsBalanced")
            : t("transactions.remaining", { amount: fmt(remaining) })}
        </div>
      </div>
    </div>
  );
}

function TransactionModal({
  onClose,
  accounts,
  ledgerAccounts,
  categories,
  vendors,
  projects,
  editTx,
  fmt,
  t,
  baseCurrency,
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => {
    if (editTx) {
      return {
        accountId: editTx.funding_coa_id
          ? `coa:${editTx.funding_coa_id}`
          : editTx.account_id
            ? `acct:${editTx.account_id}`
            : "",
        date: dayjs(editTx.date).format("YYYY-MM-DD"),
        merchant: editTx.merchant || "",
        totalAmount: String(editTx.total_amount),
        type: editTx.type,
        notes: editTx.notes || "",
        // Single-category txs no longer keep category_id on the header — the
        // category is the lone revenue/expense line in the ledger-derived splits.
        categoryId: (!editTx.is_split && editTx.splits?.[0]?.account_id) || "",
        vendorId: editTx.vendor_id || "",
        splits:
          editTx.splits?.map((s) => ({
            categoryId: s.account_id,
            amount: s.amount,
            notes: s.notes || "",
          })) || [],
        currency: editTx.original_currency || baseCurrency,
        originalAmount: String(editTx.original_amount || editTx.total_amount),
        exchangeRate: String(editTx.exchange_rate || 1),
        withholdingAmount: editTx.withholding_amount
          ? String(editTx.withholding_amount)
          : "",
        projectId: editTx.project_id || "",
      };
    }
    return makeEmptyForm(baseCurrency);
  });
  const [useSplit, setUseSplit] = useState(editTx ? editTx.is_split : false);
  const [useWithholding, setUseWithholding] = useState(
    editTx ? Number(editTx.withholding_amount) > 0 : false,
  );
  const [error, setError] = useState("");

  const isFx = form.currency && form.currency !== baseCurrency;
  const selectedVendor = vendors?.find((v) => v.id === form.vendorId);
  const showWithholding = form.type === "expense" && !!form.vendorId;
  const grossForWh = parseFloat(form.totalAmount || 0);
  const netToVendor = grossForWh - parseFloat(form.withholdingAmount || 0);

  // Auto-fetch the exchange rate for foreign-currency transactions. The
  // fetched rate fills the (still user-editable) exchangeRate field. The
  // fill and the reset-to-1 are adjusted during render behind prev-value
  // guards, not in an effect (react.dev/you-might-not-need-an-effect).
  const fxRate = useQuery({
    queryKey: ["fx-rate", form.currency, baseCurrency, form.date],
    queryFn: () =>
      api
        .get(
          `/fx-rates?base=${form.currency}&target=${baseCurrency}&date=${form.date}`,
        )
        .then((r) => r.data.rate),
    enabled: !!isFx && !!form.date,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
  const [ratePreset, setRatePreset] = useState(null);
  if (isFx && fxRate.data != null && ratePreset !== fxRate.data) {
    // A freshly fetched rate — fill it once, then leave manual edits alone.
    setRatePreset(fxRate.data);
    setForm((f) => ({ ...f, exchangeRate: String(fxRate.data) }));
  }
  if (!isFx && ratePreset !== null) setRatePreset(null);
  if (!isFx && form.exchangeRate !== "1") {
    setForm((f) => ({ ...f, exchangeRate: "1" }));
  }
  const fxLoading = isFx && fxRate.isFetching;
  const fxError = isFx && fxRate.isError;

  const mutation = useMutation({
    mutationFn: (data) =>
      editTx
        ? api.put(`/transactions/${editTx.id}`, data)
        : api.post("/transactions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("transactions.saveFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.accountId) return setError(t("transactions.errSelectAccount"));

    // For FX transactions, validate original amount; otherwise validate totalAmount
    if (isFx && !useSplit) {
      if (!form.originalAmount || parseFloat(form.originalAmount) <= 0)
        return setError(t("transactions.errValidAmount"));
    } else {
      if (!form.totalAmount || parseFloat(form.totalAmount) <= 0)
        return setError(t("transactions.errValidAmount"));
    }
    if (useSplit && form.splits.length === 0)
      return setError(t("transactions.errAddSplit"));

    const totalAmount =
      isFx && !useSplit
        ? parseFloat(form.originalAmount) * parseFloat(form.exchangeRate || 1)
        : parseFloat(form.totalAmount);

    // form.accountId is a prefixed value: "acct:<id>" (operational bank
    // account) or "coa:<id>" (asset/liability ledger account).
    const isLedgerFunded = form.accountId.startsWith("coa:");
    const fundingId = form.accountId.replace(/^(coa|acct):/, "");

    const payload = {
      ...(isLedgerFunded
        ? { fundingCoaId: fundingId }
        : { accountId: fundingId }),
      date: form.date,
      merchant: form.merchant || undefined,
      totalAmount,
      type: form.type,
      notes: form.notes || undefined,
      categoryId: !useSplit ? form.categoryId || undefined : undefined,
      vendorId: form.vendorId || undefined,
      projectId: form.projectId || undefined,
      splits: useSplit ? form.splits : [],
      withholdingAmount:
        form.type === "expense" && useWithholding
          ? parseFloat(form.withholdingAmount || 0)
          : 0,
    };

    if (isFx && !useSplit) {
      payload.originalCurrency = form.currency;
      payload.originalAmount = parseFloat(form.originalAmount);
      payload.exchangeRate = parseFloat(form.exchangeRate || 1);
    }

    mutation.mutate(payload);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editTx ? t("transactions.editTitle") : t("transactions.newTitle")}
    >
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2 mb-4">
          {["expense", "income"].map((txType) => (
            <button
              key={txType}
              type="button"
              onClick={() => setForm({ ...form, type: txType })}
              className={cx(
                "flex-1 py-2 rounded-lg border text-md font-medium cursor-pointer transition-colors",
                form.type === txType
                  ? txType === "income"
                    ? "border-income bg-income-bg text-income"
                    : "border-expense bg-expense-bg text-expense"
                  : "border-line bg-transparent text-muted",
              )}
            >
              <i
                className={`ti ${txType === "income" ? "ti-arrow-down-left" : "ti-arrow-up-right"} mr-1.5`}
                aria-hidden="true"
              />
              {t(`common.${txType}`)}
            </button>
          ))}
        </div>

        {/* Currency + Amount + Date */}
        <div
          className={cx(
            "grid grid-cols-[120px_1fr_1fr] gap-3",
            isFx ? "mb-2" : "mb-3.5",
          )}
        >
          <Field label={t("fx.currency")} htmlFor="currency" className="mb-0">
            <Select
              id="currency"
              value={form.currency}
              onChange={(e) =>
                setForm({
                  ...form,
                  currency: e.target.value,
                  originalAmount: "",
                })
              }
              disabled={useSplit}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={
              isFx
                ? t("fx.originalAmount", { currency: form.currency })
                : t("common.amount")
            }
            htmlFor="totalAmount"
            className="mb-0"
          >
            <Input
              id="totalAmount"
              type="number"
              placeholder="0.00"
              step="0.01"
              min="0"
              value={isFx ? form.originalAmount : form.totalAmount}
              onChange={(e) =>
                isFx
                  ? setForm({ ...form, originalAmount: e.target.value })
                  : setForm({ ...form, totalAmount: e.target.value })
              }
              required
            />
          </Field>
          <Field label={t("common.date")} htmlFor="date" className="mb-0">
            <Input
              id="date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
        </div>

        {/* Exchange rate row — only shown for foreign currencies */}
        {isFx && (
          <div className="grid grid-cols-2 gap-3 mb-3.5 px-3 py-2.5 bg-canvas rounded-lg">
            <div>
              <label
                className="block text-xs font-medium text-secondary mb-1"
                htmlFor="exchangeRate"
              >
                {t("fx.rateLabel", {
                  from: form.currency,
                  to: baseCurrency,
                })}
                {fxLoading && (
                  <span className="ml-1.5 text-[10px] text-muted">
                    {t("fx.autoFetching")}
                  </span>
                )}
              </label>
              <Input
                id="exchangeRate"
                type="number"
                placeholder="1.000000"
                step="0.000001"
                min="0.000001"
                value={form.exchangeRate}
                onChange={(e) =>
                  setForm({ ...form, exchangeRate: e.target.value })
                }
              />
              {fxError && (
                <div className="text-[11px] text-muted mt-1">
                  {t("fx.fetchError")}
                </div>
              )}
            </div>
            <div className="flex flex-col justify-end">
              <div className="text-xs text-muted mb-1">
                {t("fx.convertedTotal", { base: baseCurrency })}
              </div>
              <div className="text-[15px] font-semibold text-ink">
                {fmt(
                  parseFloat(form.originalAmount || 0) *
                    parseFloat(form.exchangeRate || 1),
                  baseCurrency,
                )}
              </div>
            </div>
          </div>
        )}

        <Field
          label={t("transactions.vendor")}
          htmlFor="vendorId"
          className="mb-3.5"
        >
          <Select
            id="vendorId"
            value={form.vendorId}
            onChange={(e) => {
              const vid = e.target.value;
              const vendor = vendors?.find((v) => v.id === vid);
              setForm({
                ...form,
                vendorId: vid,
                merchant:
                  vendor && !form.merchant ? vendor.name : form.merchant,
              });
            }}
          >
            <option value="">{t("transactions.selectVendor")}</option>
            {vendors?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_1099_eligible ? " · 1099" : ""}
              </option>
            ))}
          </Select>
        </Field>

        {projects?.length > 0 && (
          <Field
            label={t("transactions.project")}
            htmlFor="projectId"
            className="mb-3.5"
          >
            <Select
              id="projectId"
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">{t("transactions.selectProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label={t("transactions.merchantDescription")}
          htmlFor="merchant"
          className="mb-3.5"
        >
          <Input
            id="merchant"
            type="text"
            placeholder={t("transactions.merchantPlaceholder")}
            value={form.merchant}
            onChange={(e) => setForm({ ...form, merchant: e.target.value })}
          />
        </Field>

        <Field
          label={t("common.account")}
          htmlFor="accountId"
          className="mb-3.5"
        >
          <Select
            id="accountId"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            required
          >
            <option value="">{t("transactions.selectAccount")}</option>
            {accounts?.length > 0 && (
              <optgroup label={t("transactions.bankAccounts")}>
                {accounts.map((a) => (
                  <option key={a.id} value={`acct:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {ledgerAccounts?.length > 0 && (
              <optgroup label={t("transactions.ledgerAccounts")}>
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={`coa:${a.id}`}>
                    {a.code ? `${a.code} · ${a.name}` : a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        {/* Category — only show when not splitting */}
        {!useSplit && (
          <Field
            label={t("common.category")}
            htmlFor="categoryId"
            className="mb-3.5"
          >
            <Select
              id="categoryId"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">{t("transactions.selectACategory")}</option>
              {categories
                ?.filter((c) => c.type === form.type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}

        {/* §1062.03 service withholding — expense payments to a vendor */}
        {showWithholding && (
          <div className="mb-3.5 px-3.5 py-2.5 bg-canvas rounded-lg">
            <div className="flex items-center gap-2.5">
              <Toggle
                checked={useWithholding}
                onChange={() => {
                  const next = !useWithholding;
                  setUseWithholding(next);
                  if (next && !form.withholdingAmount) {
                    setForm((f) => ({
                      ...f,
                      withholdingAmount: (
                        parseFloat(f.totalAmount || 0) * 0.1
                      ).toFixed(2),
                    }));
                  }
                }}
                aria-label={t("transactions.withholdingToggle")}
              />
              <div>
                <div className="text-md font-medium text-ink">
                  {t("transactions.withholdingToggle")}
                </div>
                <div className="text-[11px] text-muted">
                  {selectedVendor?.withholding_exempt
                    ? t("transactions.withholdingWaiverOnFile")
                    : t("transactions.withholdingHint")}
                </div>
              </div>
            </div>

            {useWithholding && (
              <div className="grid grid-cols-2 gap-3 mt-2.5 items-end">
                <Field
                  label={t("transactions.withholdingAmount")}
                  htmlFor="withholdingAmount"
                  className="mb-0"
                >
                  <Input
                    id="withholdingAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.withholdingAmount}
                    onChange={(e) =>
                      setForm({ ...form, withholdingAmount: e.target.value })
                    }
                  />
                </Field>
                <div className="text-xs text-muted">
                  {t("transactions.netToVendor")}
                  <div className="text-[15px] font-semibold text-ink">
                    {fmt(netToVendor > 0 ? netToVendor : 0, baseCurrency)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label={t("common.notes")} htmlFor="notes" className="mb-3.5">
          <Input
            id="notes"
            type="text"
            placeholder={t("transactions.notesPlaceholder")}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <div
          className={cx(
            "flex items-center gap-2.5 px-3.5 py-2.5 bg-canvas rounded-lg",
            useSplit ? "mb-3" : "mb-5",
          )}
        >
          <Toggle
            checked={useSplit}
            onChange={() => setUseSplit(!useSplit)}
            aria-label={t("transactions.toggleSplit")}
          />
          <div>
            <div className="text-md font-medium text-ink">
              {t("transactions.splitTransaction")}
            </div>
            <div className="text-[11px] text-muted">
              {t("transactions.splitDescription")}
            </div>
          </div>
        </div>

        {useSplit && (
          <div className="mb-4 px-3.5 py-3 bg-canvas rounded-lg">
            <div className="text-xs font-medium text-secondary mb-2">
              {t("transactions.splitBreakdown")}
            </div>
            <SplitEditor
              splits={form.splits}
              setSplits={(splits) => setForm({ ...form, splits })}
              totalAmount={form.totalAmount}
              categories={categories}
              fmt={fmt}
              t={t}
            />
            {useSplit && isFx && (
              <div className="text-[11px] text-muted mt-1">
                {t("fx.splitFxWarning")}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? t("transactions.saving")
              : editTx
                ? t("transactions.saveChanges")
                : t("transactions.addTransaction")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── CSV import helpers ───────────────────────────────────────
// Normalize a bank date cell to YYYY-MM-DD. Handles ISO already, US
// MM/DD/YYYY, and falls back to dayjs parsing. The preview lets the user catch
// any misread before importing.
function normalizeDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}
// Parse a bank amount cell: strips $/commas, treats (123.45) as negative.
function parseAmount(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.-]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}
function guessColumn(fields, re) {
  return fields.find((f) => re.test(f)) || "";
}

// One column-mapping dropdown (module-scope so it isn't recreated per render).
function MappingCol({ k, label, fields, mapping, setMapping, t }) {
  return (
    <Field label={label} className="mb-0">
      <Select
        value={mapping[k]}
        onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}
      >
        <option value="">{t("transactions.importUnmapped")}</option>
        {fields.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ImportModal({ onClose, accounts, ledgerAccounts, fmt, t }) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fields, setFields] = useState([]);
  const [data, setData] = useState([]);
  const [mapping, setMapping] = useState({
    date: "",
    description: "",
    amount: "",
  });
  const [negate, setNegate] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const f = (res.meta.fields || []).filter(Boolean);
        setFields(f);
        setData(res.data || []);
        setMapping({
          date: guessColumn(f, /date|fecha/i),
          description: guessColumn(
            f,
            /desc|memo|narration|payee|concept|merchant|name/i,
          ),
          amount: guessColumn(f, /amount|amt|debit|monto|importe|value/i),
        });
      },
      error: () => setError(t("transactions.importParseError")),
    });
  };

  const buildRows = () =>
    data
      .map((r) => ({
        date: normalizeDate(r[mapping.date]),
        merchant: (r[mapping.description] ?? "").toString().trim(),
        amount: (negate ? -1 : 1) * parseAmount(r[mapping.amount]),
      }))
      .filter((r) => r.date && Number.isFinite(r.amount) && r.amount !== 0);

  const mapped = mapping.date && mapping.amount && data.length > 0;
  const rows = mapped ? buildRows() : [];
  const preview = rows.slice(0, 8);

  const importMutation = useMutation({
    mutationFn: () => {
      const isLedger = accountId.startsWith("coa:");
      const fundingId = accountId.replace(/^(coa|acct):/, "");
      return api
        .post("/transactions/import", {
          ...(isLedger
            ? { fundingCoaId: fundingId }
            : { accountId: fundingId }),
          rows: buildRows(),
          skipDuplicates,
        })
        .then((r) => r.data);
    },
    onSuccess: (res) => {
      setResult(res);
      ["transactions", "summary", "balances", "accounts"].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("transactions.importFailed")),
  });

  const canImport =
    accountId && mapped && rows.length > 0 && !importMutation.isPending;

  return (
    <Modal open onClose={onClose} title={t("transactions.importTitle")} size="lg">
      {result ? (
        <div className="text-center py-5">
          <i
            className="ti ti-circle-check text-[40px] text-income"
            aria-hidden="true"
          />
          <div className="text-[15px] font-semibold mt-3 mb-1.5 text-ink">
            {t("transactions.importResult", {
              imported: result.imported,
              skipped: result.skipped,
            })}
          </div>
          <Button variant="primary" className="mt-3" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      ) : (
        <>
          {error && (
            <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-3.5">
              <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
              {error}
            </div>
          )}

          {/* Account */}
          <Field label={t("transactions.importAccount")} className="mb-3.5">
            <Select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">{t("transactions.selectAccount")}</option>
              {accounts?.length > 0 && (
                <optgroup label={t("transactions.bankAccounts")}>
                  {accounts.map((a) => (
                    <option key={a.id} value={`acct:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {ledgerAccounts?.length > 0 && (
                <optgroup label={t("transactions.ledgerAccounts")}>
                  {ledgerAccounts.map((a) => (
                    <option key={a.id} value={`coa:${a.id}`}>
                      {a.code ? `${a.code} · ${a.name}` : a.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>

          {/* File */}
          <Field
            label={t("transactions.importFile")}
            hint={
              fileName
                ? `${fileName} · ${t("transactions.importParsedRows", { count: data.length })}`
                : undefined
            }
            className="mb-3.5"
          >
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="p-1.5"
            />
          </Field>

          {fields.length > 0 && (
            <>
              <div className="text-xs font-semibold text-muted uppercase tracking-[0.5px] mb-2">
                {t("transactions.mapColumns")}
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <MappingCol
                  k="date"
                  label={t("transactions.colDate")}
                  fields={fields}
                  mapping={mapping}
                  setMapping={setMapping}
                  t={t}
                />
                <MappingCol
                  k="description"
                  label={t("transactions.colDescription")}
                  fields={fields}
                  mapping={mapping}
                  setMapping={setMapping}
                  t={t}
                />
                <MappingCol
                  k="amount"
                  label={t("transactions.colAmount")}
                  fields={fields}
                  mapping={mapping}
                  setMapping={setMapping}
                  t={t}
                />
              </div>

              <div className="flex gap-4 mb-3.5 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={negate}
                    onChange={(e) => setNegate(e.target.checked)}
                  />
                  {t("transactions.negateAmounts")}
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                  />
                  {t("transactions.skipDuplicates")}
                </label>
              </div>

              {mapped && (
                <Card padding="none" className="overflow-hidden mb-3.5">
                  <div className="grid grid-cols-[90px_1fr_90px_70px] px-3 py-2 bg-canvas text-[10px] text-muted font-semibold tracking-[0.5px]">
                    <div>{t("common.date")}</div>
                    <div>{t("common.merchant")}</div>
                    <div className="text-right">{t("common.amount")}</div>
                    <div className="text-right">{t("common.type")}</div>
                  </div>
                  {preview.map((r, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[90px_1fr_90px_70px] px-3 py-[7px] border-t border-line text-xs items-center"
                    >
                      <div className="text-muted">{r.date}</div>
                      <div className="truncate">{r.merchant || "—"}</div>
                      <div
                        className={cx(
                          "text-right",
                          r.amount < 0 ? "text-expense" : "text-income",
                        )}
                      >
                        {fmt(r.amount)}
                      </div>
                      <div className="text-right text-[10px] text-muted">
                        {r.amount < 0 ? t("common.expense") : t("common.income")}
                      </div>
                    </div>
                  ))}
                  <div className="px-3 py-[7px] border-t border-line text-[11px] text-muted">
                    {t("transactions.importWillImport", { count: rows.length })}
                  </div>
                </Card>
              )}
            </>
          )}

          <div className="flex gap-2 justify-end">
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={!canImport}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending
                ? t("transactions.importing")
                : t("transactions.runImport")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function Transactions() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const queryClient = useQueryClient();
  const currency = business?.currency || "USD";
  const fmt = makeFmt(i18n.language);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTx, setEditTx] = useState(null);

  // Global quick-add: /transactions?new=<nonce> opens the add-transaction
  // modal. State is synced during render (guarded by a change check) rather
  // than in an effect, per react.dev/learn/you-might-not-need-an-effect.
  const [searchParams, setSearchParams] = useSearchParams();
  const newParam = searchParams.get("new") || "";
  const [appliedNewParam, setAppliedNewParam] = useState("");
  if (newParam !== appliedNewParam) {
    setAppliedNewParam(newParam);
    if (newParam) setShowModal(true);
  }
  const [filters, setFilters] = useState({
    type: "",
    startDate: "",
    endDate: "",
    categoryId: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => {
      const params = new URLSearchParams({ limit: 50 });
      if (filters.type) params.append("type", filters.type);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);
      if (filters.categoryId) params.append("categoryId", filters.categoryId);
      return api.get(`/transactions?${params}`).then((r) => r.data);
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });
  // "Categories" now come from the chart of accounts. Flatten revenue +
  // expense accounts (and any sub-accounts) into the shape the form, filter,
  // and split editor already expect: { id, name, type, color }.
  const { data: coaGroups } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const categories = useMemo(() => {
    if (!coaGroups) return [];
    const out = [];
    const walk = (acc, type) => {
      out.push({
        id: acc.id,
        name: acc.name_key ? t(acc.name_key) : acc.name,
        type,
        color: acc.color,
      });
      acc.children?.forEach((c) => walk(c, type));
    };
    for (const g of coaGroups) {
      if (g.account_type === "revenue")
        g.accounts.forEach((a) => walk(a, "income"));
      else if (g.account_type === "expense")
        g.accounts.forEach((a) => walk(a, "expense"));
    }
    return out;
  }, [coaGroups, t]);

  // Asset & liability ledger accounts that can fund a transaction, alongside
  // operational bank accounts. Exclude the COA "twin" of each operational
  // account — that's already represented by the bank account itself.
  const ledgerAccounts = useMemo(() => {
    if (!coaGroups) return [];
    const twinIds = new Set(
      (accounts || []).map((a) => a.coa_account_id).filter(Boolean),
    );
    const out = [];
    const walk = (acc) => {
      if (!twinIds.has(acc.id))
        out.push({
          id: acc.id,
          name: acc.name_key ? t(acc.name_key) : acc.name,
          code: acc.code,
        });
      acc.children?.forEach(walk);
    };
    for (const g of coaGroups) {
      if (g.account_type === "asset" || g.account_type === "liability")
        g.accounts.forEach(walk);
    }
    return out;
  }, [coaGroups, accounts, t]);
  const { data: vendors } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => api.get("/vendors").then((r) => r.data),
  });
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data),
  });

  // A non-split transaction's category is the single revenue/expense line.
  const catName = (tx) => {
    const s = tx.splits?.[0];
    return s ? (s.name_key ? t(s.name_key) : s.name) : null;
  };
  // Funding account label — ledger accounts carry a name_key (i18n);
  // operational accounts carry a plain name.
  const acctName = (tx) =>
    tx.account_name_key ? t(tx.account_name_key) : tx.account_name;

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/transactions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const handleClose = () => {
    setShowModal(false);
    setEditTx(null);
    if (searchParams.get("new")) setSearchParams({}, { replace: true });
  };

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (filters.type) params.append("type", filters.type);
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.categoryId) params.append("categoryId", filters.categoryId);
    const res = await api.get(`/transactions/export?${params}`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${dayjs().format("YYYY-MM-DD")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const transactions = data?.transactions || [];

  // Chips shown after the merchant name on both layouts.
  const txChips = (tx) => (
    <>
      {tx.is_split && (
        <Chip tone="payroll" className="ml-1.5">
          {t("transactions.split")}
        </Chip>
      )}
      {!tx.is_split && tx.applied_rule_id && (
        <Chip tone="income" className="ml-1.5">
          {t("transactions.autoCategorized")}
        </Chip>
      )}
      {tx.recurring_id && (
        <Chip tone="neutral" icon="ti-repeat" className="ml-1.5">
          {t("transactions.recurring")}
        </Chip>
      )}
    </>
  );

  const emptyState = (
    <EmptyState
      icon="ti-receipt-off"
      message={t("transactions.noneFound")}
      action={
        <Button variant="primary" onClick={() => setShowModal(true)}>
          {t("transactions.addFirst")}
        </Button>
      }
    />
  );

  const loadingState = (
    <div className="p-8 text-center text-muted">{t("common.loading")}</div>
  );

  return (
    <div className="fade-in">
      <PageHeader
        title={t("transactions.title")}
        subtitle={t("transactions.totalCount", { count: data?.total || 0 })}
        actions={
          <>
            <Button
              icon="ti-download"
              onClick={handleExport}
              title={t("transactions.export")}
            >
              <span className="hidden sm:inline">
                {t("transactions.export")}
              </span>
            </Button>
            <Button
              icon="ti-upload"
              onClick={() => setShowImport(true)}
              title={t("transactions.import")}
            >
              <span className="hidden sm:inline">
                {t("transactions.import")}
              </span>
            </Button>
            <Button
              variant="primary"
              icon="ti-plus"
              onClick={() => setShowModal(true)}
              title={t("transactions.addTransaction")}
            >
              <span className="hidden sm:inline">
                {t("transactions.addTransaction")}
              </span>
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card padding="none" className="px-4 py-3 mb-4 flex gap-2 flex-wrap items-center">
        <Select
          className="w-full md:w-[140px]"
          value={filters.type}
          onChange={(e) =>
            setFilters({ ...filters, type: e.target.value, categoryId: "" })
          }
        >
          <option value="">{t("transactions.allTypes")}</option>
          <option value="income">{t("common.income")}</option>
          <option value="expense">{t("common.expense")}</option>
        </Select>

        <Select
          className="hidden md:block w-[160px]"
          value={filters.categoryId || ""}
          onChange={(e) =>
            setFilters({ ...filters, categoryId: e.target.value })
          }
        >
          <option value="">{t("transactions.allCategories")}</option>
          {categories
            ?.filter((c) => !filters.type || c.type === filters.type)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
        <Input
          className="hidden md:block w-[160px]"
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
        />
        <Input
          className="hidden md:block w-[160px]"
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
        />
        {(filters.type ||
          filters.startDate ||
          filters.endDate ||
          filters.categoryId) && (
          <Button
            size="sm"
            icon="ti-x"
            onClick={() =>
              setFilters({
                type: "",
                startDate: "",
                endDate: "",
                categoryId: "",
              })
            }
          >
            {t("transactions.clear")}
          </Button>
        )}
      </Card>

      {/* ── DESKTOP: Table layout ── */}
      <Card padding="none" className="hidden md:block overflow-hidden">
        <div className="grid grid-cols-[100px_1fr_120px_110px_90px_70px] px-[18px] py-2.5 border-b border-line bg-canvas">
          {[
            t("common.date"),
            t("common.merchant"),
            t("common.account"),
            t("common.amount"),
            t("common.type"),
            "",
          ].map((h, idx) => (
            <div
              key={idx}
              className="text-[11px] text-muted font-medium tracking-[0.5px]"
            >
              {h}
            </div>
          ))}
        </div>
        {isLoading ? (
          loadingState
        ) : transactions.length === 0 ? (
          emptyState
        ) : (
          transactions.map((tx) => (
            <div
              key={tx.id}
              className="grid grid-cols-[100px_1fr_120px_110px_90px_70px] px-[18px] py-[var(--row-y)] border-b border-line items-center transition-colors hover:bg-canvas"
            >
              <div className="text-xs text-muted">
                {dayjs(tx.date).format("MMM D, YYYY")}
              </div>
              <div>
                <div className="text-md font-medium text-ink">
                  {tx.merchant || "—"}
                  {catName(tx) && (
                    <div className="text-[11px] text-muted mt-px">
                      {catName(tx)}
                    </div>
                  )}
                  {tx.vendor_name && (
                    <div className="mt-0.5">
                      <Chip tone="brand">{tx.vendor_name}</Chip>
                    </div>
                  )}
                  {txChips(tx)}
                </div>
                {tx.notes && (
                  <div className="text-[11px] text-muted mt-px">{tx.notes}</div>
                )}
              </div>
              <div className="text-xs text-secondary">{acctName(tx)}</div>
              <div
                className={cx(
                  "text-md font-semibold",
                  tx.type === "income" ? "text-income" : "text-expense",
                )}
              >
                {tx.type === "income" ? "+" : "-"}
                {fmt(tx.total_amount, currency)}
                {tx.original_currency && tx.original_currency !== currency && (
                  <div className="text-[10px] text-muted font-normal mt-0.5">
                    {fmt(tx.original_amount, tx.original_currency)}
                  </div>
                )}
              </div>
              <div>
                <Badge tone={tx.type}>{t(`common.${tx.type}`)}</Badge>
              </div>
              <div className="flex gap-1.5 justify-end">
                <button
                  onClick={() => {
                    setEditTx(tx);
                    setShowModal(true);
                  }}
                  className="p-1 text-muted hover:text-ink cursor-pointer"
                  title={t("common.edit")}
                >
                  <i className="ti ti-pencil text-[15px]" aria-hidden="true" />
                </button>
                <button
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        message: t("transactions.confirmDelete"),
                        danger: true,
                      })
                    )
                      deleteMutation.mutate(tx.id);
                  }}
                  className="p-1 text-danger cursor-pointer"
                  title={t("common.delete")}
                >
                  <i className="ti ti-trash text-[15px]" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      {/* ── MOBILE: Card layout ── */}
      <div className="md:hidden">
        {isLoading ? (
          loadingState
        ) : transactions.length === 0 ? (
          <Card>{emptyState}</Card>
        ) : (
          <div className="flex flex-col gap-2">
            {transactions.map((tx) => (
              <Card key={tx.id} padding="none" className="px-4 py-3.5">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div
                      className={cx(
                        "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
                        tx.type === "income" ? "bg-income-bg" : "bg-expense-bg",
                      )}
                    >
                      <i
                        className={cx(
                          "ti text-base",
                          tx.type === "income"
                            ? "ti-arrow-down-left text-income"
                            : "ti-arrow-up-right text-expense",
                        )}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {tx.merchant || t("dashboard.noMerchant")}
                        {txChips(tx)}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {dayjs(tx.date).format("MMM D, YYYY")} · {acctName(tx)}
                        {catName(tx) && ` · ${catName(tx)}`}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 ml-2 text-right">
                    <div
                      className={cx(
                        "text-[15px] font-semibold",
                        tx.type === "income" ? "text-income" : "text-expense",
                      )}
                    >
                      {tx.type === "income" ? "+" : "-"}
                      {fmt(tx.total_amount, currency)}
                    </div>
                    {tx.original_currency &&
                      tx.original_currency !== currency && (
                        <div className="text-[10px] text-muted mt-px">
                          {fmt(tx.original_amount, tx.original_currency)}
                        </div>
                      )}
                  </div>
                </div>
                {tx.notes && (
                  <div className="text-xs text-muted mb-2 pl-[46px]">
                    {tx.notes}
                  </div>
                )}
                <div className="flex justify-between items-center pl-[46px]">
                  <Badge tone={tx.type}>{t(`common.${tx.type}`)}</Badge>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setEditTx(tx);
                        setShowModal(true);
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-md text-muted cursor-pointer"
                    >
                      <i className="ti ti-pencil" aria-hidden="true" />{" "}
                      {t("common.edit")}
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            message: t("transactions.confirmDelete"),
                            danger: true,
                          })
                        )
                          deleteMutation.mutate(tx.id);
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-md text-danger cursor-pointer"
                    >
                      <i className="ti ti-trash" aria-hidden="true" />{" "}
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <TransactionModal
          onClose={handleClose}
          accounts={accounts}
          ledgerAccounts={ledgerAccounts}
          categories={categories}
          vendors={vendors}
          projects={projects}
          editTx={editTx}
          fmt={fmt}
          t={t}
          baseCurrency={currency}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          accounts={accounts}
          ledgerAccounts={ledgerAccounts}
          fmt={fmt}
          t={t}
        />
      )}
    </div>
  );
}
