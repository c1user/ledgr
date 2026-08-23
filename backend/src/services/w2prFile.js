/**
 * services/w2prFile.js — W-2PR (Form 499R-2) electronic submission file
 * (ROADMAP-V5 · Phase 5.5), plus the per-employee draft PDF.
 *
 * SPEC-VERSION-IS-DATA discipline: Hacienda publishes the electronic
 * filing layout ANNUALLY, and the version this builder implements is
 * pinned in SUPPORTED_SPEC_VERSIONS. The w2pr_file_spec rule names the
 * version to produce; a version this builder does not implement fails
 * loudly — the file can never silently follow a stale layout.
 *
 * Two layouts are implemented:
 *
 *   "EFW2PR-TY2025" — the REAL layout per Hacienda Publication 25-01
 *   (Rev. Sept 23, 2025), "Developer Guide — Form 499R-2/W-2PR (Copy A)
 *   Electronic Filing Requirements for Tax Year 2025". EFW2PR format:
 *   nine mandatory 512-byte ASCII records (RA submitter, RE employer,
 *   then RW/RO/RS per employee, RT/RU/RV totals, RF final), each
 *   terminated CR+LF. Money = integer cents, right-justified zero-filled.
 *   Concepts the engine doesn't produce yet (commissions, tips,
 *   allowances, CODA, exempt-salary codes, charitable contributions,
 *   health coverage) are correctly zero-filled. The w2pr_file_spec rule
 *   still gates production generation until a human VERIFIES it against
 *   the publication — and the TY2026 pub (expected fall 2026) must be
 *   diffed before the January 2027 filing.
 *
 *   "TY2025-PLACEHOLDER" — the original ILLUSTRATIVE structure, kept so
 *   businesses whose seeded rule still names it keep working in sandbox.
 *
 * SSNs: the electronic file necessarily carries full SSNs (it is the
 * filing) — decrypted by the route directly into the download, never
 * logged. The DRAFT PDF is for review and carries masked SSNs only.
 */

import PDFDocument from "pdfkit";

export const SUPPORTED_SPEC_VERSIONS = ["EFW2PR-TY2025", "TY2025-PLACEHOLDER"];

const RECORD_LEN = 512;

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

/** Left-justified alpha, blank-filled. */
function alpha(v, len) {
  return String(v ?? "")
    .toUpperCase()
    .slice(0, len)
    .padEnd(len, " ");
}

/** Right-justified numeric, zero-filled. */
function num(v, len) {
  return digits(v).slice(-len).padStart(len, "0");
}

