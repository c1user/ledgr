import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import useAuthStore from "../store/authStore";

const fmt = (val, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    val || 0,
  );

const emptyForm = {
  name: "",
  type: "current",
  currency: "USD",
  currentBalance: "",
};

const accountTypeIcons = {
  current: "ti-building-bank",
  savings: "ti-piggy-bank",
  credit: "ti-credit-card",
  cash: "ti-cash",
  loan: "ti-receipt",
};

// ── Account Modal ─────────────────────────────────────────────
function AccountModal({ onClose, editAccount }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    editAccount
      ? {
          name: editAccount.name,
          type: editAccount.type,
          currency: editAccount.currency,
          currentBalance: editAccount.current_balance,
        }
      : emptyForm,
  );
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (data) =>
      editAccount
        ? api.put(`/accounts/${editAccount.id}`, data)
        : api.post("/accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || "Failed to save account"),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (!form.name) return setError("Account name is required");
    mutation.mutate({
      name: form.name,
      type: form.type,
      currency: form.currency,
      currentBalance: parseFloat(form.currentBalance || 0),
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
        style={{ width: "100%", maxWidth: 440, padding: 24 }}
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
            {editAccount ? "Edit Account" : "New Account"}
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
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="name">
              Account Name
            </label>
            <input
              id="name"
              className="input"
              type="text"
              placeholder="e.g. Business Checking"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="type">
              Account Type
            </label>
            <select
              id="type"
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="current">Current / Checking Account</option>
              <option value="savings">Savings Account</option>
              <option value="credit">Credit Card</option>
              <option value="cash">Cash</option>
              <option value="loan">Loan</option>
            </select>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div>
              <label className="label" htmlFor="currentBalance">
                Opening Balance
                {editAccount && (
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontWeight: 400,
                      marginLeft: 4,
                    }}
                  >
                    (current)
                  </span>
                )}
              </label>
              <input
                id="currentBalance"
                className="input"
                type="number"
                placeholder="0.00"
                step="0.01"
                value={form.currentBalance}
                onChange={(e) =>
                  setForm({ ...form, currentBalance: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="currency">
                Currency
              </label>
              <select
                id="currency"
                className="input"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

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
                : editAccount
                  ? "Save changes"
                  : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Accounts Page ────────────────────────────────────────
export default function Accounts() {
  const { business } = useAuthStore();
  const queryClient = useQueryClient();
  const currency = business?.currency || "USD";
  const [showModal, setShowModal] = useState(false);
  const [editAccount, setEditAccount] = useState(null);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const { data: balances } = useQuery({
    queryKey: ["balances"],
    queryFn: () => api.get("/accounts/summary/balances").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });

  const handleClose = () => {
    setShowModal(false);
    setEditAccount(null);
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
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
            Accounts
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {accounts?.length || 0} accounts
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <i className="ti ti-plus" aria-hidden="true" /> Add account
        </button>
      </div>

      {/* Total balance summary */}
      {balances && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[
            {
              label: "Total Balance",
              value: balances.total_balance,
              color: "var(--income)",
            },
            {
              label: "Bank",
              value: balances.bank_balance,
              color: "var(--payroll)",
            },
            {
              label: "Credit",
              value: balances.credit_balance,
              color: "var(--expense)",
            },
            {
              label: "Cash",
              value: balances.cash_balance,
              color: "var(--profit)",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="card"
              style={{ padding: "14px 16px" }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  letterSpacing: 1,
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>
                {fmt(s.value, currency)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accounts list */}
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
      ) : accounts?.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <i
            className="ti ti-building-bank"
            style={{ fontSize: 40, color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <div
            style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 12 }}
          >
            No accounts yet
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => setShowModal(true)}
          >
            Add your first account
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 12,
          }}
        >
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="card"
              style={{ padding: "18px 20px", opacity: acc.is_active ? 1 : 0.5 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "var(--payroll-bg)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <i
                      className={`ti ${accountTypeIcons[acc.type] || "ti-building-bank"}`}
                      style={{ fontSize: 18, color: "var(--payroll)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {acc.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        textTransform: "capitalize",
                        marginTop: 1,
                      }}
                    >
                      {acc.type} · {acc.currency}
                      {!acc.is_active && (
                        <span
                          style={{
                            marginLeft: 6,
                            color: "var(--danger)",
                            fontSize: 10,
                          }}
                        >
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => {
                      setEditAccount(acc);
                      setShowModal(true);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: 4,
                      borderRadius: 4,
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
                      if (window.confirm("Deactivate this account?"))
                        deleteMutation.mutate(acc.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--danger)",
                      padding: 4,
                      borderRadius: 4,
                    }}
                    title="Deactivate"
                  >
                    <i
                      className="ti ti-trash"
                      style={{ fontSize: 15 }}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>

              {/* Balance */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    Current Balance
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color:
                        parseFloat(acc.current_balance) >= 0
                          ? "var(--income)"
                          : "var(--expense)",
                    }}
                  >
                    {fmt(acc.current_balance, acc.currency)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    Transactions
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 500,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {acc.transaction_count || 0}
                  </div>
                </div>
              </div>

              {/* Income / Expense bar */}
              {(parseFloat(acc.total_income) > 0 ||
                parseFloat(acc.total_expenses) > 0) && (
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: "0.5px solid var(--border-color)",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginBottom: 2,
                      }}
                    >
                      Total In
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--income)",
                      }}
                    >
                      +{fmt(acc.total_income, acc.currency)}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginBottom: 2,
                      }}
                    >
                      Total Out
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--expense)",
                      }}
                    >
                      -{fmt(acc.total_expenses, acc.currency)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AccountModal onClose={handleClose} editAccount={editAccount} />
      )}
    </div>
  );
}
