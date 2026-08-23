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

/**
 * Normalize a pg DATE (JS Date) or ISO-ish string to YYYY-MM-DD.
 *
 * pg parses DATE columns as LOCAL midnight, so the local date parts are
 * always the stored date. toISOString() would round-trip through UTC and
 * shift the date one day EARLIER on any server east of UTC — use the
 * local parts, which are correct in every timezone.
 */
export const toIso = (d) => {
  if (d instanceof Date) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
};
