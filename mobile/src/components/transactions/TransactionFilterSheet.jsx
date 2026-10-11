import { useTranslation } from "react-i18next";
import { Field, FilterSheet, Input } from "@abaco/ui";
import { toast } from "@abaco/ui/feedback";
import { normalizeTxRange } from "../../lib/transactionsPaging.js";

/**
 * Date-range filter sheet for an account's transactions (ROADMAP-V6 2.15).
 * Edits a DRAFT the page owns; nothing refetches until Apply. A reversed
 * range is swapped on Apply (with a toast) instead of being rejected.
 *   open, onClose()            sheet visibility
 *   draft: { from, to }        YYYY-MM-DD | ""
 *   onChange(nextDraft)        keystroke updates
 *   onApply({ from, to })      normalised range → the page writes the URL
 *   onClear()                  the page drops both dates
 */
export default function TransactionFilterSheet({
  open,
  draft,
  onChange,
  onApply,
  onClear,
  onClose,
}) {
  const { t } = useTranslation();
  const value = draft || { from: "", to: "" };

  const apply = () => {
    const { from, to, swapped } = normalizeTxRange(value);
    if (swapped) toast.info(t("mobile.transactions.rangeSwapped"));
    onApply?.({ from, to });
  };

  return (
    <FilterSheet
      open={open}
      onClose={onClose}
      title={t("mobile.transactions.filtersTitle")}
      onApply={apply}
      onClear={onClear}
      applyLabel={t("common.apply")}
      clearLabel={t("transactions.clear")}
      buttonSize="lg"
    >
      <Field label={t("common.dateFrom")} htmlFor="tx-filter-from">
        <Input
          id="tx-filter-from"
          type="date"
          value={value.from || ""}
          onChange={(e) => onChange?.({ ...value, from: e.target.value })}
          className="min-h-[44px]"
        />
      </Field>
      <Field label={t("common.dateTo")} htmlFor="tx-filter-to" className="mb-0">
        <Input
          id="tx-filter-to"
          type="date"
          value={value.to || ""}
          onChange={(e) => onChange?.({ ...value, to: e.target.value })}
          className="min-h-[44px]"
        />
      </Field>
    </FilterSheet>
  );
}
