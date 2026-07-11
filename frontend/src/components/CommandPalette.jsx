import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import cx from "../lib/cx";
import useEntitlements from "../lib/useEntitlements";
import { navGroups, subPages } from "../config/nav";

const allPages = [...navGroups.flatMap((g) => g.items), ...subPages];

const RESULT_ICONS = {
  transaction: "ti-arrows-up-down",
  invoice: "ti-file-invoice",
  client: "ti-address-book",
  vendor: "ti-users",
};

function fmtMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

/**
 * Ctrl+K command palette: jump to any page, find transactions, invoices,
 * clients and vendors via /api/search. Rendered by AppLayout.
 */
export default function CommandPalette({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasFeature } = useEntitlements();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset on every open — state adjusted during render (prev-value check)
  // rather than in an effect, per react.dev/learn/you-might-not-need-an-effect
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setDebounced("");
      setActiveIndex(0);
    }
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data: results } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () =>
      api.get("/search", { params: { q: debounced } }).then((r) => r.data),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  // Pages filtered by the translated label; data hits only with a query.
  const sections = useMemo(() => {
    const ql = query.trim().toLowerCase();
    const pages = allPages
      .map((p) => ({
        kind: "page",
        key: p.to,
        to: p.to,
        icon: p.icon,
        text: t(p.label),
        locked: p.feature ? !hasFeature(p.feature) : false,
      }))
      .filter((p) => !ql || p.text.toLowerCase().includes(ql));

    const out = [];
    if (pages.length) out.push({ label: t("palette.pages"), items: pages });
    if (debounced.length >= 2 && results) {
      const groups = [
        ["transactions", "transaction", t("transactions.title")],
        ["invoices", "invoice", t("invoices.title")],
        ["clients", "client", t("clients.title")],
        ["vendors", "vendor", t("vendors.title")],
      ];
      for (const [field, kind, label] of groups) {
        const rows = (results[field] || []).map((r) => ({
          kind,
          key: `${kind}-${r.id}`,
          ...r,
        }));
        if (rows.length) out.push({ label, items: rows });
      }
    }
    return out;
  }, [query, debounced, results, t, hasFeature]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Keep the active row visible while arrowing through the list
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  function select(item) {
    onClose();
    if (item.kind === "page") navigate(item.to);
    else if (item.kind === "transaction") navigate("/transactions");
    else if (item.kind === "invoice") navigate(`/sales/invoices?invoice=${item.id}`);
    else if (item.kind === "client") navigate(`/sales/clients?client=${item.id}`);
    else if (item.kind === "vendor") navigate("/vendors");
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[activeIndex]) select(flat[activeIndex]);
    }
  }

  // Row body per result kind
  function rowContent(item) {
    if (item.kind === "page") {
      return (
        <>
          <i className={cx("ti", item.icon, "text-secondary")} aria-hidden="true" />
          <span className="flex-1 truncate">{item.text}</span>
          {item.locked && (
            <i className="ti ti-lock text-muted text-xs" aria-hidden="true" />
          )}
        </>
      );
    }
    const icon = RESULT_ICONS[item.kind];
    if (item.kind === "transaction") {
      return (
        <>
          <i className={cx("ti", icon, "text-secondary")} aria-hidden="true" />
          <span className="flex-1 truncate">
            {item.merchant || item.notes || "—"}
            <span className="text-muted ml-2 text-xs">{item.date}</span>
          </span>
          <span
            className={cx(
              "text-xs font-medium",
              item.type === "income" ? "text-income" : "text-expense",
            )}
          >
            {item.type === "income" ? "+" : "−"}
            {fmtMoney(item.total_amount)}
          </span>
        </>
      );
    }
    if (item.kind === "invoice") {
      return (
        <>
          <i className={cx("ti", icon, "text-secondary")} aria-hidden="true" />
          <span className="flex-1 truncate">
            {item.invoice_number}
            <span className="text-muted ml-2 text-xs">{item.client_name}</span>
          </span>
          <span className="text-xs text-muted">{fmtMoney(item.total)}</span>
        </>
      );
    }
    // client / vendor
    return (
      <>
        <i className={cx("ti", icon, "text-secondary")} aria-hidden="true" />
        <span className="flex-1 truncate">
          {item.name}
          {item.billing_email && (
            <span className="text-muted ml-2 text-xs">{item.billing_email}</span>
          )}
        </span>
      </>
    );
  }

  let index = -1;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.pages")}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface border border-line shadow-card rounded-card overflow-hidden fade-in">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 border-b border-line">
          <i className="ti ti-search text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent py-3.5 text-md text-ink placeholder:text-muted outline-none"
          />
          <kbd className="hidden sm:block text-[10px] text-muted border border-line rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {flat.length === 0 && (
            <div className="px-4 py-6 text-md text-muted text-center">
              {t("palette.noResults", { q: query.trim() })}
            </div>
          )}
          {sections.map((section) => (
            <div key={section.label}>
              <div className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-[0.8px] uppercase text-muted">
                {section.label}
              </div>
              {section.items.map((item) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={item.key}
                    data-index={i}
                    onClick={() => select(item)}
                    onMouseMove={() => setActiveIndex(i)}
                    className={cx(
                      "flex items-center gap-2.5 w-full text-left px-4 py-2 text-md text-ink cursor-pointer",
                      i === activeIndex && "bg-canvas",
                    )}
                  >
                    {rowContent(item)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