/** Money: integer cents, right-justified, zero-filled, no punctuation. */
function money(cents, len) {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  return String(c).padStart(len, "0").slice(-len);
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

// ── EFW2PR-TY2025 helpers (Pub 25-01 format rules) ───────────

const zeros = (len) => "0".repeat(len);

/** Strip accents (Pub 25-01: uppercase without accents everywhere). */
function translit(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Uppercase accent-free alpha, left-justified blank-filled. */
function alphaE(v, len) {
  return translit(v).toUpperCase().slice(0, len).padEnd(len, " ");
}

/**
 * Name fields allow only alphanumerics plus "- &" (person names) or
 * "- & . ," (company names) per Pub 25-01 "What is New".
 */
function nameField(v, len, extra = "") {
  const allowed = new RegExp(`[^A-Z0-9 \\-&${extra.replace(/[.,]/g, "\\$&")}]`, "g");
  return translit(v)
    .toUpperCase()
    .replace(allowed, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, len)
    .padEnd(len, " ");
}

/** E-mail is the one mixed-case field (RA 446-485 / RE 279-318). */
function emailField(v, len) {
  return String(v ?? "").slice(0, len).padEnd(len, " ");
}

/**
 * Pub 25-01 p. 19 SSN rules: 9 digits; may not begin with 666 or 9; may
 * not be all one repeated digit; may not be 123456789 or 987654321; may
 * not be blank or zeros. Returns a warning slug or null.
 */
function ssnProblem(ssn) {
  if (!ssn) return "missing_ssn";
  const s = digits(ssn);
  if (s.length !== 9 || /^0+$/.test(s)) return "invalid_ssn";
  if (s.startsWith("666") || s.startsWith("9")) return "invalid_ssn";
  if (/^(\d)\1{8}$/.test(s)) return "invalid_ssn";
  if (s === "123456789" || s === "987654321") return "invalid_ssn";
  return null;
}

/**
 * "First Last1 Last2" → { first, middle, last }. PR names typically carry
 * two surnames, so everything after the first token is the last name; the
 * middle-name field is left blank (we don't store it separately). Names
 * must match the Social Security card — the review draft is for checking.
 */
function splitEmployeeName(name) {
  const tokens = translit(String(name ?? ""))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return { first: "", middle: "", last: "" };
  if (tokens.length === 1) return { first: "", middle: "", last: tokens[0] };
  return { first: tokens[0], middle: "", last: tokens.slice(1).join(" ") };
}

/**
 * The real EFW2PR layout per Hacienda Publication 25-01 (TY2025).
 * Employees additionally carry: addressStreet, addressCity, addressState,
 * addressZip (nullable — warned when missing). Employer additionally
 * uses: email (contact e-mail, required by RE 279-318) and phone (none
 * stored today → warned, blank/zero-filled).
 */
function buildEfw2pr({ year, employer, contactEmail, employees }) {
  const warnings = [];
  const einDigits = digits(employer.tax_id);
  const ein = num(employer.tax_id, 9);
  const email = contactEmail || employer.email || "";
  const phone = digits(employer.phone || "");
  if (!einDigits) warnings.push("missing_employer_ein");
  else if (einDigits.length !== 9) warnings.push("invalid_employer_ein");
  if (!email) warnings.push("missing_contact_email");
  if (!phone) warnings.push("missing_employer_phone");

  const zip5 = (z) => alphaE(digits(z).slice(0, 5), 5);
  // Pub 25-01 address layout: Line 1 (Location) is attention/suite —
  // which we don't store — and Line 2 (Delivery) is the street or PO box
  // used "to prepare mail correspondence". Streets go on Line 2.

  // RA — Submitter Record (Pub 25-01 pp. 23-26). Submitter = employer
  // (self-filed through the employer's own SURI account).
  const ra = record([
    [1, "RA"],
    [3, ein],
    // 12-19 SSA User ID — SSA-only; blank for Hacienda.
    [29, "0"], // Resub Indicator: original file
    [36, "98"], // Software Code: in-house program
    [38, nameField(employer.name, 57, ".,")], // Company Name
    [117, alphaE(employer.address, 22)], // Delivery Address (street)
    [139, alphaE(employer.city, 22)],
    [161, alphaE(employer.state, 2)],
    [163, zip5(employer.zip)],
    [217, nameField(employer.name, 57, ".,")], // Submitter Name
    [296, alphaE(employer.address, 22)], // Delivery Address (street)
    [318, alphaE(employer.city, 22)],
    [340, alphaE(employer.state, 2)],
    [342, zip5(employer.zip)],
    [396, nameField(employer.name, 27)], // Contact Name
    [423, alphaE(phone, 15)], // Contact Phone
    [446, emailField(email, 40)], // Contact E-Mail (mixed case OK)
    // 489-498 Contact Fax: "Otherwise, fill with blanks" — blank is right.
    [499, "2"], // Preferred Method of Problem Notification — the only
    // value Pub 25-01 defines (p. 26): "2" = U.S. Postal Service.
    [500, "L"], // Preparer Code: self-prepared
  ]);

  // RE — Employer Record (Pub 25-01 pp. 27-30).
  const re = record([
    [1, "RE"],
    [3, num(year, 4)],
    [8, ein],
    [26, "0"], // Terminating Business Indicator
    [40, nameField(employer.name, 57, ".,")],
    [119, alphaE(employer.address, 22)], // Delivery Address (street)
    [141, alphaE(employer.city, 22)],
    [163, alphaE(employer.state, 2)],
    [165, zip5(employer.zip)],
    [219, "R"], // Employment Code: regular (Form 941)
    [220, "P"], // Tax Jurisdiction Code: Puerto Rico
    [221, "0"], // Third-Party Sick Pay Indicator
    [222, nameField(employer.name, 27)], // Employer Contact Name
    [249, alphaE(phone, 15)], // Employer Contact Phone (required)
    // 269-278 Employer Contact Fax: the one empty field the spec says to
    // ZERO-fill ("Otherwise, fill with zeros" — p. 30), unlike RA's fax.
    [269, zeros(10)],
    [279, emailField(email, 40)], // Employer Contact E-Mail (required)
  ]);

  const employeeRecords = [];
  const totals = {
    ssWages: 0,
    ssTax: 0,
    medWages: 0,
    medTax: 0,
    wages: 0,
    prTax: 0,
  };

  employees.forEach((e, i) => {
    const ssnIssue = ssnProblem(e.ssn);
    if (ssnIssue) warnings.push(`${ssnIssue}: ${e.name}`);
    if (!e.addressStreet || !e.addressCity || !e.addressZip) {
      warnings.push(`missing_address: ${e.name}`);
    }
    const stateRaw = translit(e.addressState || "PR").toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(stateRaw)) {
      warnings.push(`invalid_address_state: ${e.name}`);
    }
    const { first, middle, last } = splitEmployeeName(e.name);
    const ssn = num(e.ssn || "0", 9);
    const state = alphaE(stateRaw, 2);

    // RW — federal-side wages (Pub 25-01 pp. 31-35). Street on Line 2
    // (Delivery Address) per the spec; Line 1 is attention/suite.
    employeeRecords.push(
      record([
        [1, "RW"],
        [3, ssn],
        [12, nameField(first, 15)],
        [27, nameField(middle, 15)],
        [42, nameField(last, 20)],
        [88, alphaE(e.addressStreet, 22)],
        [110, alphaE(e.addressCity, 22)],
        [132, state],
        [134, zip5(e.addressZip)],
        [188, zeros(22)],
        [210, money(e.ssWagesCents, 11)],
        [221, money(e.ssWithheldCents, 11)],
        [232, money(e.medicareWagesCents, 11)],
        [243, money(e.medicareWithheldCents, 11)],
        [254, money(0, 11)], // Social Security tips
        [265, zeros(132)],
        [408, zeros(55)],
        [463, money(0, 11)], // employer-sponsored health coverage
        [474, money(0, 11)], // QSEHRA
        [486, "0"], // statutory employee
        [488, "0"], // retirement plan
        [489, "0"], // third-party sick pay
      ]),
    );

    // RO — PR wages and withholding (Pub 25-01 pp. 36-38). Box 11 total
    // MUST equal Boxes 7+8+9+10; the engine has no commissions/allowances/
    // tips concepts yet, so everything is wages (Box 7).
    employeeRecords.push(
      record([
        [1, "RO"],
        [12, zeros(11)],
        [23, money(0, 11)], // uncollected employee tax on tips
        [34, zeros(66)],
        [275, money(e.grossCents, 11)], // Box 7 wages
        [286, money(0, 11)], // Box 8 commissions
        [297, money(0, 11)], // Box 9 allowances
        [308, money(0, 11)], // Box 10 tips
        [319, money(e.grossCents, 11)], // Box 11 total (= 7+8+9+10)
        [330, money(e.prTaxCents, 11)], // Box 13 PR tax withheld
        [341, money(0, 11)], // Box 14 governmental retirement fund
        [363, zeros(22)],
      ]),
    );

    // RS — PR state record (Pub 25-01 pp. 39-44). Control number: unique
    // 9 digits per employer + form type + tax year, assigned by the
    // employer; sequential from 1 (900000000+ is reserved for Hacienda).
    employeeRecords.push(
      record([
        [1, "RS"],
        [3, "00"],
        [5, "00000"],
        [10, ssn],
        [19, nameField(first, 15)],
        [34, nameField(middle, 15)],
        [49, nameField(last, 20)],
        [95, alphaE(e.addressStreet, 22)], // Delivery Address (street)
        [117, alphaE(e.addressCity, 22)],
        [139, state],
        [141, zip5(e.addressZip)],
        [195, money(0, 11)], // Box 6 charitable contributions
        [206, money(0, 11)], // Box 19 Save and Double your Money
        [217, zeros(15)],
        [232, money(0, 11)], // Box 18 exempt salaries B
        [274, zeros(34)],
        [309, zeros(22)],
        [356, num(i + 1, 9)], // control number
        [376, money(0, 11)], // Box 15 CODA plans
        [387, money(0, 11)], // Box 12 reimbursed expenses
        [404, money(0, 11)], // Box 25 uncollected SS tax on tips
        [415, money(0, 11)], // Box 26 uncollected Medicare tax on tips
        [431, money(0, 11)], // Box 16 exempt salaries
        [488, money(0, 11)], // Box 17 exempt salaries A
      ]),
    );

    // Accumulate the CLAMPED per-employee values (money() floors negatives
    // to zero) so RT/RU/RV always equal the sum of the rendered fields —
    // Pub 25-01's checklist enforces exactly that consistency.
    const pos = (c) => Math.max(0, Math.round(Number(c) || 0));
    totals.ssWages += pos(e.ssWagesCents);
    totals.ssTax += pos(e.ssWithheldCents);
    totals.medWages += pos(e.medicareWagesCents);
    totals.medTax += pos(e.medicareWithheldCents);
    totals.wages += pos(e.grossCents);
    totals.prTax += pos(e.prTaxCents);
  });

  const n = employees.length;

  // RT — totals of RW (Pub 25-01 pp. 45-46).
  const rt = record([
    [1, "RT"],
    [3, num(n, 7)],
    [10, zeros(30)],
    [40, money(totals.ssWages, 15)],
    [55, money(totals.ssTax, 15)],
    [70, money(totals.medWages, 15)],
    [85, money(totals.medTax, 15)],
    [100, money(0, 15)], // SS tips
    [115, zeros(180)],
    [295, money(0, 15)], // health coverage
    [310, zeros(90)],
    [400, money(0, 15)], // QSEHRA
  ]);

  // RU — totals of RO (Pub 25-01 pp. 47-48).
  const ru = record([
    [1, "RU"],
    [3, num(n, 7)],
    [10, zeros(15)],
    [25, money(0, 15)], // uncollected employee tax on tips
    [40, zeros(90)],
    [355, money(totals.wages, 15)],
    [370, money(0, 15)], // commissions
    [385, money(0, 15)], // allowances
    [400, money(0, 15)], // tips
    [415, money(totals.wages, 15)], // total wages/comm/allow/tips
    [430, money(totals.prTax, 15)],
    [445, money(0, 15)], // governmental retirement fund
    [460, zeros(30)],
  ]);

  // RV — PR state totals of RS (Pub 25-01 p. 49).
  const rv = record([
    [1, "RV"],
    [3, phone ? num(phone, 10) : zeros(10)], // employer phone
    [33, money(0, 15)], // reimbursed expenses
    [48, money(0, 15)], // CODA plans
    [63, money(0, 15)], // exempt salaries (16+17+18)
    [78, money(0, 15)], // uncollected SS tax on tips
    [93, money(0, 15)], // uncollected Medicare tax on tips
    [108, money(0, 15)], // charitable contributions
    [123, money(0, 15)], // Save and Double your Money
  ]);

  // RF — final record: count of RW records (Pub 25-01 p. 50).
  const rf = record([
    [1, "RF"],
    [8, num(n, 9)],
  ]);

  return {
    records: [ra, re, ...employeeRecords, rt, ru, rv, rf],
    warnings,
  };
}

/**
 * Build the W-2PR electronic file.
 *
 * @param {object} p
 * @param {string} p.specVersion - from the w2pr_file_spec rule payload
 * @param {number} p.year - tax year
 * @param {object} p.employer - { name, address, city, state, zip, tax_id }
 * @param {string} [p.contactEmail]
 * @param {Array}  p.employees - [{ name, ssn (9 digits or null),
 *   grossCents, prTaxCents, ssWagesCents, ssWithheldCents,
 *   medicareWagesCents, medicareWithheldCents }]
 * @returns {{ content: string, filename: string, warnings: string[] }}
 */
export function buildW2prFile({
  specVersion,
  year,
  employer,
  contactEmail,
  employees,
}) {
  if (!SUPPORTED_SPEC_VERSIONS.includes(specVersion)) {
    throw new Error(
      `w2prFile: spec version "${specVersion}" is not implemented by this builder ` +
        `(supported: ${SUPPORTED_SPEC_VERSIONS.join(", ")}). Update the builder ` +
        `to the newly verified Hacienda layout before filing.`,
    );
  }

  const built =
    specVersion === "EFW2PR-TY2025"
      ? buildEfw2pr({ year, employer, contactEmail, employees })
      : buildPlaceholder({ year, employer, contactEmail, employees });

  for (const r of built.records) {
    if (r.length !== RECORD_LEN) {
      throw new Error(`w2prFile: record length ${r.length} ≠ ${RECORD_LEN}`);
    }
  }

  return {
    content: built.records.join("\r\n") + "\r\n",
    filename: `W2PR${year}.txt`,
    warnings: built.warnings,
  };
}

/** The original illustrative layout (see header). */
function buildPlaceholder({ year, employer, contactEmail, employees }) {
  const warnings = [];
  const ein = num(employer.tax_id, 9);

  const ra = record([
    [1, "RA"],
    [3, ein],
    [12, alpha(employer.name, 57)],
    [69, alpha(employer.address, 22)],
    [91, alpha(employer.city, 22)],
    [113, alpha(employer.state, 2)],
    [115, alpha(digits(employer.zip).slice(0, 5), 5)],
    [120, alpha(contactEmail || "", 40)],
    [160, num(year, 4)],
  ]);

  const re = record([
    [1, "RE"],
    [3, num(year, 4)],
    [8, ein],
    [17, alpha(employer.name, 57)],
    [74, alpha(employer.address, 22)],
    [96, alpha(employer.city, 22)],
    [118, alpha(employer.state, 2)],
    [120, alpha(digits(employer.zip).slice(0, 5), 5)],
  ]);

  const rsRecords = employees.map((e, i) => {
    if (!e.ssn) {
      warnings.push(`missing_ssn: ${e.name}`);
    }
    return record([
      [1, "RS"],
      [3, num(e.ssn || "0", 9)],
      [12, alpha(e.name, 57)],
      [69, num(i + 1, 7)], // sequence
      [76, money(e.grossCents, 11)],
      [87, money(e.prTaxCents, 11)],
      [98, money(e.ssWagesCents, 11)],
      [109, money(e.ssWithheldCents, 11)],
      [120, money(e.medicareWagesCents, 11)],
      [131, money(e.medicareWithheldCents, 11)],
    ]);
  });

  const totals = employees.reduce(
    (acc, e) => ({
      gross: acc.gross + (e.grossCents || 0),
      prTax: acc.prTax + (e.prTaxCents || 0),
      ssWages: acc.ssWages + (e.ssWagesCents || 0),
      ssWithheld: acc.ssWithheld + (e.ssWithheldCents || 0),
      medicareWages: acc.medicareWages + (e.medicareWagesCents || 0),
      medicareWithheld: acc.medicareWithheld + (e.medicareWithheldCents || 0),
    }),
    {
      gross: 0,
      prTax: 0,
      ssWages: 0,
      ssWithheld: 0,
      medicareWages: 0,
      medicareWithheld: 0,
    },
  );

  const rt = record([
    [1, "RT"],
    [3, num(employees.length, 7)],
    [10, money(totals.gross, 15)],
    [25, money(totals.prTax, 15)],
    [40, money(totals.ssWages, 15)],
    [55, money(totals.ssWithheld, 15)],
    [70, money(totals.medicareWages, 15)],
    [85, money(totals.medicareWithheld, 15)],
  ]);

  const rf = record([
    [1, "RF"],
    [3, num(rsRecords.length + 4, 9)], // total records incl RA/RE/RT/RF
  ]);

  return { records: [ra, re, ...rsRecords, rt, rf], warnings };
}

// ── Draft PDF (review copy — masked SSNs, marked BORRADOR) ───

const money$ = (cents) =>
  new Intl.NumberFormat("es-PR", { style: "currency", currency: "USD" }).format(
    (Number(cents) || 0) / 100,
  );

/**
 * One draft page per employee. Not a filing document.
 * @returns {Promise<Buffer>}
 */
export function buildW2prDraftPdf({ year, employer, employees, watermark }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
      autoFirstPage: false,
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const e of employees) {
      doc.addPage();
      let y = 50;

      doc.rect(50, y, 512, 26).fill("#fff4e5");
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#8a5a00")
        .text("BORRADOR — NO RADICAR / DRAFT — DO NOT FILE", 50, y + 7, {
          width: 512,
          align: "center",
        });
      y += 34;

      if (watermark) {
        doc.rect(50, y, 512, 22).fill("#fdecec");
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#b3261e")
          .text("CÁLCULO NO VERIFICADO — SOLO PRUEBAS", 50, y + 6, {
            width: 512,
            align: "center",
          });
        y += 30;
      }

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#191524");
      doc.text(`W-2PR ${year} (borrador / draft)`, 50, y);
      y += 22;
      doc.font("Helvetica").fontSize(9).fillColor("#4f4a60");
      doc.text(`${employer.name} · EIN ${employer.tax_id || "—"}`, 50, y);
      y += 14;
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#191524");
      doc.text(e.name, 50, y);
      doc.font("Helvetica").fontSize(9).fillColor("#4f4a60");
      doc.text(
        `SSN: ${e.ssnLast4 ? `***-**-${e.ssnLast4}` : "— (falta / missing)"}`,
        400,
        y,
      );
      y += 24;

      const rows = [
        ["Sueldos / Wages", e.grossCents],
        ["Contribución retenida / PR tax withheld", e.prTaxCents],
        ["Salarios Seguro Social / SS wages", e.ssWagesCents],
        ["Seguro Social retenido / SS withheld", e.ssWithheldCents],
        ["Salarios Medicare / Medicare wages", e.medicareWagesCents],
        ["Medicare retenido / Medicare withheld", e.medicareWithheldCents],
      ];
      for (const [label, cents] of rows) {
        doc
          .moveTo(50, y + 13)
          .lineTo(562, y + 13)
          .strokeColor("#e5e2eb")
          .stroke();
        doc.font("Helvetica").fontSize(10).fillColor("#191524");
        doc.text(label, 50, y, { width: 380 });
        doc.text(money$(cents), 400, y, { width: 162, align: "right" });
        y += 18;
      }
    }

    doc.end();
  });
}
