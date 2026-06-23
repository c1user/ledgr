import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";
import Papa from "papaparse";

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
    <div style={{ marginTop: 8 }}>
      {splits.map((split, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 110px auto",
            gap: 8,
            marginBottom: 8,
            alignItems: "center",
          }}
        >
          <select
            className="input"
            value={split.categoryId}
            onChange={(e) => updateSplit(i, "categoryId", e.target.value)}
          >
            <option value="">{t("transactions.selectCategory")}</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="input"
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
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "none",
              borderRadius: 6,
              width: 30,
              height: 30,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <button
          type="button"
          onClick={addSplit}
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "5px 10px" }}
        >
          <i className="ti ti-plus" aria-hidden="true" />{" "}
          {t("transactions.addSplitLine")}
        </button>
        <div
          style={{
            fontSize: 12,
            color:
              Math.abs(remaining) < 0.01 ? "var(--income)" : "var(--expense)",
            fontWeight: 500,
          }}
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
  const [rateStatus, setRateStatus] = useState("idle"); // "idle" | "loading" | "error"

  const isFx = form.currency && form.currency !== baseCurrency;
  const selectedVendor = vendors?.find((v) => v.id === form.vendorId);
  const showWithholding = form.type === "expense" && !!form.vendorId;
  const grossForWh = parseFloat(form.totalAmount || 0);
  const netToVendor = grossForWh - parseFloat(form.withholdingAmount || 0);

  // Auto-fetch exchange rate when the currency or date changes
  useEffect(() => {
    if (!isFx) {
      setForm((f) => ({ ...f, exchangeRate: "1" }));
      setRateStatus("idle");
      return;
    }
    setRateStatus("loading");
    api
      .get(
        `/fx-rates?base=${form.currency}&target=${baseCurrency}&date=${form.date}`,
      )
      .then((r) => {
        setForm((f) => ({ ...f, exchangeRate: String(r.data.rate) }));
        setRateStatus("idle");
      })
      .catch(() => setRateStatus("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.currency, form.date, baseCurrency]);

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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {editTx ? t("transactions.editTitle") : t("transactions.newTitle")}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 20,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "0.5px solid var(--danger)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i
              className="ti ti-alert-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {["expense", "income"].map((txType) => (
              <button
                key={txType}
                type="button"
                onClick={() => setForm({ ...form, type: txType })}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 8,
                  border: "0.5px solid",
                  borderColor:
                    form.type === txType
                      ? txType === "income"
                        ? "var(--income)"
                        : "var(--expense)"
                      : "var(--border-color)",
                  background:
                    form.type === txType
                      ? txType === "income"
                        ? "var(--income-bg)"
                        : "var(--expense-bg)"
                      : "transparent",
                  color:
                    form.type === txType
                      ? txType === "income"
                        ? "var(--income)"
                        : "var(--expense)"
                      : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <i
                  className={`ti ${txType === "income" ? "ti-arrow-down-left" : "ti-arrow-up-right"}`}
                  style={{ marginRight: 6 }}
                  aria-hidden="true"
                />
                {t(`common.${txType}`)}
              </button>
            ))}
          </div>

          {/* Currency + Amount + Date */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 1fr",
              gap: 12,
              marginBottom: isFx ? 8 : 14,
            }}
          >
            <div>
              <label className="label" htmlFor="currency">
                {t("fx.currency")}
              </label>
              <select
                id="currency"
                className="input"
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
              </select>
            </div>
            <div>
              <label className="label" htmlFor="totalAmount">
                {isFx
                  ? t("fx.originalAmount", { currency: form.currency })
                  : t("common.amount")}
              </label>
              <input
                id="totalAmount"
                className="input"
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
            </div>
            <div>
              <label className="label" htmlFor="date">
                {t("common.date")}
              </label>
              <input
                id="date"
                className="input"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Exchange rate row — only shown for foreign currencies */}
          {isFx && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 14,
                padding: "10px 12px",
                background: "var(--bg-secondary)",
                borderRadius: 8,
              }}
            >
              <div>
                <label className="label" htmlFor="exchangeRate">
                  {t("fx.rateLabel", {
                    from: form.currency,
                    to: baseCurrency,
                  })}
                  {rateStatus === "loading" && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("fx.autoFetching")}
                    </span>
                  )}
                </label>
                <input
                  id="exchangeRate"
                  className="input"
                  type="number"
                  placeholder="1.000000"
                  step="0.000001"
                  min="0.000001"
                  value={form.exchangeRate}
                  onChange={(e) =>
                    setForm({ ...form, exchangeRate: e.target.value })
                  }
                />
                {rateStatus === "error" && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 3,
                    }}
                  >
                    {t("fx.fetchError")}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  {t("fx.convertedTotal", { base: baseCurrency })}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {fmt(
                    parseFloat(form.originalAmount || 0) *
                      parseFloat(form.exchangeRate || 1),
                    baseCurrency,
                  )}
                </div>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="vendorId">
              {t("transactions.vendor")}
            </label>
            <select
              id="vendorId"
              className="input"
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
            </select>
          </div>

          {projects?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label className="label" htmlFor="projectId">
                {t("transactions.project")}
              </label>
              <select
                id="projectId"
                className="input"
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              >
                <option value="">{t("transactions.selectProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="merchant">
              {t("transactions.merchantDescription")}
            </label>
            <input
              id="merchant"
              className="input"
              type="text"
              placeholder={t("transactions.merchantPlaceholder")}
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="accountId">
              {t("common.account")}
            </label>
            <select
              id="accountId"
              className="input"
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
            </select>
          </div>

          {/* Category — only show when not splitting */}
          {!useSplit && (
            <div style={{ marginBottom: 14 }}>
              <label className="label" htmlFor="categoryId">
                {t("common.category")}
              </label>
              <select
                id="categoryId"
                className="input"
                value={form.categoryId}
                onChange={(e) =>
                  setForm({ ...form, categoryId: e.target.value })
                }
              >
                <option value="">{t("transactions.selectACategory")}</option>
                {categories
                  ?.filter((c) => c.type === form.type)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* §1062.03 service withholding — expense payments to a vendor */}
          {showWithholding && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 14px",
                background: "var(--bg-secondary)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
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
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: useWithholding
                      ? "var(--brand)"
                      : "var(--border-color)",
                    border: "none",
                    cursor: "pointer",
                    position: "relative",
                    flexShrink: 0,
                    transition: "background 0.2s",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 3,
                      left: useWithholding ? 18 : 3,
                      width: 14,
                      height: 14,
                      background: "#fff",
                      borderRadius: "50%",
                      transition: "left 0.2s",
                    }}
                  />
                </button>
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {t("transactions.withholdingToggle")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {selectedVendor?.withholding_exempt
                      ? t("transactions.withholdingWaiverOnFile")
                      : t("transactions.withholdingHint")}
                  </div>
                </div>
              </div>

              {useWithholding && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginTop: 10,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label className="label" htmlFor="withholdingAmount">
                      {t("transactions.withholdingAmount")}
                    </label>
                    <input
                      id="withholdingAmount"
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.withholdingAmount}
                      onChange={(e) =>
                        setForm({ ...form, withholdingAmount: e.target.value })
                      }
                    />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("transactions.netToVendor")}
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {fmt(netToVendor > 0 ? netToVendor : 0, baseCurrency)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="notes">
              {t("common.notes")}
            </label>
            <input
              id="notes"
              className="input"
              type="text"
              placeholder={t("transactions.notesPlaceholder")}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: useSplit ? 12 : 20,
              padding: "10px 14px",
              background: "var(--bg-secondary)",
              borderRadius: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setUseSplit(!useSplit)}
              aria-label={t("transactions.toggleSplit")}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: useSplit ? "var(--brand)" : "var(--border-color)",
                border: "none",
                cursor: "pointer",
                position: "relative",
                flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 3,
                  left: useSplit ? 18 : 3,
                  width: 14,
                  height: 14,
                  background: "#fff",
                  borderRadius: "50%",
                  transition: "left 0.2s",
                }}
              />
            </button>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                {t("transactions.splitTransaction")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t("transactions.splitDescription")}
              </div>
            </div>
          </div>

          {useSplit && (
            <div
              style={{
                marginBottom: 16,
                padding: "12px 14px",
                background: "var(--bg-secondary)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                }}
              >
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
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                  }}
                >
                  {t("fx.splitFxWarning")}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t("transactions.saving")
                : editTx
                  ? t("transactions.saveChanges")
                  : t("transactions.addTransaction")}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={mapping[k]}
        onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })}
      >
        <option value="">{t("transactions.importUnmapped")}</option>
        {fields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </div>
  );
}

