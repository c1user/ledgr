# ROADMAP V5 — Puerto Rico payroll compliance module

A ground-up rebuild of payroll for the real target user: contables running
payroll for many small-business clients in Puerto Rico. The existing payroll
feature (V1-era) is generic-mainland math with hardcoded 2025 rates — it
withholds federal income tax for PR residents and applies a flat 7% "PR tax."
It cannot be extended; it gets replaced and retired at the end of this
roadmap.

**The one architectural fact that shapes everything:** tax rules are DATA,
never code. Every rate, table, wage base, cap, and due date lives in
versioned database records with a `verification_status`. The app ships with
plausible **UNVERIFIED placeholders**; a human (you, or a CPA you trust)
must replace them with values from official sources and mark them VERIFIED
before production-mode payroll will run at all. Until then everything runs
in sandbox mode, watermarked **"CÁLCULO NO VERIFICADO — SOLO PRUEBAS"**.
This is not a launch blocker to code around — it is the safety property the
whole design exists to protect. It also creates a permanent annual ritual:
every January, someone re-verifies the new year's rates or production
payroll stops. Decide in Phase 0 who owns that.

**Relationship to V4:** parallel track. Nothing here blocks the V4 critical
path (domain → hosted API → web launch), and none of it requires V4 to have
shipped. The W-2PR export (5.5) only matters in January; the compliance
calendar and stubs matter from the first real run.

**Non-negotiables carried through every phase** (from the module spec):
no hardcoded rates or dates; all money math in integer cents (no floats in
any payroll path); finalized runs are immutable — corrections are reversal
runs; SSNs encrypted at rest, masked in UI, never logged even partially;
no UI copy ever claims the software "guarantees compliance" or gives tax
advice; only a human sets VERIFIED.

---

## Phase 0 — Owner decisions  *(no code; everything downstream depends on 0.1)*

- [x] **0.1 Tenancy model — DECIDED 2026-08-08: per-business, separate
      logins.** No tenancy restructure for v1: each employer client is a
      `business`, the contable holds a login per client (multi-user
      invites already work). Everything payroll is scoped by `business_id`
      exactly like the rest of the app. Consequence: the compliance
      calendar (5.2) is per-business in v1; a cross-client firm dashboard
      is deferred until a membership/firm tier exists (revisit post-V4).
- [x] **0.2 Legacy payroll fate — DECIDED 2026-08-08: freeze at Phase 2.**
      Existing runs stay visible read-only once the v2 schema lands; no
      new legacy runs; tables and code retired in 6.6.
- [ ] **0.3 Pay frequencies** — add `semimonthly`. Whether `monthly`
      remains lawful for non-exempt PR employees is itself a VERIFY item;
      keep it as a data-driven allowed-frequencies rule, not a code branch.
- [ ] **0.4 Who verifies tax data** — you alone, or a CPA reviewer? Decide
      the workflow (4-eyes?) and put the January re-verification ritual on
      a real calendar. TAX_DATA_TODO.md (1.4) is the checklist.
- [ ] **0.5 SSN encryption key custody** — v1: AES-256-GCM with a key in
      env (`PAYROLL_ENC_KEY`), same custody story as JWT_SECRET; losing the
      key loses the SSNs. KMS upgrade is a V4-hosting-era decision.
- [ ] **0.6 Demo account** — recommend seeding El Fogón Criollo with
      sandbox payroll data: it demos the module honestly because sandbox
      output is exactly what an unverified install shows (watermark and
      all).
- [ ] **0.7 Pricing** — payroll stays Premium-gated (entitlements already
      enforce this). Per-employee pricing is a Stripe/V4 Phase 2 question;
      note it there, don't solve it here.

## Phase 1 — Rules engine  *(DONE 2026-08-08)*

- [x] **1.1 `payroll_rules` migration** — append-only versioned records:
      `rule_type`, `jurisdiction`, `payload` JSONB (value or table),
      `effective_from`/`effective_to`, `source_citation` (official document
      name + URL), `verification_status` (UNVERIFIED | VERIFIED),
      `verified_by`, `verified_at`. New version = new row; a trigger
      forbids payload UPDATE once verified. Per-employer overrides (SUTA
      experience rate, CFSE premium) live in employer-scoped rows of the
      same table.
- [x] **1.2 Rule resolution service** — `resolveRules(employerId, payDate)`
      returns the applicable rule-version set; every calculation consumes
      resolved versions by ID, never raw values from elsewhere. This is the
      single chokepoint, same philosophy as `ledger.js`.
- [x] **1.3 Seed UNVERIFIED placeholders** for every rule type: PR
      withholding tables + 499 R-4 election field list, Social Security
      rate/wage base, Medicare + additional threshold, SINOT
      employee/employer, SUTA (wage base, new-employer rate, assessments),
      chauffeurs' insurance (seguro choferil) applicability + amount,
      Christmas bonus regimes (hours thresholds, percentages, caps by size
      band, payment window), overtime (daily/weekly thresholds,
      multipliers, meal-period penalty), vacation/sick accrual rates,
      Regulation 9017 stub field list, W-2PR file-spec version, deposit and
      filing schedules, CFSE declaration schedule. Plausible values only —
      never presented as correct.
