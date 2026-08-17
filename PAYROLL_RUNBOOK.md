# PAYROLL RUNBOOK — the annual verification ritual

The PR payroll module (ROADMAP-V5) computes everything from **versioned
rule records**, never from code. That design has one operating cost, and
this runbook is it: **every January, before the first run of the new
year, a human re-verifies every rule** — or production payroll stops, by
design. Budget a half-day.

## The January ritual (per employer business)

1. **Pull the new year's official values** for every item in
   [TAX_DATA_TODO.md](TAX_DATA_TODO.md) — Hacienda/SURI, IRS, SSA, DTRH,
   CFSE. That file lists where to find each one.
2. **Load them as NEW rule versions** (Payroll → Tax rules):
   - Open each rule, set the current version's *end date* to Dec 31.
   - Create a new version effective Jan 1 with the new payload and the
     official document name + URL as the citation.
   - Never edit a verified version's values — verified rules are
     immutable; corrections are new versions. Old runs stay reproducible
     because they snapshot the version IDs they used.
3. **Verify each new version** (owner only). The Verify button records
   your attestation that the payload matches the cited source. The app
   never verifies anything by itself.
4. **Employer-specific values**: enter this employer's new SUTA
   experience rate (a new `suta` version) and CFSE premium (a new
   `cfse_declaration` version) from their DTRH/CFSE notices.
5. **W-2PR file spec**: Hacienda publishes the electronic layout
   annually. Update the `w2pr_file_spec` rule's `spec_version`, and if
   the layout changed, update `backend/src/services/w2prFile.js` to
   implement it (the builder refuses versions it does not implement —
   generation fails loudly rather than following a stale layout).
6. **Preflight check**: create a draft run dated in the new year. In
   production mode it must pass; if it lists blockers, those rules still
   need verifying.
7. **Compliance calendar**: open Payroll → Compliance for the new year —
   it regenerates obligations from the updated schedule rules
   automatically.

## Mid-year rule changes (law changes, corrected rates)

Same pattern, any time: close the current version at the day before the
change, add a verified new version from the effective date. Runs already
finalized are untouched; reversal runs exist for corrections
(Payroll → run → Reverse).

## Mode discipline (what sandbox/production mean)

- **Sandbox**: runs compute with whatever rules exist (verified or not),
  every output carries "CÁLCULO NO VERIFICADO — SOLO PRUEBAS", and
  NOTHING touches the ledger or YTD accumulators. For testing only.
- **Production**: a run hard-fails if ANY rule it would use is
  unverified; finalization posts the ledger entry and updates YTD.
  Switch modes in Payroll → Tax rules (owner only).

## Custody notes

- `PAYROLL_ENC_KEY` (backend/.env) encrypts employee SSNs. **Losing it
  loses every SSN permanently.** Same custody as JWT_SECRET; store a
  copy wherever your production secrets live.
- Filing exports (DTRH, W-2PR) decrypt SSNs into the downloaded file —
  each generation is recorded in the audit trail (action `export`).

## What the software never does

It never files anything with any agency, never marks a rule verified by
itself, and preparing worksheets is not tax or legal advice. The
contable files, the contable verifies, the contable signs.
