import { useTranslation } from "react-i18next";
import { Badge } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import {
  TYPE_ICONS,
  TYPE_KEYS,
  balanceTone,
  formatMoney,
  summaryOrZero,
} from "./accountFormat.js";

const ROW_CLASS = "flex w-full min-h-[56px] items-center gap-3 p-3 text-left";

/** Literal class map: balance colour by tone (no class interpolation). */
const TONE_CLASS = {
  income: "text-income",
  expense: "text-expense",
};

/**
 * One row of the Accounts list (the AccountPicker row recipe): 36px type
 * tile, name, "type · currency" (+ Inactive badge), live balance in the
 * ACCOUNT's currency toned by sign, chevron. `as="div"` renders the same row
 * static (no tap, no chevron) — the CSV import page shows its target with it.
 *   account: { id, name, type, currency, current_balance (string), is_active }
 *   lang: i18n.language (Intl locale for the balance)   onPress()
 */
export default function AccountRow({
  account,
  lang,
  onPress,
  inactive = false,
  as = "button",
}) {
  const { t } = useTranslation();
  const name = account?.name || "";
  const typeLabel = t(TYPE_KEYS[account?.type] || "accounts.typeCurrent");
  const tone = balanceTone(account?.current_balance);
  const balance = formatMoney(
    summaryOrZero(account?.current_balance),
    account?.currency,
    lang,
  );
  const subtitle = [typeLabel, account?.currency].filter(Boolean).join(" · ");
  const label = `${name}, ${typeLabel}, ${balance}`;

  const content = (
    <>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken">
        <i
          className={cx(
            "ti text-xl text-muted",
            TYPE_ICONS[account?.type] || "ti-building-bank",
          )}
          aria-hidden="true"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-md font-medium text-ink">{name}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{subtitle}</span>
          {inactive && (
            <Badge tone="neutral" className="shrink-0">
              {t("accounts.inactive")}
            </Badge>
          )}
        </div>
      </div>

      <span className={cx("shrink-0 text-md font-semibold", TONE_CLASS[tone])}>
        {balance}
      </span>

      {as !== "div" && (
        <i
          className="ti ti-chevron-right shrink-0 text-muted"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (as === "div") {
    return (
      <div role="group" aria-label={label} className={ROW_CLASS}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className={cx(ROW_CLASS, "active:bg-sunken")}
    >
      {content}
    </button>
  );
}
