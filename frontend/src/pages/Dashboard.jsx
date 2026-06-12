import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import dayjs from "dayjs";

const fmt = (val, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    val || 0,
  );

// ── KPI Card ─────────────────────────────────────────────────
function KpiCard({ label, value, color, icon, bg }) {
  return (
    <div className="card" style={{ padding: "16px 20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: 1,
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, color }}>{value}</div>
        </div>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <i
            className={`ti ${icon}`}
            style={{ fontSize: 18, color }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

// ── Custom Tooltip for donut chart ────────────────────────────
function CustomTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--bg-primary)",
        border: "0.5px solid var(--border-color)",
        borderRadius: 8,
        padding: "10px 14px",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: d.color,
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {d.name}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--expense)", fontWeight: 600 }}>
        {fmt(d.value, currency)}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {d.pct}% of expenses
      </div>
    </div>
  );
}

// ── Spending by category chart ────────────────────────────────
function SpendingChart({ transactions, currency, navigate }) {
  const [activeIndex, setActiveIndex] = useState(null);

  // Aggregate spending by category from transactions this month
  const categoryMap = {};
  for (const tx of transactions || []) {
    if (tx.type !== "expense") continue;
    if (tx.is_split && tx.splits?.length > 0) {
      for (const split of tx.splits) {
        const key = split.category_name || "Uncategorized";
        const color = split.category_color || "#888780";
        if (!categoryMap[key])
          categoryMap[key] = { name: key, value: 0, color };
        categoryMap[key].value += parseFloat(split.amount || 0);
      }
    } else {
      const key = tx.category_name || "Uncategorized";
      const color = tx.category_color || "#888780";
      if (!categoryMap[key]) categoryMap[key] = { name: key, value: 0, color };
      categoryMap[key].value += parseFloat(tx.total_amount || 0);
    }
  }

  const total = Object.values(categoryMap).reduce((s, c) => s + c.value, 0);
  const data = Object.values(categoryMap)
    .map((c) => ({
      ...c,
      pct: total > 0 ? ((c.value / total) * 100).toFixed(1) : "0.0",
    }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <i
          className="ti ti-chart-donut"
          style={{ fontSize: 36, color: "var(--text-muted)" }}
          aria-hidden="true"
        />
        <div
          style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}
        >
          No expense data yet this month
        </div>
        <button
          onClick={() => navigate("/transactions")}
          className="btn btn-primary"
          style={{ marginTop: 12 }}
        >
          Add a transaction
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 0 8px" }}>
      {/* Donut chart */}
      <div style={{ height: 220, position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={2}
              dataKey="value"
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                  opacity={
                    activeIndex === null || activeIndex === index ? 1 : 0.5
                  }
                  stroke="none"
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginBottom: 2,
            }}
          >
            TOTAL
          </div>
          <div
            style={{ fontSize: 16, fontWeight: 700, color: "var(--expense)" }}
          >
            {fmt(total, currency)}
          </div>
        </div>
      </div>

      {/* Category ranked list */}
      <div style={{ padding: "0 18px" }}>
        {data.map((cat, i) => (
          <div
            key={cat.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderBottom:
                i < data.length - 1
                  ? "0.5px solid var(--border-color)"
                  : "none",
            }}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {/* Color dot */}
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: cat.color,
                flexShrink: 0,
              }}
            />

            {/* Category name + bar */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-primary)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cat.name}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  {cat.pct}%
                </span>
              </div>
              {/* Progress bar */}
              <div
                style={{
                  height: 4,
                  background: "var(--border-color)",
                  borderRadius: 2,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${cat.pct}%`,
                    background: cat.color,
                    borderRadius: 2,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>

            {/* Amount */}
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--expense)",
                flexShrink: 0,
                minWidth: 70,
                textAlign: "right",
              }}
            >
              {fmt(cat.value, currency)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const { business } = useAuthStore();
  const navigate = useNavigate();
  const currency = business?.currency || "USD";

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const now = dayjs();
  const startOfMonth = now.startOf("month").format("YYYY-MM-DD");
  const endOfMonth = now.endOf("month").format("YYYY-MM-DD");

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["summary", startOfMonth, endOfMonth],
    queryFn: () =>
      api
        .get(
          `/transactions/summary/totals?startDate=${startOfMonth}&endDate=${endOfMonth}`,
        )
        .then((r) => r.data),
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ["transactions", "recent"],
    queryFn: () =>
      api
        .get(
          `/transactions?limit=100&startDate=${startOfMonth}&endDate=${endOfMonth}`,
        )
        .then((r) => r.data),
  });

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ["balances"],
    queryFn: () => api.get("/accounts/summary/balances").then((r) => r.data),
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const income = parseFloat(summary?.total_income || 0);
  const expenses = parseFloat(summary?.total_expenses || 0);
  const net = income - expenses;

  return (
    <div className="fade-in">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 4,
          }}
        >
          Dashboard
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {now.format("MMMM YYYY")} overview
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <KpiCard
          label="Revenue"
          value={summaryLoading ? "..." : fmt(income, currency)}
          color="var(--income)"
          icon="ti-trending-up"
          bg="var(--income-bg)"
        />
        <KpiCard
          label="Expenses"
          value={summaryLoading ? "..." : fmt(expenses, currency)}
          color="var(--expense)"
          icon="ti-trending-down"
          bg="var(--expense-bg)"
        />
        <KpiCard
          label="Net Profit"
          value={summaryLoading ? "..." : fmt(net, currency)}
          color={net >= 0 ? "var(--income)" : "var(--expense)"}
          icon="ti-report-money"
          bg={net >= 0 ? "var(--income-bg)" : "var(--expense-bg)"}
        />
        <KpiCard
          label="Total Balance"
          value={
            balancesLoading ? "..." : fmt(balances?.total_balance, currency)
          }
          color="var(--payroll)"
          icon="ti-building-bank"
          bg="var(--payroll-bg)"
        />
      </div>

      {/* Main grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 300px",
          gap: 16,
        }}
      >
        {/* Left — spending chart + recent transactions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Spending by category — shown on both mobile and desktop */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "0.5px solid var(--border-color)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                Spending by Category
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {now.format("MMMM YYYY")} expenses
              </div>
            </div>
            {txLoading ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                Loading...
              </div>
            ) : (
              <SpendingChart
                transactions={txData?.transactions}
                currency={currency}
                navigate={navigate}
              />
            )}
          </div>

          {/* Recent transactions — shown on both mobile and desktop */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "0.5px solid var(--border-color)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                Recent Transactions
              </div>
              <button
                onClick={() => navigate("/transactions")}
                className="btn btn-secondary"
                style={{ padding: "5px 10px", fontSize: 12 }}
              >
                View all
              </button>
            </div>
            {txLoading ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                Loading...
              </div>
            ) : txData?.transactions?.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center" }}>
                <i
                  className="ti ti-receipt-off"
                  style={{ fontSize: 32, color: "var(--text-muted)" }}
                  aria-hidden="true"
                />
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 13,
                    marginTop: 8,
                  }}
                >
                  No transactions yet
                </div>
                <button
                  onClick={() => navigate("/transactions")}
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                >
                  Add your first transaction
                </button>
              </div>
            ) : (
              <div>
                {txData?.transactions?.slice(0, 8).map((tx) => (
                  <div
                    key={tx.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 18px",
                      borderBottom: "0.5px solid var(--border-color)",
                      cursor: "pointer",
                      transition: "background 0.15s",
                      gap: 12,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                    onClick={() => navigate("/transactions")}
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
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
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        flexShrink: 0,
                        color:
                          tx.type === "income"
                            ? "var(--income)"
                            : "var(--expense)",
                      }}
                    >
                      {tx.type === "income" ? "+" : "-"}
                      {fmt(tx.total_amount, currency)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Account balances */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "0.5px solid var(--border-color)",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text-primary)",
              }}
            >
              Accounts
            </div>
            {balancesLoading ? (
              <div
                style={{
                  padding: 16,
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                Loading...
              </div>
            ) : accounts?.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                No accounts yet
              </div>
            ) : (
              <div>
                {accounts?.map((acc) => (
                  <div
                    key={acc.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 18px",
                      borderBottom: "0.5px solid var(--border-color)",
                    }}
                  >
                    <div>
                      <div
                        style={{ fontSize: 13, color: "var(--text-primary)" }}
                      >
                        {acc.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          textTransform: "capitalize",
                        }}
                      >
                        {acc.type}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          parseFloat(acc.current_balance) >= 0
                            ? "var(--income)"
                            : "var(--expense)",
                      }}
                    >
                      {fmt(acc.current_balance, currency)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI prompt bar */}
          <div
            className="card"
            onClick={() => navigate("/ai")}
            style={{
              padding: "14px 16px",
              cursor: "pointer",
              transition: "all 0.15s",
              border: "0.5px solid var(--border-color)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = "var(--brand)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = "var(--border-color)")
            }
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--brand-light)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <i
                  className="ti ti-sparkles"
                  style={{ fontSize: 16, color: "var(--brand)" }}
                  aria-hidden="true"
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  Ask AI about your finances
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 1,
                  }}
                >
                  "What was my biggest expense this month?"
                </div>
              </div>
              <i
                className="ti ti-arrow-right"
                style={{
                  marginLeft: "auto",
                  color: "var(--text-muted)",
                  fontSize: 16,
                }}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="card" style={{ padding: "14px 18px" }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text-primary)",
                marginBottom: 12,
              }}
            >
              Quick Actions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => navigate("/transactions")}
                className="btn btn-secondary"
                style={{ justifyContent: "flex-start", fontSize: 13 }}
              >
                <i className="ti ti-plus" aria-hidden="true" /> Add transaction
              </button>
              <button
                onClick={() => navigate("/receipts")}
                className="btn btn-secondary"
                style={{ justifyContent: "flex-start", fontSize: 13 }}
              >
                <i className="ti ti-camera" aria-hidden="true" /> Scan receipt
              </button>
              <button
                onClick={() => navigate("/payroll")}
                className="btn btn-secondary"
                style={{ justifyContent: "flex-start", fontSize: 13 }}
              >
                <i className="ti ti-report-money" aria-hidden="true" /> Run
                payroll
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
