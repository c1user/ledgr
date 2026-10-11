import { useTranslation } from "react-i18next";
import { Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import * as haptics from "../../native/haptics.js";

/**
 * Bottom sheet that maps one import role (date, description, amount, …) to
 * a CSV header (ROADMAP-V6 2.15, spec §2.12). Every header is a 56px row
 * showing its name and the first non-empty cell of that column (`samples`,
 * from @abaco/csv columnSamples) so a bank's cryptic headers are
 * recognisable. `allowNone` adds a leading "— not mapped —" row for the
 * optional roles.
 *   open, title, fields: string[], samples: { [field]: string },
 *   value: string ("" = unmapped), allowNone, onSelect(field), onClose
 */
export default function ColumnPickerSheet({
  open,
  title,
  fields,
  samples,
  value,
  allowNone = false,
  onSelect,
  onClose,
}) {
  const { t } = useTranslation();
  const list = Array.isArray(fields) ? fields : [];
  const sampleOf = (field) => (samples && samples[field]) || "";

  const pick = (field) => {
    haptics.tap();
    onSelect?.(field);
    onClose?.();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <ul className="-mx-2 flex flex-col">
        {allowNone && (
          <li>
            <button
              type="button"
              onClick={() => pick("")}
              aria-pressed={value === ""}
              className={cx(
                "flex w-full min-h-[56px] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                value === "" ? "bg-brand-light" : "hover:bg-canvas",
              )}
            >
              <span className="min-w-0 flex-1 text-md text-muted">
                {t("transactions.importUnmapped")}
              </span>
              {value === "" && (
                <i
                  className="ti ti-check shrink-0 text-brand"
                  aria-hidden="true"
                />
              )}
            </button>
          </li>
        )}
        {list.map((field) => {
          const selected = field === value;
          const sample = sampleOf(field);
          return (
            <li key={field}>
              <button
                type="button"
                onClick={() => pick(field)}
                aria-pressed={selected}
                className={cx(
                  "flex w-full min-h-[56px] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                  selected ? "bg-brand-light" : "hover:bg-canvas",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-md font-medium text-ink">
                    {field}
                  </span>
                  {sample && (
                    <span className="block truncate text-xs text-muted">
                      {t("mobile.accounts.import.sample", { value: sample })}
                    </span>
                  )}
                </span>
                {selected && (
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
    </Modal>
  );
}
