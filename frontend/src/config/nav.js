// Sidebar nav, organized into labelled sections. Groups without a `label`
// (dashboard at the top, AI/settings at the bottom) render as ungrouped rows.
// `feature` marks plan-gated items: they stay visible (upsell) with a lock
// badge when the business plan doesn't include the feature.
// Shared by AppLayout (sidebar) and CommandPalette (page jump).
export const navGroups = [
  {
    items: [
      { to: "/dashboard", icon: "ti-layout-dashboard", label: "nav.dashboard" },
      {
        to: "/sales",
        icon: "ti-file-invoice",
        label: "nav.sales",
        feature: "invoicing",
      },
    ],
  },
  {
    label: "nav.groupExpenses",
    items: [
      {
        to: "/vendors",
        icon: "ti-users",
        label: "nav.vendors",
        feature: "vendors",
      },
      { to: "/receipts", icon: "ti-receipt", label: "nav.receipts" },
      {
        to: "/payroll",
        icon: "ti-businessplan",
        label: "nav.payroll",
        feature: "payroll",
      },
    ],
  },
  {
    label: "nav.groupBanking",
    items: [
      {
        to: "/transactions",
        icon: "ti-arrows-up-down",
        label: "nav.transactions",
      },
      { to: "/accounts", icon: "ti-building-bank", label: "nav.accounts" },
    ],
  },
  {
    label: "nav.groupAccounting",
    items: [
      {
        to: "/chart-of-accounts",
        icon: "ti-list-tree",
        label: "nav.chartOfAccounts",
      },
      { to: "/journal", icon: "ti-notebook", label: "nav.journal" },
      {
        to: "/budget",
        icon: "ti-wallet",
        label: "nav.budget",
        feature: "budgets",
      },
      { to: "/reports", icon: "ti-chart-bar", label: "nav.reports" },
    ],
  },
  {
    label: "nav.groupOperations",
    items: [
      {
        to: "/projects",
        icon: "ti-briefcase",
        label: "nav.projects",
        feature: "projects",
      },
      {
        to: "/inventory",
        icon: "ti-box",
        label: "nav.inventory",
        feature: "inventory",
      },
    ],
  },
  {
    items: [
      {
        to: "/ai",
        icon: "ti-sparkles",
        label: "nav.aiChat",
        feature: "ai_chat",
      },
      {
        to: "/team",
        icon: "ti-users-group",
        label: "nav.team",
        feature: "multi_user",
      },
      {
        to: "/activity",
        icon: "ti-history",
        label: "nav.activity",
        feature: "audit_log",
      },
      { to: "/settings", icon: "ti-settings", label: "nav.settings" },
    ],
  },
];

// Tab-level routes that live inside hub pages — reachable from the command
// palette even though they don't have their own sidebar row.
export const subPages = [
  // My Account has no sidebar row (the user block links to it) but should
  // still be reachable from the command palette.
  { to: "/settings/account", icon: "ti-user-circle", label: "account.title" },
  {
    to: "/settings/menu",
    icon: "ti-adjustments-horizontal",
    label: "business.menuTitle",
  },
  {
    to: "/settings/preferences",
    icon: "ti-palette",
    label: "settings.preferencesTab",
  },
  {
    to: "/sales/invoices",
    icon: "ti-file-invoice",
    label: "invoices.title",
    feature: "invoicing",
  },
  {
    to: "/sales/clients",
    icon: "ti-address-book",
    label: "clients.title",
    feature: "invoicing",
  },
  {
    to: "/sales/receivables",
    icon: "ti-report-money",
    label: "ar.title",
    feature: "invoicing",
  },
  {
    to: "/transactions/recurring",
    icon: "ti-repeat",
    label: "recurring.title",
    feature: "recurring",
  },
  { to: "/transactions/rules", icon: "ti-filter-cog", label: "nav.rules" },
  {
    to: "/transactions/reconcile",
    icon: "ti-checklist",
    label: "recon.title",
    feature: "reconciliation",
  },
  {
    to: "/reports/cash-flow",
    icon: "ti-cash-banknote",
    label: "cashflow.title",
    feature: "advanced_reports",
  },
  {
    to: "/reports/balance-sheet",
    icon: "ti-scale",
    label: "balanceSheet.title",
  },
  { to: "/reports/tax-summary", icon: "ti-receipt-tax", label: "tax.title" },
  {
    to: "/reports/hacienda",
    icon: "ti-building-bank",
    label: "hacienda.title",
    feature: "hacienda",
  },
  {
    to: "/reports/ivu",
    icon: "ti-receipt-2",
    label: "ivu.title",
    feature: "hacienda",
  },
  {
    to: "/payroll/rules",
    icon: "ti-scale",
    label: "payrollRules.title",
    feature: "payroll",
  },
  {
    to: "/payroll/compliance",
    icon: "ti-calendar-due",
    label: "payrollFilings.title",
    feature: "payroll",
  },
  {
    to: "/projects/time",
    icon: "ti-clock",
    label: "time.title",
    feature: "projects",
  },
  { to: "/plans", icon: "ti-crown", label: "plans.title" },
];

// ── Per-business menu customization ─────────────────────────
// Business Profile → Menu lets owners/admins hide the sections a business
// doesn't use (stored in businesses.hidden_nav, shipped in the auth
// payload as business.hiddenNav). These three are always shown. Mirrors
// backend/src/config/nav.js — keep the two in sync.
export const LOCKED_NAV = ["/dashboard", "/transactions", "/settings"];

export const hideableNavGroups = navGroups
  .map((g) => ({
    ...g,
    items: g.items.filter((i) => !LOCKED_NAV.includes(i.to)),
  }))
  .filter((g) => g.items.length > 0);

// True when `to` (a page or one of its sub-pages) sits under a hidden section.
export function isNavHidden(to, hiddenNav) {
  return (hiddenNav || []).some((h) => to === h || to.startsWith(`${h}/`));
}
