import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Button, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { toast } from "@abaco/ui/feedback";
import api from "../../lib/api.js";
import { describeError } from "../../lib/apiErrors.js";
import { useOnline } from "../../lib/useOnline.js";
import { runExport } from "../../lib/csvExport.js";
import * as haptics from "../../native/haptics.js";
import { isNative } from "../../native/platform.js";

const ERR_OPTS = { rateLimitedKey: "mobile.common.rateLimited" };

/** Above this many rows the sheet nudges the user towards a date range. */
const LARGE_THRESHOLD = 5000;

const RANGE_OPTIONS = [
  { value: "current", key: "mobile.accounts.export.rangeCurrent" },
  { value: "thisMonth", key: "mobile.accounts.export.rangeThisMonth" },
  { value: "thisYear", key: "mobile.accounts.export.rangeThisYear" },
  { value: "all", key: "mobile.accounts.export.rangeAll" },
];

const TYPE_KEYS = { income: "common.income", expense: "common.expense" };

/** True when the detail list is narrowed by a type or a date (§2.10). */
const hasActiveFilters = (filters) =>
  !!(filters?.from || filters?.to || filters?.type);

const fmtDate = (v) => dayjs(v).format("MMM D, YYYY");

/**
 * Export sheet (ROADMAP-V6 2.15, spec §2.10): picks a range preset and hands
 * the server-generated CSV to the share sheet (device) or a download (web).
 *   open, account { id, name }, filters { type, from, to }, total (rows the
 *   detail list reports for `filters`), currency (accepted; reserved for a
 *   future size estimate), onClose
 * "As filtered" is offered — and preselected — only while a filter is active;
 * otherwise "This month" is the default so the sheet opens without the
 * large-file warning.
 */
export default function ExportSheet({
  open,
  account,
  filters,
  total,
  onClose,
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const native = isNative();
  const filtered = hasActiveFilters(filters);
  const options = filtered
    ? RANGE_OPTIONS
    : RANGE_OPTIONS.filter((o) => o.value !== "current");
  const defaultRange = filtered ? "current" : "thisMonth";
  // null = "the default for the current filters"; reset whenever the sheet
  // closes so reopening starts fresh.
  const [chosen, setChosen] = useState(null);
  const range =
    chosen && options.some((o) => o.value === chosen) ? chosen : defaultRange;
  const count = Number(total) || 0;

  const finish = () => {
    setChosen(null);
    onClose?.();
  };

  const exportMutation = useMutation({
    mutationFn: () =>
      runExport({
        api,
        account,
        range,
        filters,
        title: t("mobile.accounts.export.title"),
      }),
    onSuccess: (outcome) => {
      if (outcome === "shared") {
        haptics.success();
        finish();
      } else if (outcome === "downloaded") {
        toast.success(t("mobile.accounts.export.ready"));
        finish();
      } else if (outcome === "copied") {
        toast.info(t("mobile.accounts.export.copied"));
        finish();
      } else if (outcome === "empty") {
        toast.info(t("mobile.accounts.export.nothing"));
      }
      // "cancelled": the user closed the share sheet — say nothing.
    },
    onError: (err) => {
      haptics.error();
      toast.error(describeError(err, t, ERR_OPTS).text);
    },
  });
  const pending = exportMutation.isPending;

  const close = () => {
    if (pending) return;
    finish();
  };

  const typeKey = TYPE_KEYS[filters?.type];
  const showLarge = range === "all" || count > LARGE_THRESHOLD;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("mobile.accounts.export.title")}
      size="md"
      footer={
        <Button
          variant="primary"
          size="lg"
          full
          icon={native ? "ti-share" : "ti-download"}
          loading={pending}
          disabled={!online || pending}
          onClick={() => exportMutation.mutate()}
        >
          {t(
            native
              ? "mobile.accounts.export.share"
              : "mobile.accounts.export.download",
          )}
        </Button>
      }
    >
      <p className="mb-3 truncate text-md text-muted">
        {t("mobile.accounts.export.scope", { name: account?.name || "" })}
      </p>

      <div
        role="radiogroup"
        aria-label={t("mobile.accounts.export.title")}
        className="divide-y divide-line overflow-hidden rounded-card border border-line bg-canvas"
      >
        {options.map((opt) => {
          const selected = opt.value === range;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => {
                haptics.tap();
                setChosen(opt.value);
              }}
              className={cx(
                "flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors active:bg-sunken disabled:opacity-60",
                selected ? "text-ink" : "text-secondary",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-md font-medium">
                  {t(opt.key)}
                </span>
                {opt.value === "current" && (filters?.from || filters?.to) && (
                  <span className="block truncate text-xs text-muted">
                    {filters.from ? fmtDate(filters.from) : "…"}
                    {" – "}
                    {filters.to ? fmtDate(filters.to) : "…"}
                  </span>
                )}
              </span>
              <i
                className={cx(
                  "ti shrink-0 text-lg",
                  selected
                    ? "ti-circle-check text-brand"
                    : "ti-circle text-muted",
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {range === "current" && (
        <div className="mt-3 flex flex-col gap-1 text-sm text-secondary">
          {typeKey && (
            <p>
              {t("common.type")}: {t(typeKey)}
            </p>
          )}
          <p>{t("mobile.accounts.export.rowCount", { count })}</p>
        </div>
      )}

      {showLarge && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <i
            className="ti ti-alert-triangle mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{t("mobile.accounts.export.large")}</span>
        </p>
      )}

      {/* The CSV is server-generated: nothing is queued for later. */}
      {!online && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <i className="ti ti-wifi-off mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t("mobile.accounts.export.offline")}</span>
        </p>
      )}
    </Modal>
  );
}
