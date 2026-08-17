/**
 * services/prDates.js — payroll date handling (ROADMAP-V5 · Phase 6.3).
 *
 * Two traps this module exists to kill, once, in one place:
 *  1. UTC drift: `new Date().toISOString()` is tomorrow after 8pm in
 *     Puerto Rico (UTC−4, no DST). Payroll "today" — preflight dates,
 *     obligation lateness, report as-of — must be the PR calendar day.
 *  2. pg DATE columns come back as JS Date objects, and
 *     String(date).slice(0, 10) produces garbage like "Thu Aug 14".
 */

/** Today's calendar date in Puerto Rico, YYYY-MM-DD. */
export const todayPR = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" });

/** Normalize a pg DATE (JS Date) or ISO-ish string to YYYY-MM-DD. */
export const toIso = (d) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
