import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import cx from "../lib/cx";
import { Card, EmptyState, PageHeader } from "../components/ui";

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
  { key: "current", labelKey: "ar.bucketCurrent", color: "var(--income)" },
  { key: "d1_30", labelKey: "ar.bucket1_30", color: "#b88a1f" },
  { key: "d31_60", labelKey: "ar.bucket31_60", color: "#c86a2e" },
  { key: "d61_90", labelKey: "ar.bucket61_90", color: "var(--expense)" },
  { key: "d90_plus", labelKey: "ar.bucket90_plus", color: "var(--danger)" },
];

// ── Summary stat card ─────────────────────────────────────────
function StatCard({ label, value, valueClass }) {
  return (
    <Card padding="none" className="px-4 py-3.5">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className={cx("text-xl font-bold", valueClass || "text-ink")}>
        {value}
      </div>
    </Card>
  );
}

// ── Aging bucket card ─────────────────────────────────────────
function BucketCard({ label, bucket, fmt, currency }) {
  return (
    <Card padding="none" className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: bucket.color }}
        />
        <span className="text-[11px] text-muted">{label}</span>
      </div>
      <div className="text-[17px] font-bold text-ink">
        {fmt(bucket.total, currency)}
      </div>
      <div className="text-[11px] text-muted mt-0.5">{bucket.count}</div>
    </Card>
  );
}

// ── By-client breakdown table ─────────────────────────────────
function ClientTable({ clients, fmt, currency, t, onSelectClient }) {
  const cols = "grid-cols-[1fr_100px_100px_100px_100px_100px_110px]";
  return (
    <Card padding="none" className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div
          className={cx(
            "grid px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]",
            cols,
          )}
        >
          <div>{t("ar.colClient")}</div>
          <div className="text-right">{t("ar.bucketCurrent")}</div>
          <div className="text-right">{t("ar.bucket1_30")}</div>
          <div className="text-right">{t("ar.bucket31_60")}</div>
          <div className="text-right">{t("ar.bucket61_90")}</div>
          <div className="text-right">{t("ar.bucket90_plus")}</div>
          <div className="text-right">{t("common.total")}</div>
        </div>
        {clients.map((c) => (
          <div
            key={c.client_id}
            onClick={() => onSelectClient(c.client_id)}
            className={cx(
              "grid px-4 py-3 border-b border-line items-center cursor-pointer transition-colors hover:bg-canvas text-md",
              cols,
            )}
          >
            <div className="font-semibold text-ink truncate">
              {c.client_name}
            </div>
            <Cell value={c.current} fmt={fmt} currency={currency} />
            <Cell value={c.d1_30} fmt={fmt} currency={currency} />
            <Cell value={c.d31_60} fmt={fmt} currency={currency} />
            <Cell value={c.d61_90} fmt={fmt} currency={currency} />
            <Cell value={c.d90_plus} fmt={fmt} currency={currency} danger />
            <div className="text-right font-bold text-ink">
              {fmt(c.total, currency)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Cell({ value, fmt, currency, danger }) {
  const nonZero = value > 0;
  return (
    <div
      className={cx(
        "text-right",
        nonZero ? (danger ? "text-expense" : "text-secondary") : "text-muted",
      )}
    >
      {nonZero ? fmt(value, currency) : "—"}
    </div>
  );
}

// ── Overdue invoice list ──────────────────────────────────────
function OverdueList({ invoices, fmt, currency, t, onSelectInvoice }) {
  const cols = "grid-cols-[120px_1fr_120px_90px_110px]";
  return (
    <Card padding="none" className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div
          className={cx(
            "grid px-4 py-2.5 border-b border-line bg-canvas text-[11px] text-muted font-medium tracking-[0.5px]",
            cols,
          )}
        >
          <div>{t("ar.colNumber")}</div>
          <div>{t("ar.colClient")}</div>
          <div>{t("ar.colDue")}</div>
          <div className="text-right">{t("ar.colDaysLate")}</div>
          <div className="text-right">{t("common.amount")}</div>
        </div>
        {invoices.map((inv) => (
          <div
            key={inv.id}
            onClick={() => onSelectInvoice(inv.id)}
            className={cx(
              "grid px-4 py-3 border-b border-line items-center cursor-pointer transition-colors hover:bg-canvas",
              cols,
            )}
          >
            <div className="text-md font-semibold text-ink">
              {inv.invoice_number}
            </div>
            <div className="text-md text-secondary truncate">
              {inv.client_name}
            </div>
            <div className="text-xs text-muted">
              {dayjs(inv.due_date).format("MMM D, YYYY")}
            </div>
            <div className="text-xs font-semibold text-right text-expense">
              {t("ar.daysLate", { days: inv.days_overdue })}
            </div>
            <div className="text-md font-semibold text-right text-ink">
              {fmt(inv.total, currency)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Section heading ───────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <div className="text-md font-semibold text-ink mt-6 mb-3">{children}</div>
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
  const goToClient = (clientId) => navigate(`/sales/invoices?client=${clientId}`);
  const goToInvoice = (invoiceId) =>
    navigate(`/sales/invoices?invoice=${invoiceId}`);

  return (
    <div className="max-w-[960px] mx-auto">
      <PageHeader title={t("ar.title")} subtitle={t("ar.subtitle")} />

      {isLoading && (
        <div className="text-sm text-muted py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {isError && (
        <div className="text-sm text-expense py-10 text-center">
          {t("ar.error")}
        </div>
      )}

      {!isLoading && !isError && aging.data && summary.data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-2">
            <StatCard
              label={t("ar.totalOutstanding")}
              value={fmt(aging.data.total_outstanding, currency)}
              valueClass="text-brand"
            />
            <StatCard
              label={t("ar.totalOverdue")}
              value={fmt(aging.data.total_overdue, currency)}
              valueClass={
                aging.data.total_overdue > 0 ? "text-expense" : "text-ink"
              }
            />
            <StatCard
              label={t("ar.openInvoices")}
              value={aging.data.invoice_count}
            />
          </div>

          {aging.data.invoice_count === 0 ? (
            <Card className="mt-3">
              <EmptyState
                icon="ti-cash-banknote"
                message={t("ar.noneOutstanding")}
              />
            </Card>
          ) : (
            <>
              {/* Aging buckets */}
              <SectionTitle>{t("ar.agingTitle")}</SectionTitle>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
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
