import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
} from "../components/ui";

const ACTION_TONES = {
  create: "income",
  update: "payroll",
  delete: "danger",
};

// entity_type slug → existing i18n title key (fall back to the slug).
const ENTITY_KEYS = {
  transactions: "transactions.title",
  invoices: "invoices.title",
  clients: "clients.title",
  vendors: "vendors.title",
  recurring: "recurring.title",
  reconciliations: "recon.title",
  "time-entries": "time.title",
  projects: "projects.title",
  inventory: "inventory.title",
};

const ENTITY_FILTERS = [
  "transactions",
  "invoices",
  "clients",
  "vendors",
  "receipts",
  "rules",
  "recurring",
  "accounts",
  "chart-of-accounts",
  "budgets",
  "projects",
  "time-entries",
  "products",
  "inventory",
  "payroll",
  "employees",
  "reconciliations",
  "business",
];

const entityLabel = (type, t) =>
  ENTITY_KEYS[type] ? t(ENTITY_KEYS[type], type) : type;

const PAGE = 50;

export default function Activity() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState(null);

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ["audit-log", action, entityType, limit],
    queryFn: () => {
      const p = new URLSearchParams({ limit });
      if (action) p.set("action", action);
      if (entityType) p.set("entityType", entityType);
      return api.get(`/audit-log?${p}`).then((r) => r.data);
    },
  });

  const fmtTime = (ts) =>
    dayjs(ts).format(i18n.language === "es" ? "D MMM YYYY, HH:mm" : "MMM D, YYYY, h:mm A");

  return (
    <div className="max-w-[860px] mx-auto">
      <PageHeader
        title={t("activity.title")}
        subtitle={t("activity.subtitle")}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setLimit(PAGE);
              }}
              className="w-auto px-2 py-1.5"
              aria-label={t("activity.filterAction")}
            >
              <option value="">{t("activity.all")}</option>
              <option value="create">{t("activity.action_create")}</option>
              <option value="update">{t("activity.action_update")}</option>
              <option value="delete">{t("activity.action_delete")}</option>
            </Select>
            <Select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setLimit(PAGE);
              }}
              className="w-auto px-2 py-1.5"
              aria-label={t("activity.filterEntity")}
            >
              <option value="">{t("activity.all")}</option>
              {ENTITY_FILTERS.map((e) => (
                <option key={e} value={e}>
                  {entityLabel(e, t)}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <Card>
          <EmptyState
            icon="ti-history"
            title={t("activity.none")}
            message={t("activity.noneHint")}
          />
        </Card>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          <Card padding="none" className="overflow-hidden">
            {rows.map((row) => (
              <div key={row.id} className="border-b border-line last:border-b-0">
                <button
                  onClick={() =>
                    setExpanded(expanded === row.id ? null : row.id)
                  }
                  className="flex items-center gap-3 w-full px-4 py-[var(--row-y)] text-left cursor-pointer hover:bg-canvas transition-colors"
                >
                  <Badge tone={ACTION_TONES[row.action]}>
                    {t(`activity.action_${row.action}`)}
                  </Badge>
                  <span className="text-xs font-medium bg-canvas text-secondary px-2 py-0.5 rounded shrink-0">
                    {entityLabel(row.entity_type, t)}
                  </span>
                  <span
                    className={cx(
                      "flex-1 min-w-0 truncate text-md",
                      row.summary ? "text-ink" : "text-muted",
                    )}
                  >
                    {row.summary || "—"}
                  </span>
                  <span className="text-[11px] text-muted shrink-0 text-right">
                    {row.user_name && (
                      <span className="block text-secondary font-medium">
                        {row.user_name}
                      </span>
                    )}
                    {fmtTime(row.created_at)}
                  </span>
                </button>
                {expanded === row.id && row.snapshot && (
                  <div className="px-4 pb-3">
                    <div className="text-[11px] text-muted uppercase tracking-[0.5px] mb-1">
                      {t("activity.snapshot")}
                    </div>
                    <pre className="text-xs text-secondary bg-canvas rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
                      {JSON.stringify(row.snapshot, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </Card>

          {rows.length >= limit && (
            <div className="text-center mt-4">
              <Button
                onClick={() => setLimit(limit + PAGE)}
                disabled={isFetching}
              >
                {t("activity.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
