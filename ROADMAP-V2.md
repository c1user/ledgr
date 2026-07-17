# Roadmap v2 — Development & UI/UX

Supersedes the launch-oriented ordering. Publishing, billing, deployment and
app-store work are intentionally out of scope here. Focus: development and
UI/UX. Driving goal for Phase 1: the current palette reads like every other
green fintech product (QuickBooks / Sage / Wave territory) — Abaco should be
distinctive, and easier to read and navigate.

## Phase 1 — Visual identity

- [x] **1. New brand palette — "Ink & plum" chosen and promoted to default.**
      Near-black ink, deep plum brand (#5b3a9b light / #a987e9 dark), burnt
      orange expense accent. Includes a new `--on-brand` token so dark-mode
      brand buttons use ink text on the light plum (proper contrast). The
      preview scaffolding (picker + alternate palettes) has been removed.
- [x] **2. Typography with character** — Fraunces (serif display) on page
      titles and the ABACO wordmark; tabular numerals app-wide; base UI size
      bumped 13px → 14px (mobile overflow re-verified after the bump).
- [x] **3. Re-theme the data layer** — chart colors, category color presets,
      income/expense semantics, and the PDF palette follow the new identity.
      COA seed template + migration 019 recolor system accounts; Categories
      presets, AR aging ramp, confidence dots and gray fallbacks updated;
      report + invoice PDFs print in ink/plum.
- [x] **4. Identity details** — logo/lettermark, favicon, app icons, login
      screen as a branded moment. New abacus mark (plum square, white beads,
      burnt-orange accents) as favicon.svg + regenerated PWA icon set;
      manifest/theme-color meta updated to plum; shared `<BrandMark>` on
      Login, Register and the sidebar wordmark.

## Phase 2 — Easier to read & navigate

- [x] **5. Kill the browser dialogs** — replace `window.confirm`/`alert`
      with a confirm dialog + toast system built on the Modal kit.
      feedbackStore (zustand) exposes plain-function `toast.*` and
      promise-based `confirmDialog()`; FeedbackHost renders both from App.
      All 24 call sites across 14 pages converted.
- [x] **6. Command palette + global search (Ctrl+K)** — jump to any page,
      find any transaction/invoice/client from anywhere. CommandPalette
      (Ctrl+K / header search button) lists all 23 routes from the shared
      nav config and queries GET /api/search (transactions, invoices,
      clients, vendors); invoice/client hits deep-link into their detail
      views.
- [x] **7. Global quick-add** — one "+" in the header for new
      transaction/invoice/receipt from any page. QuickAdd menu navigates
      with `?new=<nonce>`; Transactions opens its add modal, Invoices its
      builder, Receipts lands on the upload zone.
- [x] **8. Dashboard as a home base** — action items (recurring due,
      invoices overdue, receipts pending review), cash position,
      getting-started checklist for empty businesses. Attention chips +
      5-step checklist (hidden once complete) above the KPI cards; cash
      position was already covered by Total Balance + Accounts panel.
- [x] **9. Guided empty states** — every empty list teaches the next step.
      Added primary actions to Clients, Vendors, Invoices (add-client
      prerequisite branch), Inventory, Rules and both TimeTracking panels;
      the rest already had them or are informational by design.
- [x] **10. Readability pass** — muted-text contrast, table density options,
      focus states / keyboard navigation, ES-string layout fit (incl. the
      "Effectivo" typo, which is now baked into PDFs).
      Muted text now ≥4.5:1 in both themes (#706a86 light / #8b84a3 dark —
      dark was at 2.4:1); global :focus-visible brand ring on buttons/links;
      "Compact rows" toggle in the sidebar (persisted, drives --row-y vars
      consumed by DataTable + Transactions/Payroll/Dashboard rows);
      "Efectivo" fixed in es.json (PDFs read it at runtime); 9-route ES
      mobile sweep clean.

## Phase 3 — Feature development

- [x] **11. Advanced reports** — cash-flow statement, period-over-period
      comparisons (Premium flag exists with nothing behind it).
      Direct-method cash flow from journal lines (operating/investing/
      financing; beginning → net change → ending cash) as a Reports tab
      with PDF export, gated by advanced_reports; P&L gained a Compare
      select (previous period / same period last year) with per-category
      previous amounts and ±% delta badges.
- [x] **12. Manual bank reconciliation** — CSV-import-based matching against
      the ledger + lock reconciled periods. Does NOT need Plaid.
      Reconcile tab under Transactions (professional+): pick a funding
      source + statement period/balances, check off cleared transactions
      (statement-CSV upload auto-matches by amount/sign/±3-day date),
      complete only when the difference is $0.00 — server re-verifies —
      then cleared transactions reject edits/deletes. Migration 020.
- [x] **13. Audit trail (history tables)** — an `audit_log` table recording
      every mutating action (create / update / delete) with the acting user,
      entity type + id, and a JSONB snapshot of the changed data — deletes
      keep the full removed row so nothing vanishes without a trace. Logged
      from shared backend middleware so new routes are covered by default,
      plus an Activity page to browse and filter the history. Deliberately
      sequenced BEFORE multi-user so every action is attributed from the
      moment additional users arrive.
      Migration 021; auditLogger middleware on /api hooks res-finish (2xx
      only) and pre-captures rows before DELETEs; Activity page (sidebar,
      professional+ via new audit_log flag) with action/type filters and
      expandable snapshots.
- [x] **14. Multi-user invites + user management page** (feature flag
      exists, no UI). Team page (owner/admin invite via emailed link —
      always copyable too since SMTP is optional; owner manages roles,
      deactivation is soft so history survives, last-owner guarded);
      public /join page sets name+password and logs straight in; roles
      are owner/admin/viewer per the original schema. Migration 022.
- [x] **15. In-app plan/pricing page + receipts-cap upsell polish** — the
      upgrade cards dead-end today; the Starter scan-limit 403 shows as raw
      error text. /plans page with three tier cards (current highlighted,
      owner switches freely until billing lands — PUT /api/business/plan);
      upgrade cards and the header plan badge now link there; the scan-limit
      403 renders as a friendly banner with usage counts + View plans.
- [x] **16. Hacienda follow-ons** — SURI flat-file e-file (Pub 25-03),
      quarterly 480.6SP-1, withholding remittance workflow.
      - [x] Withholding remittance workflow — quarterly withheld/remitted
            table on the Hacienda page (the 480.6SP-1 amounts) + a
            ledger-posted "Record remittance" (debit liability / credit
            cash asset; ledger-funded only in v1).
      - [x] SURI flat file per Pub 25-03 v2.0 — services/suriFile.js
            builds the fixed-width 2500-char ASCII file (SU + PA +
            details + 480.6SP.2 + 480.5); export button on Hacienda
            prompts for the Treasury-assigned control-number range
            start; 51 byte-position assertions in
            backend/tests/suriFile.test.mjs. v1 caveat: payees export
            as corporations/FEIN (the app doesn't distinguish
            individual payees) — noted in the UI.
- [x] **17. Multi-currency: complete or cut** — FX entry works; decide
      whether full multi-currency survives.
      DECIDED (2026-07-17): cut. Full multi-currency (FX gain/loss
      accounts, revaluation, realized/unrealized gains) is not worth it
      for a USD/Puerto Rico market. The lightweight FX capture stays:
      foreign purchases record the original amount + USD conversion at
      the transaction-date rate; the ledger remains single-currency USD.
      Revisit only if importer demand shows up.

## Phase 4 — Code quality

- [ ] **18. Code splitting** — the 1.2 MB bundle is a load-time UX issue.
- [ ] **19. Backend tests + pre-commit hook** — ledger posting and
      entitlement gates deserve regression coverage.
- [ ] **20. Small debt** — the two pre-existing lint errors (TimeTracking
      `Date.now()` in render, Transactions FX effect), adopt-or-delete the
      unused `DataTable` component.
