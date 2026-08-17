/**
 * services/money.js — integer-cents money utilities (ROADMAP-V5 · Phase 3.1).
 *
 * Every payroll-v2 amount is an integer number of cents. This module is
 * the ONLY place dollars↔cents conversion happens; tests/centsDiscipline
 * scans the engine/service files and fails on float-style money code
 * (parseFloat, toFixed, decimal literals), with this file as the single
 * sanctioned boundary.
 */

/** Assert a value is a safe integer cents amount. */
export function assertCents(value, label = "amount") {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`money: ${label} must be integer cents, got ${value}`);
  }
  return value;
}

/**
 * Parse a dollars value (DB NUMERIC string or JS number) to integer cents
 * using string math — no float parsing, no precision loss.
 * "18.50" → 1850, "42000" → 4200000, 18.5 → 1850.
 */
export function toCents(value, label = "amount") {
  const s = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) {
    throw new Error(`money: cannot parse ${label} "${s}" as dollars`);
  }
  const [, sign, whole, frac = ""] = m;
  const cents =
    Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2) || "0");
  assertCents(cents, label);
  return sign === "-" ? -cents : cents;
}

/**
 * Integer cents → exact 2-decimal dollars Number for the ledger API
 * (postJournalEntry takes dollar amounts). String-built so the value is
 * the closest double to the true decimal, same as the DB would return.
 */
export function centsToDollars(cents, label = "amount") {
  assertCents(cents, label);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return Number(`${sign}${whole}.${frac}`);
}

/**
 * cents × rate, rounded to the nearest cent. The single sanctioned place
 * a (dimensionless, rule-payload) rate touches a money amount.
 */
export function mulRate(cents, rate, label = "rate") {
  assertCents(cents);
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw new Error(`money: ${label} must be a non-negative finite number`);
  }
  return Math.round(cents * rate);
}

/** cents × quantity (e.g. hours), rounded to the nearest cent. */
export function mulQty(cents, qty, label = "quantity") {
  assertCents(cents);
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0) {
    throw new Error(`money: ${label} must be a non-negative finite number`);
  }
  return Math.round(cents * qty);
}

/** Integer division of cents, rounded to the nearest cent. */
export function divCents(cents, divisor, label = "divisor") {
  assertCents(cents);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error(`money: ${label} must be a positive number`);
  }
  return Math.round(cents / divisor);
}

/** Sum an array of integer cents. */
export function sumCents(values) {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return total;
}

/** Clamp cents into [lo, hi]. */
export function clampCents(value, lo, hi) {
  assertCents(value);
  return Math.min(Math.max(value, lo), hi);
}