- [x] **1.4 TAX_DATA_TODO.md** at repo root — one entry per placeholder
      with a "where to find it" pointer (Hacienda/SURI publications, IRS —
      including which federal employment return PR employers now file, 941
      vs discontinued 941-PR — SSA, DTRH, CFSE; Law 148 bonus text noting
      the voided amendment; Act 379 post-2017-reform overtime).
- [x] **1.5 Rules admin UI** — list with status badges, payload viewer,
      citation display; a VERIFY action (owner role only) that records
      verified_by/at and requires the citation be filled. Copy carefully
      worded: verification is the user's attestation, not the app's.
- [x] **1.6 Sandbox/production mode** — per-employer setting. Production
      pre-flight resolves every rule the run would use and hard-fails
      listing any UNVERIFIED ones. Sandbox threads a watermark flag into
      every output (screen banner, PDF stamp, export header).

## Phase 2 — Domain model  *(DONE 2026-08-09)*

- [x] **2.1 Employer payroll profile** — per business: federal EIN (reuse
      `businesses.tax_id`), PR merchant registration no., SURI account
      ref, DTRH employer account ("número patronal"), CFSE policy no.,
      default pay frequency (weekly/biweekly/semimonthly per 0.3), employer
      size band (band definitions are DATA), default work municipality.
- [x] **2.2 Employees v2** — full SSN encrypted at rest (AES-256-GCM,
      ciphertext+iv+tag columns; plaintext last-4 kept for display),
      masked by default everywhere, excluded from logs and error reports;
      address; hire date (selects bonus/accrual regime — the selection rule
      is DATA); classification (non-exempt hourly / exempt salaried); pay
      rate; 499 R-4 withholding elections as JSONB (exact field list is a
      VERIFY item, so it must not be hardcoded as columns); termination
      status + date.
- [x] **2.3 Run structure** — `pay_periods` → `payroll_runs_v2` (mode,
      status draft/finalized/reversed, `reversal_of`, and a `rule_snapshot`
      of every rule-version ID used) → `pay_lines` (one per employee) →
      `pay_items` (typed earning | employee_deduction |
      employer_contribution, each with `rule_version_id` and
      `amount_cents INTEGER`).
- [x] **2.4 Payroll time entries** — per employee per day, hours by type
      (regular/OT feeds come from daily data, since PR has daily-overtime
      concepts). Separate from the existing `time_entries` (that table is
      user/project billable-hours); a later import bridge is optional.
- [x] **2.5 Year accumulators** — per employee per year, updated ONLY by
      finalizing runs (reversals decrement): gross, PR tax withheld,
      SS wages/withheld, Medicare wages/withheld, SINOT wages, SUTA wages,
      Christmas-bonus qualifying hours, vacation/sick balances. Wage-base
      caps in Phase 3 read these, not annualized estimates.
- [x] **2.6 `compliance_obligations`** — per employer: type, period, due
      date, status (upcoming/ready/done/late), link to its export.
- [x] **2.7 Freeze legacy payroll** read-only (per 0.2).

## Phase 3 — Calculation engine  *(DONE 2026-08-09)*

- [x] **3.1 Cents discipline** — money utilities in integer cents; an
      enforcement test (backend has no ESLint — add a test that scans
      payroll-v2 sources and fails on `parseFloat`, float literals,
      `toFixed`, `Number(...)` arithmetic in money paths).
- [x] **3.2 Gross pay** — hourly: regular + overtime with per-DAY
      threshold, per-week threshold, distinct multipliers, and a
      meal-period penalty line type (all parameters from rules); salaried
      proration. Pre-tax deduction architecture present, none enabled in
      v1.
- [x] **3.3 Employee withholdings** — each from its own rule table: PR
      income tax (bracket/table payload driven by 499 R-4 elections; NO
      federal income tax withholding for PR-resident wages — scope itself
      is a data rule), Social Security and Medicare with caps/thresholds
      applied against 2.5 accumulators in the correct period, SINOT
      employee share, seguro choferil where occupationally flagged, manual
      fixed-amount deduction type (the only garnishment support in v1).
- [x] **3.4 Employer accruals** — SUTA (per-employer experience rate +
      wage base + assessments), SINOT employer share, CFSE premium
      allocated per run for accrual accounting, Christmas-bonus accrual
      (percentage and cap by size band + hire-date regime).
- [x] **3.5 Invariants** — sum of items = gross to the cent; net = gross −
      employee deductions; run totals = sum of lines. Enforced in code and
      asserted in tests.
- [x] **3.6 Determinism + immutability** — re-running with the same inputs
      and rule snapshot reproduces identical output to the cent (test
      this); finalized runs immutable via DB trigger; corrections are
      reversal/adjustment runs, mirroring how the ledger corrects.
