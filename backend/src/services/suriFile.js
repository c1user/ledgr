/**
 * services/suriFile.js — SURI bulk-filing text file for Form 480.6SP.
 *
 * Implements Hacienda Publication 25-03 v2.0 (Developer Guide, Informative
 * Returns Electronic Filing, taxable year 2025 layout):
 *   https://hacienda.pr.gov/ → Publicación 25-03
 *
 * File = fixed-width ASCII records of exactly 2500 characters, in order:
 *   480.SU submitter (Exhibit X) → 480.PA employer (Exhibit V) →
 *   one 480.6SP detail per payee (Exhibit J) →
 *   480.6SP.2 reconciliation (Exhibit U) → 480.5 summary (Exhibit O).
 *
 * Money fields: cents ×100, right-justified, zero-filled, no punctuation.
 * Alpha fields: left-justified, blank-filled. Detail records carry the
 * Treasury-assigned control numbers (sequential from the range the filer
 * obtained in SURI); summary records use zeros per spec.
 *
 * v1 limitation: vendors are exported as corporations/pass-through
 * entities (payee ID type "1" = FEIN, corporate amount columns) — the app
 * stores one EIN field and doesn't distinguish individual payees.
 */

const RECORD_LEN = 2500;

// Keep only characters Hacienda allows in name fields.
function cleanName(v) {
  return String(v || "").replace(/[^A-Za-z0-9\-&., ]/g, "");
}

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

/** Left-justified alpha field, blank-filled, truncated to len. */
function alpha(v, len) {
  return String(v ?? "")
    .toUpperCase()
    .slice(0, len)
    .padEnd(len, " ");
}

/** Right-justified numeric field, zero-filled. */
function num(v, len) {
  return digits(v).slice(-len).padStart(len, "0");
}

/** Money per Pub 25-03: cents, right-justified, zero-filled. */
function money(v, len) {
  const cents = Math.round((Number(v) || 0) * 100);
  return String(Math.max(cents, 0)).padStart(len, "0").slice(-len);
}

/** Build one fixed-width record from [startPos(1-based), value] pairs. */
function record(fields) {
  const buf = Array(RECORD_LEN).fill(" ");
  for (const [start, value] of fields) {
    const s = String(value);
    for (let i = 0; i < s.length; i++) buf[start - 1 + i] = s[i];
  }
  return buf.join("");
}

// ── 480.SU — submitter information (Exhibit X) ───────────────
function buildSU(payer, contactEmail) {
  const name = cleanName(payer.name);
  return record([
    [1, "SU"],
    [3, num(payer.tax_id, 9)], // submitter EIN
    [12, "0"], // resub indicator: original
    [13, "98"], // software code: in-house program
    [15, alpha(name, 57)], // company name
    [94, alpha(payer.address, 22)], // delivery address
    [116, alpha(payer.city, 22)],
    [138, alpha(payer.state, 2)],
    [140, alpha(digits(payer.zip).slice(0, 5), 5)],
    [206, alpha(name, 57)], // submitter (notification) name
    [285, alpha(payer.address, 22)],
    [307, alpha(payer.city, 22)],
    [329, alpha(payer.state, 2)],
    [331, alpha(digits(payer.zip).slice(0, 5), 5)],
    [385, alpha(cleanName(payer.name), 27)], // contact name
    [435, alpha(contactEmail || "", 40)], // contact e-mail
  ]);
}

// ── 480.PA — employer information (Exhibit V) ────────────────
function buildPA(payer, year) {
  return record([
    [1, "PA"],
    [3, num(year, 4)],
    [8, num(payer.tax_id, 9)], // employer EIN
    [17, "H"], // type of form: 480.6SP
    [22, "O"], // type of file: original
    [40, alpha(cleanName(payer.name), 57)],
    [119, alpha(payer.address, 22)], // delivery address
    [141, alpha(payer.city, 22)],
    [163, alpha(payer.state, 2)],
    [165, alpha(digits(payer.zip).slice(0, 5), 5)],
  ]);
}

// ── 480.6SP detail record (Exhibit J) ────────────────────────
function buildDetail(vendor, payer, year, controlNumber) {
  return record([
    [2, num(controlNumber, 9)], // Treasury-assigned control number
    [11, "1"], // payee ID type: FEIN (v1 — see header note)
    [13, "H"], // form type 480.6SP
    [14, "1"], // record type: detail
    [15, "O"], // document type: original
    [18, num(year, 4)],
    // payer block
    [31, "1"], // payer ID type: FEIN
    [32, num(payer.tax_id, 9)],
    [41, alpha(cleanName(payer.name), 30)],
    [71, alpha(payer.address, 35)],
    [141, alpha(payer.city, 13)],
    [154, alpha(payer.state, 2)],
    [156, num(digits(payer.zip).slice(0, 5), 5)],
    [161, "0000"], // zip extension
    // payee block
    [167, num(vendor.ein, 9)],
    [196, alpha(cleanName(vendor.name), 30)],
    [226, alpha(vendor.address, 35)],
    [296, alpha(vendor.city, 13)],
    [309, alpha(vendor.state, 2)],
    [311, num(digits(vendor.zip).slice(0, 5), 5)],
    [316, "0000"],
    // amounts — corporation/pass-through columns (form items 2 & 4)
    [321, money(0, 12)], // item 1: individuals not subject
    [333, money(vendor.not_subject, 12)], // item 2: corps not subject
    [345, money(0, 12)], // item 3: individuals subject
    [357, money(0, 10)], // item 3: individuals withheld
    [367, money(vendor.subject, 12)], // item 4: corps subject
    [379, money(vendor.withheld, 10)], // item 4: corps withheld
    [391, money(0, 12)], // Act 48-2013 special contribution
    [403, money(0, 12)], // reimbursed expenses
    [415, money(0, 12)], // health providers
    // waiver certificate, when on file
    [434, alpha(vendor.waiver_certificate_no || "", 20)],
  ]);
}

