// ============================================================
//  Abaco — Payroll Tax Calculation Service
//  Handles federal, FICA, and PR state tax calculations
// ============================================================

// 2025 Federal income tax brackets (single)
const FEDERAL_BRACKETS_SINGLE = [
  { min: 0, max: 11600, rate: 0.1 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 },
];

// 2025 Federal income tax brackets (married filing jointly)
const FEDERAL_BRACKETS_MARRIED = [
  { min: 0, max: 23200, rate: 0.1 },
  { min: 23200, max: 94300, rate: 0.12 },
  { min: 94300, max: 201050, rate: 0.22 },
  { min: 201050, max: 383900, rate: 0.24 },
  { min: 383900, max: 487450, rate: 0.32 },
  { min: 487450, max: 731200, rate: 0.35 },
  { min: 731200, max: Infinity, rate: 0.37 },
];

// FICA rates
const SOCIAL_SECURITY_RATE = 0.062; // 6.2%
const SOCIAL_SECURITY_WAGE_BASE = 168600; // 2025 wage base
const MEDICARE_RATE = 0.0145; // 1.45%
const ADDITIONAL_MEDICARE_RATE = 0.009; // 0.9% over $200k

// ── Calculate annual federal income tax ──────────────────────
const calcFederalTax = (annualGross, filingStatus) => {
  const brackets =
    filingStatus === "married"
      ? FEDERAL_BRACKETS_MARRIED
      : FEDERAL_BRACKETS_SINGLE;

  let tax = 0;
  for (const bracket of brackets) {
    if (annualGross <= bracket.min) break;
    const taxable = Math.min(annualGross, bracket.max) - bracket.min;
    tax += taxable * bracket.rate;
  }
  return tax;
};

// ── Calculate per-period tax amounts ─────────────────────────
export const calculatePayslip = (employee, periodsPerYear) => {
  const {
    pay_type,
    pay_rate,
    pay_frequency,
    federal_filing_status,
    federal_allowances,
    pr_state_tax_rate,
    federal_exempt,
  } = employee;

  // Calculate gross pay for this period
  let grossPay;
  if (pay_type === "salary") {
    // Annual salary divided by pay periods
    grossPay = parseFloat(pay_rate) / periodsPerYear;
  } else {
    // Hourly — requires hours_worked passed separately
    // Default to standard hours if not provided
    grossPay = parseFloat(pay_rate) * (employee.hours_worked || 0);
  }

  // Annualize gross for tax bracket calculation
  const annualGross = grossPay * periodsPerYear;

  // Federal income tax (annualized then divided by periods)
  // Subtract allowance value ($4,300 per allowance in 2025)
  let federalTax = 0;
  if (!federal_exempt) {
    const allowanceDeduction = (federal_allowances || 0) * 4300;
    const taxableAnnual = Math.max(0, annualGross - allowanceDeduction);
    const annualFederalTax = calcFederalTax(
      taxableAnnual,
      federal_filing_status,
    );
    federalTax = annualFederalTax / periodsPerYear;
  }

  // Social Security (6.2% up to wage base)
  let socialSecurity = 0;
  if (annualGross <= SOCIAL_SECURITY_WAGE_BASE) {
    socialSecurity = grossPay * SOCIAL_SECURITY_RATE;
  } else {
    // Only tax up to the wage base
    const taxableForSS = Math.max(
      0,
      SOCIAL_SECURITY_WAGE_BASE - (annualGross - grossPay),
    );
    socialSecurity = taxableForSS * SOCIAL_SECURITY_RATE;
  }

  // Medicare (1.45% + 0.9% over $200k annually)
  let medicare = grossPay * MEDICARE_RATE;
  if (annualGross > 200000) {
    const additionalTaxable = Math.min(grossPay, annualGross - 200000);
    medicare += additionalTaxable * ADDITIONAL_MEDICARE_RATE;
  }

  // Puerto Rico state tax
  const prStateTax = grossPay * parseFloat(pr_state_tax_rate || 0.07);

  // Net pay
  const totalDeductions = federalTax + socialSecurity + medicare + prStateTax;
  const netPay = Math.max(0, grossPay - totalDeductions);

  return {
    grossPay: round(grossPay),
    federalTax: round(federalTax),
    socialSecurity: round(socialSecurity),
    medicare: round(medicare),
    prStateTax: round(prStateTax),
    otherDeductions: 0,
    netPay: round(netPay),
    totalTaxes: round(totalDeductions),
  };
};

// ── Get number of pay periods per year ───────────────────────
export const getPeriodsPerYear = (payFrequency) => {
  switch (payFrequency) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "monthly":
      return 12;
    default:
      return 26;
  }
};

// ── Round to 2 decimal places ─────────────────────────────────
const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