- [x] **3.7 Ledger posting** — on finalize, one balanced journal entry via
      `postJournalEntry()` (the existing chokepoint — today payroll never
      posts at all): wages expense, withholding liabilities by agency,
      employer-tax expense and accrued liabilities, net-pay
      clearing/cash. Account mapping per-tenant configurable with defaults
      added to `coaSeed.js`; reversal runs post reversing entries.

## Phase 4 — Outputs  *(DONE 2026-08-09 — bell/dashboard surfacing of 4.3 lands with the Phase 5 calendar)*

- [x] **4.1 Pay stub PDF** — bilingual, Spanish primary (pdfkit, like
      invoicePdf): employer identity, employee, period + payment dates,
      hours by type with rates, gross, itemized deductions with YTD
      columns from accumulators, employer contributions section, net. The
      minimum field list must satisfy Regulation 9017 — the list is a DATA
      rule (VERIFY). One click prints all stubs of a run as a single PDF.
      Sandbox watermark across every page.
- [x] **4.2 Check printing** — check-on-top two-stub layout for standard
      pre-printed stock; per-employer X/Y offset calibration; amount in
      words ES/EN; no MICR rendering (stock carries it).
- [x] **4.3 Christmas-bonus eligibility report** — per employee:
      qualifying hours to date, projected eligibility and bonus at current
      rules, employer cap band. Runnable any time; surfaced prominently
      from October via dashboard card + existing notification bell.

## Phase 5 — Compliance calendar & filing exports  *(DONE 2026-08-09 — notification-bell feed deferred until cron infra exists, V4 Phase 1)*

- [x] **5.1 Obligation generation** — from data-driven schedule rules per
      employer: withholding deposit dates, quarterlies (Hacienda
      withholding reconciliation; the current federal employment return —
      which one is a VERIFY item; DTRH unemployment/SINOT), annuals (W-2PR
      window, CFSE declaration, bonus payment window). Regenerated when
      schedule rules change.
- [x] **5.2 Calendar dashboard** — per business (per the 0.1 decision;
      firm-wide aggregation deferred), statuses upcoming/ready/done/late,
      each obligation linking to its export; feeds the notification bell.
- [x] **5.3 Hacienda quarterly reconciliation worksheet** — pre-filled
      figures export (PDF/CSV) for manual SURI entry.
- [x] **5.4 DTRH quarterly wage report export.**
- [x] **5.5 W-2PR (499R-2)** — electronic submission file conforming to
      Hacienda's CURRENT published spec (spec version is DATA and a VERIFY
      item; build on the fixed-width record pattern proven in
      `suriFile.js`), plus a human-readable per-employee draft PDF.
- [x] **5.6 CFSE annual payroll declaration worksheet.**

## Phase 6 — Testing, security, hardening  *(DONE 2026-08-09 — module code-complete; production awaits TAX_DATA_TODO.md)*

- [x] **6.1 Golden-file tests** — fixture employees/periods with expected
      outputs stored as JSON data, structured so swapping placeholder
      expectations for human-verified numbers is a data-only change.
- [x] **6.2 Property tests** — gross = net + deductions; YTD monotonicity
      within a year; wage-base caps stop withholding in the correct
      period; snapshot reproducibility.
- [x] **6.3 Timezone** — all payroll dates in America/Puerto_Rico; tests
      on period boundaries (a run finalized 11 PM Dec 31 AST must not land
      in the wrong year).
- [x] **6.4 SSN + compensation audit** — extend the audit pattern
      (`audit_log`, currently mutations-only) with view events for SSN
      reveal and compensation edits; a log-scrubber test proving no SSN,
      even partial, reaches logs or error reports.
- [x] **6.5 Disclaimer copy pass** — every payroll surface: the software
      prepares figures and worksheets; it does not guarantee compliance or
      constitute tax/legal advice. ES + EN.
- [x] **6.6 Retire legacy payroll** — drop old `payslips`/engine/routes,
      remove dead UI, reseed El Fogón with sandbox payroll (0.6), update
      entitlements naming if needed.
- [x] **6.7 Runbook** — the January verification ritual documented:
      re-pull every TAX_DATA_TODO item, load new rule versions, verify,
      confirm production pre-flight passes for the new year.

---

## Explicitly OUT of scope for v1 — do not build

No direct electronic filing to SURI/DTRH/CFSE/IRS (exports only). No direct
deposit/ACH or any money movement. No benefits administration or garnishment
processing (manual fixed deduction only). No multi-jurisdiction (PR only).
No employee self-service portal.

---

**Critical path:** 0.1 (tenancy) → 1.1–1.2 (rules engine) → 2.3 (run
structure) → 3.x (engine) is strictly sequential; Phases 4 and 5 can
proceed in parallel once 3 exists. 5.5 (W-2PR) is seasonal — it must exist
and be verified before the January filing window, and not before.

**What "done" means here:** the module is code-complete with every rule
UNVERIFIED. Production payroll becomes possible only after the Phase 0.4
owner completes TAX_DATA_TODO.md against official sources. Budget real
hours for that — it is the actual compliance work, and no phase of this
roadmap can do it for you.
