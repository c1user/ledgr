import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";

const fmt = (val, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    val || 0,
  );

const emptyForm = {
  accountId: "",
  date: dayjs().format("YYYY-MM-DD"),
  merchant: "",
  totalAmount: "",
  type: "expense",
  notes: "",
  categoryId: "",
  splits: [],
};

function SplitEditor({ splits, setSplits, totalAmount, categories }) {
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
            <option value="">Select category</option>
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
          <i className="ti ti-plus" aria-hidden="true" /> Add split line
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
            ? "✓ Splits balanced"
            : `Remaining: ${fmt(remaining)}`}
        </div>
      </div>
    </div>
  );
}

function TransactionModal({ onClose, accounts, categories, editTx }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    editTx
      ? {
          accountId: editTx.account_id,
          date: dayjs(editTx.date).format("YYYY-MM-DD"),
          merchant: editTx.merchant || "",
          totalAmount: editTx.total_amount,
          type: editTx.type,
          notes: editTx.notes || "",
          categoryId: editTx.category_id || "",
          splits:
            editTx.splits?.map((s) => ({
              categoryId: s.category_id,
              amount: s.amount,
              notes: s.notes || "",
            })) || [],
        }
      : emptyForm,
  );
  const [useSplit, setUseSplit] = useState(editTx ? editTx.is_split : false);
  const [error, setError] = useState("");

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
      setError(err.response?.data?.error || "Failed to save transaction"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.accountId) return setError("Please select an account");
    if (!form.totalAmount || form.totalAmount <= 0)
      return setError("Enter a valid amount");
    if (useSplit && form.splits.length === 0)
      return setError("Add at least one split line or disable split mode");
    mutation.mutate({
      accountId: form.accountId,
      date: form.date,
      merchant: form.merchant || undefined,
      totalAmount: parseFloat(form.totalAmount),
      type: form.type,
      notes: form.notes || undefined,
      categoryId: !useSplit ? form.categoryId || undefined : undefined,
      splits: useSplit ? form.splits : [],
    });
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
            {editTx ? "Edit Transaction" : "New Transaction"}
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
            {["expense", "income"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, type: t })}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: 8,
                  border: "0.5px solid",
                  borderColor:
                    form.type === t
                      ? t === "income"
                        ? "var(--income)"
                        : "var(--expense)"
                      : "var(--border-color)",
                  background:
                    form.type === t
                      ? t === "income"
                        ? "var(--income-bg)"
                        : "var(--expense-bg)"
                      : "transparent",
                  color:
                    form.type === t
                      ? t === "income"
                        ? "var(--income)"
                        : "var(--expense)"
                      : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  textTransform: "capitalize",
                }}
              >
                <i
                  className={`ti ${t === "income" ? "ti-arrow-down-left" : "ti-arrow-up-right"}`}
                  style={{ marginRight: 6 }}
                  aria-hidden="true"
                />
                {t}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <label className="label" htmlFor="totalAmount">
                Amount
              </label>
              <input
                id="totalAmount"
                className="input"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                value={form.totalAmount}
                onChange={(e) =>
                  setForm({ ...form, totalAmount: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="date">
                Date
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

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="merchant">
              Merchant / Description
            </label>
            <input
              id="merchant"
              className="input"
              type="text"
              placeholder="e.g. Office Depot"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="accountId">
              Account
            </label>
            <select
              id="accountId"
              className="input"
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              required
            >
              <option value="">Select account</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category — only show when not splitting */}
          {!useSplit && (
            <div style={{ marginBottom: 14 }}>
              <label className="label" htmlFor="categoryId">
                Category
              </label>
              <select
                id="categoryId"
                className="input"
                value={form.categoryId}
                onChange={(e) =>
                  setForm({ ...form, categoryId: e.target.value })
                }
              >
                <option value="">Select a category</option>
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

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="notes">
              Notes
            </label>
            <input
              id="notes"
              className="input"
              type="text"
              placeholder="Optional note"
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
              aria-label="Toggle split"
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
                Split transaction
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Divide this amount across multiple categories
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
                Split breakdown
              </div>
              <SplitEditor
                splits={form.splits}
                setSplits={(splits) => setForm({ ...form, splits })}
                totalAmount={form.totalAmount}
                categories={categories}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? "Saving..."
                : editTx
                  ? "Save changes"
                  : "Add transaction"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Transactions() {
  const { business } = useAuthStore();
  const queryClient = useQueryClient();
  const currency = business?.currency || "USD";
  const [showModal, setShowModal] = useState(false);
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
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

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
            Transactions
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {data?.total || 0} total transactions
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <i className="ti ti-plus" aria-hidden="true" />{" "}
          {isMobile ? "" : "Add transaction"}
        </button>
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
          <option value="">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
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
            <option value="">All categories</option>
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
            <i className="ti ti-x" aria-hidden="true" /> Clear
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
            {["Date", "Merchant", "Account", "Amount", "Type", ""].map((h) => (
              <div
                key={h}
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
              Loading...
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
                No transactions found
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => setShowModal(true)}
              >
                Add your first transaction
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
                    {tx.category_name && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {tx.category_name}
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
                        split
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
                  {tx.account_name}
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
                </div>
                <div>
                  <span
                    className={`badge badge-${tx.type}`}
                    style={{ fontSize: 10, textTransform: "capitalize" }}
                  >
                    {tx.type}
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
                    title="Edit"
                  >
                    <i
                      className="ti ti-pencil"
                      style={{ fontSize: 15 }}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("Delete this transaction?"))
                        deleteMutation.mutate(tx.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--danger)",
                      padding: 4,
                    }}
                    title="Delete"
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
              Loading...
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
                No transactions found
              </div>
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => setShowModal(true)}
              >
                Add your first transaction
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
                          {tx.merchant || "No merchant"}
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
                              split
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
                          {tx.account_name}
                          {tx.category_name && ` · ${tx.category_name}`}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color:
                          tx.type === "income"
                            ? "var(--income)"
                            : "var(--expense)",
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      {tx.type === "income" ? "+" : "-"}
                      {fmt(tx.total_amount, currency)}
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
                      style={{ fontSize: 10, textTransform: "capitalize" }}
                    >
                      {tx.type}
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
                        <i className="ti ti-pencil" aria-hidden="true" /> Edit
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm("Delete this transaction?"))
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
                        <i className="ti ti-trash" aria-hidden="true" /> Delete
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
          categories={categories}
          editTx={editTx}
          currency={currency}
        />
      )}
    </div>
  );
}
