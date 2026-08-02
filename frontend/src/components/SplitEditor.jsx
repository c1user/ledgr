import cx from "../lib/cx";
import { Button, Input, Select } from "./ui";

// Editable list of category/amount split lines with a running
// balanced/remaining indicator. Shared by the add/edit transaction
// modal and the receipt "create transaction" flow.
export default function SplitEditor({
  splits,
  setSplits,
  totalAmount,
  categories,
  fmt,
  t,
}) {
  const remaining =
    parseFloat(totalAmount || 0) -
    splits.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

  const addSplit = () =>
    setSplits([...splits, { categoryId: "", amount: "", notes: "" }]);

  const updateSplit = (i, field, value) =>
    setSplits(
      splits.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    );

  const removeSplit = (i) => setSplits(splits.filter((_, idx) => idx !== i));

  return (
    <div className="mt-2">
      {splits.map((split, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_110px_auto] gap-2 mb-2 items-center"
        >
          <Select
            value={split.categoryId}
            onChange={(e) => updateSplit(i, "categoryId", e.target.value)}
          >
            <option value="">{t("transactions.selectCategory")}</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            placeholder="0.00"
            value={split.amount}
            onChange={(e) => updateSplit(i, "amount", e.target.value)}
            step="0.01"
            min="0"
          />
          <button
            type="button"
            onClick={() => removeSplit(i)}
            className="flex items-center justify-center w-[30px] h-[30px] rounded-md bg-danger-bg text-danger cursor-pointer"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between mt-2">
        <Button size="sm" icon="ti-plus" onClick={addSplit}>
          {t("transactions.addSplitLine")}
        </Button>
        <div
          className={cx(
            "text-xs font-medium",
            Math.abs(remaining) < 0.01 ? "text-income" : "text-expense",
          )}
        >
          {Math.abs(remaining) < 0.01
            ? t("transactions.splitsBalanced")
            : t("transactions.remaining", { amount: fmt(remaining) })}
        </div>
      </div>
    </div>
  );
}
