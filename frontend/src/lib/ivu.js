/**
 * lib/ivu.js — IVU rate presets shared by the invoice form (§2.1).
 *
 * standard = 10.5% state + 1% municipal (11.5% combined); reduced = 4%
 * designated/B2B services, state-only; exempt = IVU sale at 0%. The
 * heuristic mirrors the backend's defaultMuniRate (invoiceTotals.js):
 * combined rates >= 5% are assumed to include the 1% municipal SUT.
 */

export const IVU_DEFAULT_RATE = 11.5;
export const IVU_MUNI_RATE = 1;

/** Preset shown in the IVU selector, derived from the stored rate pair. */
export function deriveIvuPreset(rate, muniRate) {
  if (rate === IVU_DEFAULT_RATE && muniRate === IVU_MUNI_RATE)
    return "standard";
  if (rate === 4 && muniRate === 0) return "reduced";
  if (rate === 0) return "exempt";
  return "custom";
}

/** Mirror of the backend's defaultMuniRate for custom combined rates. */
export const autoMuniRate = (rate) => (rate >= 5 ? IVU_MUNI_RATE : 0);
