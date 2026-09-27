import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import PickerTrigger from "./PickerTrigger.jsx";

// GET /api/accounts → type: 'savings'|'current'|'credit'|'cash'|'loan'
const TYPE_KEYS = {
  current: "accounts.typeCurrent",
  savings: "accounts.typeSavings",
  credit: "accounts.typeCredit",
  cash: "accounts.typeCash",
  loan: "accounts.typeLoan",
};
const TYPE_ICONS = {
  current: "ti-building-bank",
  savings: "ti-pig-money",
  credit: "ti-credit-card",
  cash: "ti-cash",
  loan: "ti-file-percent",
};

/**
 * Bottom-sheet picker over the ACTIVE bank accounts (the caller filters
 * is_active). Shows type + live balance per row.
 *   accounts: [{ id, name, type, current_balance (string), currency }]
 *   value: account id | ""   onChange(id)   fmt(number) → currency string
 */
export default function AccountPicker({
  id,
  accounts,
  value,
  onChange,
  fmt,
  disabled,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const list = Array.isArray(accounts) ? accounts : [];
  const selected = list.find((a) => a.id === value) || null;

  const pick = (account) => {
    onChange(account.id);
    setOpen(false);
  };

  return (
    <>
      <PickerTrigger
        id={id}
        empty={!selected}
        placeholder={t("mobile.review.book.selectAccount")}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {selected && (
          <span className="flex items-center gap-2">
            <i
              className={cx(
                "ti text-muted",
                TYPE_ICONS[selected.type] || "ti-building-bank",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{selected.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted">
              {fmt(selected.current_balance)}
            </span>
          </span>
        )}
      </PickerTrigger>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("mobile.review.book.selectAccount")}
        size="md"
      >
        {list.length === 0 ? (
          <EmptyState
            icon="ti-building-bank"
            title={t("mobile.review.book.noAccounts")}
            className="py-8"
          />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {list.map((account) => {
              const isSelected = account.id === value;
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => pick(account)}
                    aria-pressed={isSelected}
                    className={cx(
                      "flex w-full min-h-[56px] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                      isSelected ? "bg-brand-light" : "hover:bg-canvas",
                    )}
                  >
                    <i
                      className={cx(
                        "ti text-xl shrink-0",
                        TYPE_ICONS[account.type] || "ti-building-bank",
                        isSelected ? "text-brand" : "text-muted",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-medium text-ink">
                        {account.name}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {t(TYPE_KEYS[account.type] || "accounts.typeCurrent")}
                      </span>
                    </span>
                    <span className="shrink-0 text-md text-secondary">
                      {fmt(account.current_balance)}
                    </span>
                    {isSelected && (
                      <i
                        className="ti ti-check shrink-0 text-brand"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