function ImportModal({ onClose, accounts, ledgerAccounts, fmt, t }) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fields, setFields] = useState([]);
  const [data, setData] = useState([]);
  const [mapping, setMapping] = useState({ date: "", description: "", amount: "" });
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
          description: guessColumn(f, /desc|memo|narration|payee|concept|merchant|name/i),
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
          ...(isLedger ? { fundingCoaId: fundingId } : { accountId: fundingId }),
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card fade-in"
        style={{ width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", padding: 24 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            {t("transactions.importTitle")}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20 }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {result ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <i className="ti ti-circle-check" style={{ fontSize: 40, color: "var(--income)" }} aria-hidden="true" />
            <div style={{ fontSize: 15, fontWeight: 600, margin: "12px 0 6px" }}>
              {t("transactions.importResult", { imported: result.imported, skipped: result.skipped })}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "0.5px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
                <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
                {error}
              </div>
            )}

            {/* Account */}
            <div style={{ marginBottom: 14 }}>
              <label className="label">{t("transactions.importAccount")}</label>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">{t("transactions.selectAccount")}</option>
                {accounts?.length > 0 && (
                  <optgroup label={t("transactions.bankAccounts")}>
                    {accounts.map((a) => <option key={a.id} value={`acct:${a.id}`}>{a.name}</option>)}
                  </optgroup>
                )}
                {ledgerAccounts?.length > 0 && (
                  <optgroup label={t("transactions.ledgerAccounts")}>
                    {ledgerAccounts.map((a) => (
                      <option key={a.id} value={`coa:${a.id}`}>{a.code ? `${a.code} · ${a.name}` : a.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* File */}
            <div style={{ marginBottom: 14 }}>
              <label className="label">{t("transactions.importFile")}</label>
              <input type="file" accept=".csv,text/csv" onChange={handleFile} className="input" style={{ padding: 6 }} />
              {fileName && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {fileName} · {t("transactions.importParsedRows", { count: data.length })}
                </div>
              )}
            </div>

            {fields.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  {t("transactions.mapColumns")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <MappingCol k="date" label={t("transactions.colDate")} fields={fields} mapping={mapping} setMapping={setMapping} t={t} />
                  <MappingCol k="description" label={t("transactions.colDescription")} fields={fields} mapping={mapping} setMapping={setMapping} t={t} />
                  <MappingCol k="amount" label={t("transactions.colAmount")} fields={fields} mapping={mapping} setMapping={setMapping} t={t} />
                </div>

                <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={negate} onChange={(e) => setNegate(e.target.checked)} />
                    {t("transactions.negateAmounts")}
                  </label>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                    {t("transactions.skipDuplicates")}
                  </label>
                </div>

                {mapped && (
                  <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px 70px", padding: "8px 12px", background: "var(--bg-secondary)", fontSize: 10, color: "var(--text-muted)", fontWeight: 600, letterSpacing: 0.5 }}>
                      <div>{t("common.date")}</div>
                      <div>{t("common.merchant")}</div>
                      <div style={{ textAlign: "right" }}>{t("common.amount")}</div>
                      <div style={{ textAlign: "right" }}>{t("common.type")}</div>
                    </div>
                    {preview.map((r, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px 70px", padding: "7px 12px", borderTop: "0.5px solid var(--border-color)", fontSize: 12, alignItems: "center" }}>
                        <div style={{ color: "var(--text-muted)" }}>{r.date}</div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchant || "—"}</div>
                        <div style={{ textAlign: "right", color: r.amount < 0 ? "var(--expense)" : "var(--income)" }}>{fmt(r.amount)}</div>
                        <div style={{ textAlign: "right", fontSize: 10, color: "var(--text-muted)" }}>{r.amount < 0 ? t("common.expense") : t("common.income")}</div>
                      </div>
                    ))}
                    <div style={{ padding: "7px 12px", borderTop: "0.5px solid var(--border-color)", fontSize: 11, color: "var(--text-muted)" }}>
                      {t("transactions.importWillImport", { count: rows.length })}
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} className="btn btn-secondary">{t("common.cancel")}</button>
              <button type="button" className="btn btn-primary" disabled={!canImport} onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? t("transactions.importing") : t("transactions.runImport")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
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
  const [filters, setFilters] = useState({
    type: "",
    startDate: "",
    endDate: "",
    categoryId: "",
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
  //const catColor = (tx) => tx.splits?.[0]?.color || null;

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

  return (
    <div className="fade-in">
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 4,
            }}
          >
            {t("transactions.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("transactions.totalCount", { count: data?.total || 0 })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            title={t("transactions.export")}
          >
            <i className="ti ti-download" aria-hidden="true" />{" "}
            {isMobile ? "" : t("transactions.export")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowImport(true)}
            title={t("transactions.import")}
          >
            <i className="ti ti-upload" aria-hidden="true" />{" "}
            {isMobile ? "" : t("transactions.import")}
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <i className="ti ti-plus" aria-hidden="true" />{" "}
            {isMobile ? "" : t("transactions.addTransaction")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="card"
        style={{
          padding: "12px 16px",
          marginBottom: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          className="input"
          style={{ width: isMobile ? "100%" : 140 }}
          value={filters.type}
          onChange={(e) =>
            setFilters({ ...filters, type: e.target.value, categoryId: "" })
          }
        >
          <option value="">{t("transactions.allTypes")}</option>
          <option value="income">{t("common.income")}</option>
          <option value="expense">{t("common.expense")}</option>
        </select>

        {!isMobile && (
          <select
            className="input"
            style={{ width: 160 }}
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
          </select>
        )}
        {!isMobile && (
          <>
            <input
              className="input"
              type="date"
              style={{ width: 160 }}
              value={filters.startDate}
              onChange={(e) =>
                setFilters({ ...filters, startDate: e.target.value })
              }
            />
            <input
              className="input"
              type="date"
              style={{ width: 160 }}
              value={filters.endDate}
              onChange={(e) =>
                setFilters({ ...filters, endDate: e.target.value })
              }
            />
          </>
        )}
        {(filters.type ||
          filters.startDate ||
          filters.endDate ||
          filters.categoryId) && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12 }}
            onClick={() =>
              setFilters({
                type: "",
                startDate: "",
                endDate: "",
                categoryId: "",
              })
            }
          >
            <i className="ti ti-x" aria-hidden="true" />{" "}
            {t("transactions.clear")}
          </button>
        )}
      </div>

      {/* ── DESKTOP: Table layout ── */}
      {!isMobile && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "100px 1fr 120px 110px 90px 70px",
              padding: "10px 18px",
              borderBottom: "0.5px solid var(--border-color)",
              background: "var(--bg-secondary)",
            }}
          >
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
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  letterSpacing: 0.5,
                }}
              >
                {h}
              </div>
            ))}
          </div>
          {isLoading ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              {t("common.loading")}
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <i
                className="ti ti-receipt-off"
                style={{ fontSize: 36, color: "var(--text-muted)" }}
                aria-hidden="true"
              />
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  marginTop: 10,
                }}
              >
                {t("transactions.noneFound")}
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => setShowModal(true)}
              >
                {t("transactions.addFirst")}
              </button>
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr 120px 110px 90px 70px",
                  padding: "12px 18px",
                  borderBottom: "0.5px solid var(--border-color)",
                  alignItems: "center",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-secondary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {dayjs(tx.date).format("MMM D, YYYY")}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {tx.merchant || "—"}
                    {catName(tx) && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {catName(tx)}
                      </div>
                    )}
                    {tx.vendor_name && (
                      <div style={{ marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: 10,
                            background: "var(--brand-light)",
                            color: "var(--brand)",
                            padding: "1px 6px",
                            borderRadius: 3,
                          }}
                        >
                          {tx.vendor_name}
                        </span>
                      </div>
                    )}
                    {tx.is_split && (
                      <span
                        style={{
                          fontSize: 10,
                          background: "var(--payroll-bg)",
                          color: "var(--payroll)",
                          padding: "1px 6px",
                          borderRadius: 3,
                          marginLeft: 6,
                        }}
                      >
                        {t("transactions.split")}
                      </span>
                    )}
                    {!tx.is_split && tx.applied_rule_id && (
                      <span
                        style={{
                          fontSize: 10,
                          background: "var(--income-bg)",
                          color: "var(--income)",
                          padding: "1px 6px",
                          borderRadius: 3,
                          marginLeft: 6,
                        }}
                      >
                        {t("transactions.autoCategorized")}
                      </span>
                    )}
                    {tx.recurring_id && (
                      <span
                        style={{
                          fontSize: 10,
                          background: "var(--bg-secondary)",
                          color: "var(--text-secondary)",
                          padding: "1px 6px",
                          borderRadius: 3,
                          marginLeft: 6,
                        }}
                      >
                        <i
                          className="ti ti-repeat"
                          style={{ fontSize: 9, marginRight: 3 }}
                          aria-hidden="true"
                        />
                        {t("transactions.recurring")}
                      </span>
                    )}
                  </div>
                  {tx.notes && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 1,
                      }}
                    >
                      {tx.notes}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {acctName(tx)}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color:
                      tx.type === "income" ? "var(--income)" : "var(--expense)",
                  }}
                >
                  {tx.type === "income" ? "+" : "-"}
                  {fmt(tx.total_amount, currency)}
                  {tx.original_currency &&
                    tx.original_currency !== currency && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          fontWeight: 400,
                          marginTop: 2,
                        }}
                      >
                        {fmt(tx.original_amount, tx.original_currency)}
                      </div>
                    )}
                </div>
                <div>
                  <span
                    className={`badge badge-${tx.type}`}
                    style={{ fontSize: 10 }}
                  >
                    {t(`common.${tx.type}`)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    onClick={() => {
                      setEditTx(tx);
                      setShowModal(true);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: 4,
                    }}
                    title={t("common.edit")}
                  >
                    <i
                      className="ti ti-pencil"
                      style={{ fontSize: 15 }}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(t("transactions.confirmDelete")))
                        deleteMutation.mutate(tx.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--danger)",
                      padding: 4,
                    }}
                    title={t("common.delete")}
                  >
                    <i
                      className="ti ti-trash"
                      style={{ fontSize: 15 }}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── MOBILE: Card layout ── */}
      {isMobile && (
        <div>
          {isLoading ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              {t("common.loading")}
            </div>
          ) : transactions.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: "center" }}>
              <i
                className="ti ti-receipt-off"
                style={{ fontSize: 36, color: "var(--text-muted)" }}
                aria-hidden="true"
              />
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  marginTop: 10,
                }}
              >
                {t("transactions.noneFound")}
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => setShowModal(true)}
              >
                {t("transactions.addFirst")}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="card"
                  style={{ padding: "14px 16px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background:
                            tx.type === "income"
                              ? "var(--income-bg)"
                              : "var(--expense-bg)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <i
                          className={`ti ${tx.type === "income" ? "ti-arrow-down-left" : "ti-arrow-up-right"}`}
                          style={{
                            fontSize: 16,
                            color:
                              tx.type === "income"
                                ? "var(--income)"
                                : "var(--expense)",
                          }}
                          aria-hidden="true"
                        />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {tx.merchant || t("dashboard.noMerchant")}
                          {tx.is_split && (
                            <span
                              style={{
                                fontSize: 10,
                                background: "var(--payroll-bg)",
                                color: "var(--payroll)",
                                padding: "1px 6px",
                                borderRadius: 3,
                                marginLeft: 6,
                              }}
                            >
                              {t("transactions.split")}
                            </span>
                          )}
                          {!tx.is_split && tx.applied_rule_id && (
                            <span
                              style={{
                                fontSize: 10,
                                background: "var(--income-bg)",
                                color: "var(--income)",
                                padding: "1px 6px",
                                borderRadius: 3,
                                marginLeft: 6,
                              }}
                            >
                              {t("transactions.autoCategorized")}
                            </span>
                          )}
                          {tx.recurring_id && (
                            <span
                              style={{
                                fontSize: 10,
                                background: "var(--bg-secondary)",
                                color: "var(--text-secondary)",
                                padding: "1px 6px",
                                borderRadius: 3,
                                marginLeft: 6,
                              }}
                            >
                              <i
                                className="ti ti-repeat"
                                style={{ fontSize: 9, marginRight: 3 }}
                                aria-hidden="true"
                              />
                              {t("transactions.recurring")}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            marginTop: 2,
                          }}
                        >
                          {dayjs(tx.date).format("MMM D, YYYY")} ·{" "}
                          {acctName(tx)}
                          {catName(tx) && ` · ${catName(tx)}`}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        flexShrink: 0,
                        marginLeft: 8,
                        textAlign: "right",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color:
                            tx.type === "income"
                              ? "var(--income)"
                              : "var(--expense)",
                        }}
                      >
                        {tx.type === "income" ? "+" : "-"}
                        {fmt(tx.total_amount, currency)}
                      </div>
                      {tx.original_currency &&
                        tx.original_currency !== currency && (
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--text-muted)",
                              marginTop: 1,
                            }}
                          >
                            {fmt(tx.original_amount, tx.original_currency)}
                          </div>
                        )}
                    </div>
                  </div>
                  {tx.notes && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        marginBottom: 8,
                        paddingLeft: 46,
                      }}
                    >
                      {tx.notes}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingLeft: 46,
                    }}
                  >
                    <span
                      className={`badge badge-${tx.type}`}
                      style={{ fontSize: 10 }}
                    >
                      {t(`common.${tx.type}`)}
                    </span>
                    <div style={{ display: "flex", gap: 12 }}>
                      <button
                        onClick={() => {
                          setEditTx(tx);
                          setShowModal(true);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-muted)",
                          padding: "4px 8px",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <i className="ti ti-pencil" aria-hidden="true" />{" "}
                        {t("common.edit")}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(t("transactions.confirmDelete")))
                            deleteMutation.mutate(tx.id);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--danger)",
                          padding: "4px 8px",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <i className="ti ti-trash" aria-hidden="true" />{" "}
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
