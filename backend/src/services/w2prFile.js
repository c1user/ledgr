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
 * The "TY2025-PLACEHOLDER" layout implemented here is an ILLUSTRATIVE
 * fixed-width structure (512-char records, RA submitter → RE employer →
 * RS per employee → RT totals → RF final) modeled on the EFW2-style
 * conventions and our proven 480.6SP builder (suriFile.js). It exists so
 * the pipeline is testable end to end; the REAL record layout is a
 * TAX_DATA_TODO item and replaces this when the human verifies the rule
 * and updates this builder.
 *
 * SSNs: the electronic file necessarily carries full SSNs (it is the
 * filing) — decrypted by the route directly into the download, never
 * logged. The DRAFT PDF is for review and carries masked SSNs only.
 */

import PDFDocument from "pdfkit";

export const SUPPORTED_SPEC_VERSIONS = ["TY2025-PLACEHOLDER"];

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

  const records = [ra, re, ...rsRecords, rt, rf];
  for (const r of records) {
    if (r.length !== RECORD_LEN) {
      throw new Error(`w2prFile: record length ${r.length} ≠ ${RECORD_LEN}`);
    }
  }

  return {
    content: records.join("\r\n") + "\r\n",
    filename: `W2PR${year}.txt`,
    warnings,
  };
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
