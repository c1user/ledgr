import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Card } from "@abaco/ui";
import { formatMoney, formatReceiptDate } from "../receipts/receiptFormat.js";

// Literal key maps — never build i18n keys by interpolation.
const REASON_KEYS = {
  noDate: "mobile.accounts.import.reasonNoDate",
  badDate: "mobile.accounts.import.reasonBadDate",
  noAmount: "mobile.accounts.import.reasonNoAmount",
  zeroAmount: "mobile.accounts.import.reasonZeroAmount",
};
const WARNING_KEYS = {
  allIncome: "mobile.accounts.import.allIncomeWarning",
  allExpense: "mobile.accounts.import.allExpenseWarning",
  duplicatesInFile: "mobile.accounts.import.duplicatesInFile",
  truncated: "mobile.accounts.import.truncated",
  bodyTooLarge: "mobile.accounts.import.bodyTooLarge",
};

/** How many skipped rows the expandable list shows at most. */
const MAX_SKIPPED_SHOWN = 25;

/**
 * Live summary of what an import will do (ROADMAP-V6 2.15, spec §2.13),
 * recomputed by the page on every mapping/option change and announced
 * politely. `stats`/`skipped`/`warnings` come straight from @abaco/csv
 * buildImportRows; the page may append "bodyTooLarge" to `warnings`.
 *   stats: { total, valid, income: { count, sum }, expense: { count, sum },
 *            minDate, maxDate, duplicatesInFile, truncated }
 *   warnings: string[]   skipped: [{ row, reason }]   currency, lang
 */
export default function ImportSummary({
  stats,
  warnings,
  skipped,
  currency,
  lang,
}) {
  const { t } = useTranslation();
  const [showSkipped, setShowSkipped] = useState(false);
  if (!stats) return null;

  const skippedRows = Array.isArray(skipped) ? skipped : [];
  const warningList = Array.isArray(warnings) ? warnings : [];
  const money = (n) => formatMoney(n ?? 0, currency, lang) ?? "—";
  const warningParams = {
    duplicatesInFile: { count: stats.duplicatesInFile },
    truncated: { count: stats.truncated },
  };

  return (
    <Card padding="md" aria-live="polite">
      <p className="text-md font-semibold text-ink">
        {t("mobile.accounts.import.rowsReady", {
          valid: stats.valid,
          total: stats.total,
        })}
      </p>
      <ul className="mt-1 space-y-0.5 text-md text-secondary">
        <li className="flex items-center gap-2">
          <i className="ti ti-arrow-down-left text-income" aria-hidden="true" />
          {t("mobile.accounts.import.summaryIncome", {
            count: stats.income?.count ?? 0,
            sum: money(stats.income?.sum),
          })}
        </li>
        <li className="flex items-center gap-2">
          <i className="ti ti-arrow-up-right text-expense" aria-hidden="true" />
          {t("mobile.accounts.import.summaryExpense", {
            count: stats.expense?.count ?? 0,
            sum: money(stats.expense?.sum),
          })}
        </li>
        {stats.minDate && stats.maxDate && (
          <li className="flex items-center gap-2">
            <i className="ti ti-calendar text-muted" aria-hidden="true" />
            {t("mobile.accounts.import.summaryRange", {
              from: formatReceiptDate(stats.minDate),
              to: formatReceiptDate(stats.maxDate),
            })}
          </li>
        )}
      </ul>

      {skippedRows.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <Badge tone="expense">
              {t("mobile.accounts.import.skippedRows", {
                count: skippedRows.length,
              })}
            </Badge>
            <button
              type="button"
              aria-expanded={showSkipped}
              onClick={() => setShowSkipped((v) => !v)}
              className="flex min-h-[44px] items-center gap-1 px-2 text-md font-medium text-brand"
            >
              {t(
                showSkipped
                  ? "mobile.accounts.import.hideSkipped"
                  : "mobile.accounts.import.showSkipped",
              )}
              <i
                className={
                  showSkipped ? "ti ti-chevron-up" : "ti ti-chevron-down"
                }
                aria-hidden="true"
              />
            </button>
          </div>
          {showSkipped && (
            <ul className="mt-1 divide-y divide-line text-xs text-secondary">
              {skippedRows.slice(0, MAX_SKIPPED_SHOWN).map((s) => (
                <li
                  key={s.row}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span>
                    {t("mobile.accounts.import.rowLabel", { row: s.row })}
                  </span>
                  <span className="text-muted">
                    {t(REASON_KEYS[s.reason] || REASON_KEYS.badDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warningList.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warningList
            .filter((w) => WARNING_KEYS[w])
            .map((w) => (
              <li
                key={w}
                className="flex items-start gap-2 text-xs text-secondary"
              >
                <i
                  className="ti ti-alert-triangle mt-px shrink-0 text-expense"
                  aria-hidden="true"
                />
                <span>{t(WARNING_KEYS[w], warningParams[w])}</span>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
