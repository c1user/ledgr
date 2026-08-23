/**
 * services/invoiceTotals.js — invoice money math (single choke point).
 *
 * Extracted from routes/invoices.js so totals — and the PR IVU
 * state/municipal split — are unit-testable. Amounts are dollars,
 * rounded with the ledger's round2.
 *
 * IVU composition (SC 2915): the combined tax_rate decomposes into a state
 * portion and a municipal portion (tax_muni_rate, normally 1.000 of the
 * 11.5% standard rate). The 4% special SUT on designated/B2B services is
 * state-only, so its muni rate is 0. Identity preserved on every invoice:
 * tax_state_total + tax_muni_total === tax_total — municipal is rounded
 * once and state derived by subtraction, never two independent roundings.
 */

import { round2 } from "./ledger.js";

// Municipal share assumed for a combined IVU rate when the caller doesn't
// say: rates below 5% are state-only (the 4% designated-services SUT has no
// municipal portion); 5% and up are assumed to include the 1% municipal SUT.
export function defaultMuniRate(taxType, rate) {
  if (taxType !== "ivu") return 0;
  return rate >= 5 ? 1 : 0;
}

// Compute money from line items + tax inputs. tax_exempt forces tax to 0.
export function computeTotals(
  lines,
  { taxType, taxRate, taxMuniRate, taxExempt },
) {
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const type = taxType === "ivu" ? "ivu" : "generic";
  const rate = taxExempt ? 0 : Math.max(0, parseFloat(taxRate) || 0);

  let muniRate =
    taxMuniRate === undefined || taxMuniRate === null
      ? defaultMuniRate(type, rate)
      : Math.max(0, parseFloat(taxMuniRate) || 0);
  if (type !== "ivu") muniRate = 0;
  muniRate = Math.min(muniRate, rate);

  const taxTotal = round2((subtotal * rate) / 100);
  const muniTotal = Math.min(taxTotal, round2((subtotal * muniRate) / 100));
  const stateTotal = round2(taxTotal - muniTotal);

  return {
    subtotal,
    tax_type: type,
    tax_rate: rate,
    tax_muni_rate: muniRate,
    tax_total: taxTotal,
    tax_state_total: stateTotal,
    tax_muni_total: muniTotal,
    total: round2(subtotal + taxTotal),
  };
}
