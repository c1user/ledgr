import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, EmptyState, Input, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { groupCategories, searchCategories } from "../../lib/booking.js";

function ColorDot({ color, className }) {
  return (
    <span
      className={cx(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        className,
      )}
      style={{ backgroundColor: color || "var(--text-muted)" }}
      aria-hidden="true"
    />
  );
}

function CategoryRow({ category, selected, subtitle, badge, onClick, bold }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cx(
          "flex w-full min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
          selected ? "bg-brand-light" : "hover:bg-canvas",
        )}
      >
        <ColorDot color={category.color} />
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block truncate text-md text-ink",
              bold ? "font-semibold" : "font-normal",
            )}
          >
            {category.name}
          </span>
          {subtitle && (
            <span className="block truncate text-[11px] text-muted">
              {subtitle}
            </span>
          )}
        </span>
        {badge}
        {selected && (
          <i className="ti ti-check shrink-0 text-brand" aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

/**
 * Full-height category sheet. `categories` are already filtered by type and
 * is_active (coaToCategories(filterActiveCoa(groups), t)); `suggestedId` is
 * the rule-matched category (lib/booking.js suggestCategory) shown on top.
 *   open, onClose, categories, value, onChange(category), suggestedId
 */
export default function CategoryPicker({
  open,
  onClose,
  categories,
  value,
  onChange,
  suggestedId,
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const list = useMemo(
    () => (Array.isArray(categories) ? categories : []),
    [categories],
  );

  const suggested = useMemo(
    () => (suggestedId ? list.find((c) => c.id === suggestedId) : null),
    [list, suggestedId],
  );
  const searching = query.trim().length > 0;
  const matches = useMemo(
    () => (searching ? searchCategories(list, query) : []),
    [list, query, searching],
  );
  const sections = useMemo(
    () => (searching ? [] : groupCategories(list)),
    [list, searching],
  );

  const pick = (category) => {
    onChange(category);
    setQuery("");
    onClose();
  };
  const close = () => {
    setQuery("");
    onClose();
  };

  const suggestedBadge = (
    <Badge tone="brand" icon="ti-sparkles">
      {t("mobile.review.book.suggested")}
    </Badge>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("mobile.review.book.selectCategory")}
      size="full"
    >
      {/* Search stays put while the list scrolls under it. */}
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 bg-surface px-5 pt-4 pb-3">
        <Input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("mobile.review.book.searchCategory")}
          aria-label={t("mobile.review.book.searchCategory")}
          autoComplete="off"
        />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="ti-category"
          title={t("mobile.review.book.noCategory")}
          className="py-8"
        />
      ) : searching ? (
        matches.length === 0 ? (
          <EmptyState
            icon="ti-search-off"
            title={t("mobile.review.book.noCategory")}
            className="py-8"
          />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {matches.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                selected={c.id === value}
                subtitle={c.parent_name}
                badge={c.id === suggestedId ? suggestedBadge : null}
                onClick={() => pick(c)}
              />
            ))}
          </ul>
        )
      ) : (
        <div className="-mx-2 flex flex-col gap-3">
          {suggested && (
            <ul className="flex flex-col">
              <CategoryRow
                category={suggested}
                selected={suggested.id === value}
                subtitle={suggested.parent_name}
                badge={suggestedBadge}
                onClick={() => pick(suggested)}
                bold
              />
            </ul>
          )}
          {sections.map((section) => (
            <ul key={section.key} className="flex flex-col">
              {section.parent ? (
                <CategoryRow
                  category={section.parent}
                  selected={section.parent.id === value}
                  onClick={() => pick(section.parent)}
                  bold
                />
              ) : (
                section.name && (
                  <li className="px-2 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {section.name}
                  </li>
                )
              )}
              {section.items.map((c) => (
                <li key={c.id} className="pl-5">
                  <ul>
                    <CategoryRow
                      category={c}
                      selected={c.id === value}
                      onClick={() => pick(c)}
                    />
                  </ul>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </Modal>
  );
}
