// Pure helpers shared by the Accounts list, AccountRow, BalanceSummary,
// AccountHero and the review AccountPicker (ROADMAP-V6 2.15). The backend
// returns NUMERIC columns as strings (current_balance, total_income,
// total_expenses and the balances-summary SUMs, which are null when there is
// nothing to sum) and COUNT(*) as a string too, so every value is normalised
// here, at the edge, and the components only render.
import { toNumber, formatMoney } from "../receipts/receiptFormat.js";

export { toNumber, formatMoney };

/** react-query key of GET /api/accounts — shared with ReceiptReview/Settings. */
export const ACCOUNTS_QUERY_KEY = ["accounts"];

/** react-query key of GET /api/accounts/summary/balances (same as the web). */
export const BALANCES_QUERY_KEY = ["balances"];

// GET /api/accounts → type: 'savings'|'current'|'credit'|'cash'|'loan'
/** Literal i18n keys per account type (no key interpolation — grep-able). */
export const TYPE_KEYS = {
  current: "accounts.typeCurrent",
  savings: "accounts.typeSavings",
  credit: "accounts.typeCredit",
  cash: "accounts.typeCash",
  loan: "accounts.typeLoan",
};

/** Tabler icon per account type (the AccountPicker set). */
export const TYPE_ICONS = {
  current: "ti-building-bank",
  savings: "ti-pig-money",
  credit: "ti-credit-card",
  cash: "ti-cash",
  loan: "ti-file-percent",
};

/**
 * splitActive(rows) → { active, inactive }. `is_active !== false` counts as
 * active (an undefined flag is active); the API order (active first, oldest
 * first) is preserved inside each half. Tolerates a non-array and skips
 * non-object entries.
 */
export const splitActive = (rows) => {
  const active = [];
  const inactive = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    if (row.is_active === false) inactive.push(row);
    else active.push(row);
  }
  return { active, inactive };
};

/** "-12.00" → "expense"; "0.00" | null | garbage → "income" (zero is not red). */
export const balanceTone = (value) =>
  (toNumber(value) ?? 0) >= 0 ? "income" : "expense";

/** Summary SUMs are null with no rows (the web's `val || 0`) → number. */
export const summaryOrZero = (value) => toNumber(value) ?? 0;
