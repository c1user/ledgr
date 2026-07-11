import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import cx from "../lib/cx";
import useEntitlements from "../lib/useEntitlements";

// `withNew` items navigate with ?new=<nonce> — a fresh value every time so
// the target page's param sync re-fires even if the URL is otherwise
// unchanged. Consumed by Transactions (add modal) and Invoices (builder).
const ACTIONS = [
  {
    to: "/transactions",
    withNew: true,
    icon: "ti-arrows-up-down",
    label: "dashboard.addTransaction",
  },
  {
    to: "/sales/invoices",
    withNew: true,
    icon: "ti-file-invoice",
    label: "invoices.newInvoice",
    feature: "invoicing",
  },
  {
    to: "/receipts",
    withNew: false,
    icon: "ti-receipt",
    label: "dashboard.scanReceipt",
  },
];

/** Header "+" menu: create the common things from any page. */
export default function QuickAdd() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasFeature } = useEntitlements();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("dashboard.quickActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center justify-center w-7 h-7 rounded-md bg-brand text-on-brand hover:bg-brand-hover cursor-pointer"
      >
        <i className="ti ti-plus" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 z-[160] w-52 py-1.5 bg-surface border border-line rounded-card shadow-card fade-in"
          >
            {ACTIONS.map((action) => {
              const locked = action.feature && !hasFeature(action.feature);
              return (
                <button
                  key={action.to}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    navigate(
                      action.withNew
                        ? `${action.to}?new=${Date.now()}`
                        : action.to,
                    );
                  }}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2 text-md text-ink hover:bg-canvas cursor-pointer text-left"
                >
                  <i
                    className={cx("ti", action.icon, "text-secondary")}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{t(action.label)}</span>
                  {locked && (
                    <i className="ti ti-lock text-muted text-xs" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
