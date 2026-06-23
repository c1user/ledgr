import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

// Aging buckets in display order. `color` drives the accent on each bucket card;
// severity increases from current → 90+.
const BUCKETS = [
  { key: "current", labelKey: "ar.bucketCurrent", color: "var(--income, #22c55e)" },
  { key: "d1_30", labelKey: "ar.bucket1_30", color: "#eab308" },
  { key: "d31_60", labelKey: "ar.bucket31_60", color: "#f97316" },
  { key: "d61_90", labelKey: "ar.bucket61_90", color: "#ef4444" },
  { key: "d90_plus", labelKey: "ar.bucket90_plus", color: "var(--expense, #dc2626)" },
];

// ── Summary stat card ─────────────────────────────────────────
function StatCard({ label, value, valueColor }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: valueColor || "var(--text-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Aging bucket card ─────────────────────────────────────────
function BucketCard({ label, bucket, fmt, currency }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: bucket.color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
        {fmt(bucket.total, currency)}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
        {bucket.count}
      </div>
    </div>
  );
}

// ── By-client breakdown table ─────────────────────────────────
function ClientTable({ clients, fmt, currency, t, onSelectClient }) {
  const cols = "1fr 100px 100px 100px 100px 100px 110px";
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          padding: "10px 16px",
          borderBottom: "0.5px solid var(--border-color)",
          background: "var(--bg-secondary)",
          fontSize: 11,
          color: "var(--text-muted)",
          fontWeight: 500,
          letterSpacing: 0.5,
        }}
      >
        <div>{t("ar.colClient")}</div>
        <div style={{ textAlign: "right" }}>{t("ar.bucketCurrent")}</div>
        <div style={{ textAlign: "right" }}>{t("ar.bucket1_30")}</div>
        <div style={{ textAlign: "right" }}>{t("ar.bucket31_60")}</div>
        <div style={{ textAlign: "right" }}>{t("ar.bucket61_90")}</div>
        <div style={{ textAlign: "right" }}>{t("ar.bucket90_plus")}</div>
        <div style={{ textAlign: "right" }}>{t("common.total")}</div>
      </div>
      {clients.map((c) => (
        <div
          key={c.client_id}
          onClick={() => onSelectClient(c.client_id)}
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            padding: "12px 16px",
            borderBottom: "0.5px solid var(--border-color)",
            alignItems: "center",
            cursor: "pointer",
            transition: "background 0.15s",
            fontSize: 13,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-secondary)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div
            style={{
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.client_name}
          </div>
          <Cell value={c.current} fmt={fmt} currency={currency} />
          <Cell value={c.d1_30} fmt={fmt} currency={currency} />
          <Cell value={c.d31_60} fmt={fmt} currency={currency} />
          <Cell value={c.d61_90} fmt={fmt} currency={currency} />
          <Cell value={c.d90_plus} fmt={fmt} currency={currency} danger />
          <div
            style={{
              textAlign: "right",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {fmt(c.total, currency)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Cell({ value, fmt, currency, danger }) {
  const nonZero = value > 0;
  return (
    <div
      style={{
        textAlign: "right",
        color: nonZero
          ? danger
            ? "var(--expense, #dc2626)"
            : "var(--text-secondary)"
          : "var(--text-muted)",
      }}
    >
      {nonZero ? fmt(value, currency) : "—"}
    </div>
  );
}

// ── Overdue invoice list ──────────────────────────────────────
function OverdueList({ invoices, fmt, currency, t, onSelectInvoice }) {
  const cols = "120px 1fr 120px 90px 110px";
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          padding: "10px 16px",
          borderBottom: "0.5px solid var(--border-color)",
          background: "var(--bg-secondary)",
          fontSize: 11,
          color: "var(--text-muted)",
          fontWeight: 500,
          letterSpacing: 0.5,
        }}
      >
        <div>{t("ar.colNumber")}</div>
        <div>{t("ar.colClient")}</div>
        <div>{t("ar.colDue")}</div>
        <div style={{ textAlign: "right" }}>{t("ar.colDaysLate")}</div>
        <div style={{ textAlign: "right" }}>{t("common.amount")}</div>
      </div>
      {invoices.map((inv) => (
        <div
          key={inv.id}
          onClick={() => onSelectInvoice(inv.id)}
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            padding: "12px 16px",
            borderBottom: "0.5px solid var(--border-color)",
            alignItems: "center",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-secondary)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}
          >
            {inv.invoice_number}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {inv.client_name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {dayjs(inv.due_date).format("MMM D, YYYY")}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              textAlign: "right",
              color: "var(--expense, #dc2626)",
            }}
          >
            {t("ar.daysLate", { days: inv.days_overdue })}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              textAlign: "right",
              color: "var(--text-primary)",
            }}
          >
            {fmt(inv.total, currency)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "var(--text-primary)",
        margin: "24px 0 12px",
      }}
    >
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function AccountsReceivable() {
  const { t, i18n } = useTranslation();
  const { business } = useAuthStore();
  const navigate = useNavigate();
  const fmt = makeFmt(i18n.language);
  const currency = business?.currency || "USD";

  const aging = useQuery({
    queryKey: ["ar-aging"],
    queryFn: () => api.get("/reports/ar-aging").then((r) => r.data),
  });
  const summary = useQuery({
    queryKey: ["ar-summary"],
    queryFn: () => api.get("/reports/ar-summary").then((r) => r.data),
  });

  const isLoading = aging.isLoading || summary.isLoading;
  const isError = aging.isError || summary.isError;

  const overdueInvoices = (aging.data?.invoices || []).filter(
    (i) => i.days_overdue > 0,
  );

  // Deep-link into the invoices page: a client row filters to that client, an
  // overdue row opens that invoice's drawer.
  const goToClient = (clientId) =>
    navigate(`/sales/invoices?client=${clientId}`);
  const goToInvoice = (invoiceId) =>
    navigate(`/sales/invoices?invoice=${invoiceId}`);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          {t("ar.title")}
        </h1>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
          {t("ar.subtitle")}
        </p>
      </div>

      {isLoading && (
        <div
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          {t("common.loading")}
        </div>
      )}

      {isError && (
        <div
          style={{
            fontSize: 14,
            color: "var(--expense, #dc2626)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          {t("ar.error")}
        </div>
      )}

      {!isLoading && !isError && aging.data && summary.data && (
        <>
          {/* Summary stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <StatCard
              label={t("ar.totalOutstanding")}
              value={fmt(aging.data.total_outstanding, currency)}
              valueColor="var(--brand)"
            />
            <StatCard
              label={t("ar.totalOverdue")}
              value={fmt(aging.data.total_overdue, currency)}
              valueColor={
                aging.data.total_overdue > 0
                  ? "var(--expense, #dc2626)"
                  : "var(--text-primary)"
              }
            />
            <StatCard
              label={t("ar.openInvoices")}
              value={aging.data.invoice_count}
            />
          </div>

          {aging.data.invoice_count === 0 ? (
            <div
              className="card"
              style={{
                padding: 48,
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 14,
                marginTop: 12,
              }}
            >
              <i
                className="ti ti-cash-banknote"
                style={{
                  fontSize: 40,
                  display: "block",
                  marginBottom: 12,
                  color: "var(--text-muted)",
                }}
              />
              {t("ar.noneOutstanding")}
            </div>
          ) : (
            <>
              {/* Aging buckets */}
              <SectionTitle>{t("ar.agingTitle")}</SectionTitle>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 12,
                }}
              >
                {BUCKETS.map((b) => (
                  <BucketCard
                    key={b.key}
                    label={t(b.labelKey)}
                    bucket={{ ...aging.data.buckets[b.key], color: b.color }}
                    fmt={fmt}
                    currency={currency}
                  />
                ))}
              </div>

              {/* By-client breakdown */}
              <SectionTitle>{t("ar.byClientTitle")}</SectionTitle>
              <ClientTable
                clients={summary.data.clients}
                fmt={fmt}
                currency={currency}
                t={t}
                onSelectClient={goToClient}
              />

              {/* Overdue invoices */}
              {overdueInvoices.length > 0 && (
                <>
                  <SectionTitle>{t("ar.overdueTitle")}</SectionTitle>
                  <OverdueList
                    invoices={overdueInvoices}
                    fmt={fmt}
                    currency={currency}
                    t={t}
                    onSelectInvoice={goToInvoice}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
