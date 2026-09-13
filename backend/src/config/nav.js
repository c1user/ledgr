/**
 * config/nav.js — sidebar sections a business may hide (businesses.hidden_nav).
 *
 * Mirrors the top-level routes in frontend/src/config/nav.js; keep the two in
 * sync when a section is added. Dashboard, Transactions and Business Profile
 * are never hideable, so they are deliberately absent from this list.
 */

export const HIDEABLE_NAV = [
  "/sales",
  "/vendors",
  "/receipts",
  "/payroll",
  "/accounts",
  "/chart-of-accounts",
  "/journal",
  "/budget",
  "/reports",
  "/projects",
  "/inventory",
  "/ai",
  "/team",
  "/activity",
];

/**
 * Validate a client-supplied hidden_nav value. Returns a de-duplicated array
 * of allowed routes, or null when the input is not an array or contains
 * anything outside HIDEABLE_NAV (unknown routes, locked sections, non-strings).
 */
export function normalizeHiddenNav(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const v of value) {
    if (typeof v !== "string" || !HIDEABLE_NAV.includes(v)) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