// ── 480.6SP.2 reconciliation (Exhibit U) ─────────────────────
function buildSP2(payer, vendors, year, totals) {
  const name = cleanName(payer.name);
  const zip5 = digits(payer.zip).slice(0, 5);
  return record([
    [2, "000000000"], // control number: zeros per spec
    [13, "I"], // form type 480.6SP.2
    [14, "1"],
    [15, "O"],
    [18, num(year, 4)],
    [27, "1"], // payer ID type: FEIN
    [48, num(payer.tax_id, 9)],
    [57, alpha(name, 30)], // business name
    [87, alpha(name, 30)], // withholding agent's name
    [117, "0000000000"], // telephone (not stored)
    [127, alpha(payer.address, 35)], // postal address 1
    [197, alpha(payer.city, 13)],
    [210, alpha(payer.state, 2)],
    [212, num(zip5, 5)],
    [217, "0000"],
    [223, alpha(payer.address, 35)], // physical address 1
    [293, alpha(payer.city, 13)],
    [306, alpha(payer.state, 2)],
    [308, num(zip5, 5)],
    [313, "0000"],
    [324, num(vendors.length, 10)], // total forms 480.6SP
    [334, money(0, 15)], // health providers
    [349, money(0, 15)], // reimbursed expenses
    [364, money(0, 15)], // Act 48-2013
    [379, money(0, 15)], // item 1: individuals not subject
    [394, money(totals.not_subject, 15)], // item 2: corps not subject
    [409, money(0, 15)], // item 3: individuals subject
    [424, money(0, 15)], // item 3: individuals withheld
    [439, money(totals.subject, 15)], // item 4: corps subject
    [454, money(totals.withheld, 15)], // item 4: corps withheld
    [469, money(totals.gross, 15)], // total payments
    [484, money(totals.withheld, 15)], // total withheld
    [499, "0"], // specialist paid: no (self-prepared)
    [500, "0"], // specialist self-employed: no
    [501, "0000000"], // specialist registration number
  ]);
}

// ── 480.5 summary (Exhibit O) ────────────────────────────────
function build4805(payer, vendors, year, totals) {
  return record([
    [2, "000000000"], // control number: zeros per spec
    [13, "H"], // summarizing form type 480.6SP
    [14, "1"],
    [15, "O"],
    [18, num(year, 4)],
    [23, "1"], // payer ID type: FEIN
    [24, num(payer.tax_id, 9)],
    [33, alpha(cleanName(payer.name), 30)],
    [63, alpha(payer.address, 35)],
    [133, alpha(payer.city, 13)],
    [146, alpha(payer.state, 2)],
    [148, num(digits(payer.zip).slice(0, 5), 5)],
    [153, "0000"],
    [159, num(vendors.length, 10)], // number of documents
    [169, money(totals.withheld, 15)], // total amount withheld
    [184, money(totals.gross, 15)], // total amount paid
  ]);
}

/**
 * Build the complete F4806SPY file content.
 * @param {object} p
 * @param {object} p.payer   business row: name, tax_id, address, city, state, zip
 * @param {Array}  p.vendors flagged 480.6SP vendors (fetch480spVendors shape)
 * @param {number} p.year    taxable year
 * @param {number} p.controlStart first Treasury-assigned control number
 * @param {string} [p.contactEmail]
 * @returns {{ content: string, filename: string }}
 */
export function buildSuriFile({ payer, vendors, year, controlStart, contactEmail }) {
  const totals = vendors.reduce(
    (acc, v) => ({
      gross: acc.gross + v.gross_paid,
      subject: acc.subject + v.subject,
      withheld: acc.withheld + v.withheld,
      not_subject: acc.not_subject + v.not_subject,
    }),
    { gross: 0, subject: 0, withheld: 0, not_subject: 0 },
  );

  const records = [
    buildSU(payer, contactEmail),
    buildPA(payer, year),
    ...vendors.map((v, i) => buildDetail(v, payer, year, controlStart + i)),
    buildSP2(payer, vendors, year, totals),
    build4805(payer, vendors, year, totals),
  ];

  for (const r of records) {
    if (r.length !== RECORD_LEN) {
      throw new Error(`SURI record length ${r.length} ≠ ${RECORD_LEN}`);
    }
  }

  return {
    content: records.join("\r\n") + "\r\n",
    filename: `F4806SPY${String(year).slice(-2)}.txt`,
  };
}
