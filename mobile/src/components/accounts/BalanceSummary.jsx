import { useTranslation } from "react-i18next";
import { Card } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { balanceTone, formatMoney, summaryOrZero } from "./accountFormat.js";

/** Literal class map: total colour by tone (no class interpolation). */
const TONE_CLASS = {
  income: "text-income",
  expense: "text-expense",
};

/** The web's three secondary cards, with literal label keys. */
const TILES = [
  { field: "bank_balance", labelKey: "accounts.bank" },
  { field: "credit_balance", labelKey: "accounts.credit" },
  { field: "cash_balance", labelKey: "accounts.cash" },
];

/**
 * Three tiles share ~98 px each at 375 px, which fits "-$9,999.99" (10
 * characters) at text-md. A longer value would be clipped — never acceptable
 * for a balance — so the strip stacks into label / value rows instead.
 */
const WIDE_VALUE_CHARS = 10;
const STRIP_CLASS = {
  grid: "mt-3 grid grid-cols-3 gap-2",
  stack: "mt-3 divide-y divide-line",
};

/**
 * GET /api/accounts/summary/balances as a card: total balance (toned by
 * sign) over the Bank / Credit / Cash tiles. The SUMs arrive as NUMERIC
 * strings, or null when there is nothing to sum (→ 0, like the web's
 * `val || 0`), and are shown in the BUSINESS currency, as the API sums them.
 *   balances: { total_balance, bank_balance, credit_balance, cash_balance,
 *               account_count }
 */
export default function BalanceSummary({ balances, currency = "USD", lang }) {
  const { t } = useTranslation();
  const b = balances || {};
  const total = summaryOrZero(b.total_balance);
  const tiles = TILES.map(({ field, labelKey }) => ({
    field,
    labelKey,
    value: formatMoney(summaryOrZero(b[field]), currency, lang) ?? "—",
  }));
  const stacked = tiles.some((tile) => tile.value.length > WIDE_VALUE_CHARS);

  return (
    <Card padding="md">
      <div className="text-xs text-muted">{t("accounts.totalBalance")}</div>
      <div
        className={cx(
          "text-2xl font-semibold tabular-nums",
          TONE_CLASS[balanceTone(total)],
        )}
      >
        {formatMoney(total, currency, lang)}
      </div>

      <div className={stacked ? STRIP_CLASS.stack : STRIP_CLASS.grid}>
        {tiles.map(({ field, labelKey, value }) =>
          stacked ? (
            <div
              key={field}
              className="flex items-baseline justify-between gap-3 py-1.5"
            >
              <span className="text-xs text-muted">{t(labelKey)}</span>
              <span className="text-md font-medium text-ink tabular-nums">
                {value}
              </span>
            </div>
          ) : (
            <div key={field} className="min-w-0">
              <div className="truncate text-xs text-muted">{t(labelKey)}</div>
              <div className="text-md font-medium text-ink tabular-nums">
                {value}
              </div>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
