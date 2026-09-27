import { useTranslation } from "react-i18next";
import { Button, Input } from "@abaco/ui";
import { sanitizeAmountInput } from "../../lib/booking.js";

/**
 * Editable receipt line items (description + total). Extra fields the AI
 * returned (quantity, unit_price) are carried through untouched.
 *   items: [{ description, quantity, unit_price, total }]
 *   onChange(items)
 */
export default function LineItemsEditor({ items, onChange, disabled }) {
  const { t } = useTranslation();
  const list = Array.isArray(items) ? items : [];

  const update = (i, patch) =>
    onChange(list.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...list,
      { description: "", quantity: null, unit_price: null, total: "" },
    ]);

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-secondary">
          {t("mobile.review.lineItems")}
        </span>
        {list.length === 0 && (
          <span className="text-[11px] text-muted">
            {t("mobile.review.noneDetected")}
          </span>
        )}
      </div>

      {list.map((item, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_96px_44px] gap-2 mb-2 items-center"
        >
          <Input
            value={item.description || ""}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder={t("receipts.itemDescription")}
            aria-label={t("receipts.itemDescription")}
            disabled={disabled}
          />
          <Input
            type="text"
            inputMode="decimal"
            value={
              item.total === null || item.total === undefined ? "" : item.total
            }
            onChange={(e) =>
              update(i, { total: sanitizeAmountInput(e.target.value) })
            }
            placeholder="0.00"
            aria-label={t("common.total")}
            className="text-right"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            aria-label={t("common.delete")}
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger-bg text-danger disabled:opacity-60"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}

      <Button icon="ti-plus" onClick={add} disabled={disabled}>
        {t("mobile.review.addLineItem")}
      </Button>
    </div>
  );
}
