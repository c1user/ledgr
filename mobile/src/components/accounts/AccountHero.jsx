import { useTranslation } from "react-i18next";
import { Badge, Card } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import {
  TYPE_ICONS,
  TYPE_KEYS,
  balanceTone,
  formatMoney,
  summaryOrZero,
  toNumber,
} from "./accountFormat.js";

/** Literal class map: colour by tone (no class interpolation). */
const TONE_CLASS = {
  income: "text-income",
  expense: "text-expense",
};

function Row({ label, value, className = "text-ink" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-md text-muted">{label}</dt>
      <dd
        className={cx(
          "min-w-0 truncate text-right text-md font-medium",
          className,
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Account detail header card: type tile + "type · currency" (+ Inactive
 * badge), the live balance in the ACCOUNT's currency toned by sign, then
 * the totals strip. `account` is the fresh GET /api/accounts/:id row (or
 * the list row as placeholder); `listRow` is the cached GET /api/accounts
 * row, the only one carrying transaction_count / total_income /
 * total_expenses (the detail endpoint lacks them). Total In / Total Out
 * show only when either is > 0 (the web Accounts page rule).
 */
export default function AccountHero({ account, listRow, lang }) {
  const { t } = useTranslation();
  const a = account || {};
  const typeLabel = t(TYPE_KEYS[a.type] || "accounts.typeCurrent");
  const subtitle = [typeLabel, a.currency].filter(Boolean).join(" · ");
  const inactive = a.is_active === false;
  const tone = balanceTone(a.current_balance);
  const balance = formatMoney(
    summaryOrZero(a.current_balance),
    a.currency,
    lang,
  );

  const count = toNumber(listRow?.transaction_count ?? a.transaction_count);
  const totalIn = toNumber(listRow?.total_income ?? a.total_income) ?? 0;
  const totalOut = toNumber(listRow?.total_expenses ?? a.total_expenses) ?? 0;
  const showTotals = totalIn > 0 || totalOut > 0;

  return (
    <Card padding="md">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken">
          <i
            className={cx(
              "ti text-xl text-muted",
              TYPE_ICONS[a.type] || "ti-building-bank",
            )}
            aria-hidden="true"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{subtitle}</span>
          {inactive && (
            <Badge tone="neutral" className="shrink-0">
              {t("accounts.inactive")}
            </Badge>
          )}
        </div>
      </div>

      <div className={cx("mt-2 text-3xl font-semibold", TONE_CLASS[tone])}>
        {balance}
      </div>

      <dl className="mt-3 divide-y divide-line">
        <Row
          label={t("accounts.transactions")}
          value={count === null ? "—" : String(count)}
        />
        {showTotals && (
          <>
            <Row
              label={t("accounts.totalIn")}
              value={`+${formatMoney(totalIn, a.currency, lang)}`}
              className={TONE_CLASS.income}
            />
            <Row
              label={t("accounts.totalOut")}
              // U+2212 minus, the same glyph the transaction rows use.
              value={`−${formatMoney(totalOut, a.currency, lang)}`}
              className={TONE_CLASS.expense}
            />
          </>
        )}
      </dl>
    </Card>
  );
}
