# TAX_DATA_TODO — verify every payroll rule before production

Every payroll tax rule in Abaco ships as an **UNVERIFIED placeholder**:
plausible-looking values that exist only so the module can be built and
demoed in sandbox mode. **None of them are correct until a human replaces
them with values from the official source and marks them VERIFIED** in the
payroll rules admin (Payroll → Tax rules). Production-mode payroll
hard-fails while any rule a run would use is UNVERIFIED; sandbox output is
watermarked "CÁLCULO NO VERIFICADO — SOLO PRUEBAS".

How to complete an item:
1. Obtain the current official document from the source listed.
2. Edit the rule's payload in the admin UI to match it exactly; replace
   the placeholder citation with the document's name and URL.
3. Verify the rule (owner only) — this records your attestation.
4. Repeat every January for the new year's values (new version, new
   effective dates — never overwrite a verified version).

Rule seeds live in `backend/src/services/payrollRulesSeed.js`; this
checklist tracks the human work, one item per seeded rule type.

---

- [ ] **PR income-tax withholding tables** (`pr_income_tax_withholding`)
      — Hacienda's employer withholding tables for the current year.
      Source: hacienda.pr.gov → SURI publications (Patronos/Retención).
      The placeholder bracket shape is a guess; the real tables differ
      structurally — expect to restructure the payload, not just edit
      numbers.

- [ ] **Form 499 R-4 election fields** (`pr_499r4_fields`) — the exact
      field list on the current Withholding Exemption Certificate
      (exemption status options, allowances, additional withholding,
      any special exemptions). Source: Hacienda, Form 499 R-4 current
      revision.

- [ ] **Federal employment return for PR employers**
      (`federal_employment_return`) — which return PR employers now file
      (Form 941-PR was discontinued — confirm the replacement and the
      Spanish-language option) and the deposit schedule rules.
      Source: IRS (irs.gov) — instructions for the current form.

- [ ] **Social Security rate & wage base** (`social_security`) — current
      year. Source: SSA COLA fact sheet (ssa.gov) / IRS Publication 15.

- [ ] **Medicare rates & additional-tax threshold** (`medicare`) —
      current year. Source: IRS Publication 15.

- [ ] **SINOT rates & wage base** (`sinot`) — employee and employer
      shares of non-occupational disability insurance. Source: PR
      Department of Labor (DTRH, trabajo.pr.gov).

- [ ] **SUTA wage base, new-employer rate, assessments** (`suta`) —
      plus THIS employer's experience rate from their DTRH notice
      (enter as a new version of the rule). Source: DTRH.

- [ ] **Chauffeurs' social security** (`seguro_choferil`) — which
      occupations it covers and the current weekly amounts. Source:
      DTRH (Ley de Seguro Social Choferil).

- [ ] **Christmas bonus** (`christmas_bonus`) — qualifying-hours
      thresholds by hire-date regime, percentages and caps by employer
      size, payment window, and the exemption-request process. Source:
      DTRH, Law 148 of 1969 as amended. NOTE: recent litigation voided
      one amendment — confirm which text is currently operative.

- [ ] **Overtime & meal period** (`overtime`) — daily and weekly
      thresholds, multipliers, meal-period penalty. Source: Act 379 of
      1948 as amended by the 2017 labor reform (Law 4-2017); confirm
      current state.

- [ ] **Vacation/sick accrual** (`vacation_sick_accrual`) — accrual
      rates by employer size and hire date, minimum monthly hours.
      Source: PR law current text (Law 180-1998 / Law 4-2017 regime),
      via DTRH.

- [ ] **Employer size bands** (`employer_size_bands`) — the employee
      count definitions used by the bonus and accrual statutes, and the
      counting method. Source: DTRH / Law 148 text.

- [ ] **Pay frequencies** (`pay_frequencies_allowed`) — statutory pay
      frequency requirements; specifically whether monthly pay is
      lawful for non-exempt employees. Source: DTRH.

- [ ] **Pay stub minimum fields** (`paystub_fields_9017`) — the exact
      minimum field list under Regulation 9017. Source: DTRH,
      Regulation 9017.

- [ ] **Hacienda deposit schedule** (`hacienda_deposit_schedule`) —
      income-tax withholding deposit frequencies and thresholds.
      Source: hacienda.pr.gov / SURI employer guidance.

- [ ] **Quarterly filing due dates** (`quarterly_filing_schedule`) —
      Hacienda withholding reconciliation and DTRH unemployment/SINOT
      quarterly report deadlines. Sources: Hacienda (SURI), DTRH.

- [ ] **W-2PR electronic file spec** (`w2pr_file_spec`) — Hacienda's
      499R-2/W-2PR electronic filing specification FOR THE FILING YEAR
      (published annually; the spec version is itself part of the
      rule). Source: Hacienda annual publication.

- [ ] **CFSE declaration** (`cfse_declaration`) — annual payroll
      declaration format, policy-year period, due date, and THIS
      employer's premium rates from their policy. Source: CFSE
      (fondopr.com).

---

**Annual ritual (every January, before the first run of the year):**
re-pull every item above, load the new year's values as new rule
versions effective Jan 1, verify them, and confirm the payroll
preflight passes in production mode. Rules are per-business — repeat
for each employer client you run payroll for.
