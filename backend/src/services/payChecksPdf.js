/**
 * services/payChecksPdf.js — printable check run (ROADMAP-V5 · Phase 4.2).
 *
 * Standard pre-printed business check stock, check-on-top with two stubs
 * below (employee copy + employer copy). The stock carries the bank
 * identity and MICR line — this layer prints ONLY: date, payee, numeric
 * amount, amount in words, and memo, positioned for the stock's boxes.
 *
 * Alignment: per-employer X/Y offsets in millimeters
 * (payroll_employer_profiles.check_offset_x_mm / _y_mm, migration 033) —
 * nudge everything to match a specific printer/stock combination.
 *
 * Sandbox runs: the check region is struck through with a diagonal
 * "NO VÁLIDO — PRUEBAS" so a test page can never pass as a paycheck.
 */

import PDFDocument from "pdfkit";
import { amountInWords } from "./numberWords.js";

const MM = 2.8346; // points per millimeter

const money = (cents) =>
  new Intl.NumberFormat("es-PR", { style: "currency", currency: "USD" }).format(
    (Number(cents) || 0) / 100,
  );

const fmtDate = (value) => {
  const iso =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("es-PR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

function stubBlock(doc, { title, line, run }, x, y, width) {
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#191524");
  doc.text(title, x, y);
  doc.font("Helvetica").fontSize(7.5).fillColor("#4f4a60");
  doc.text(
    `${line.employee.name} · ${fmtDate(run.period_start)} — ${fmtDate(run.period_end)} · ${fmtDate(run.pay_date)}`,
    x,
    y + 11,
    { width },
  );
  const rows = [
    ["Bruto / Gross", line.gross_cents],
    ["Deducciones / Deductions", line.employee_deductions_cents],
    ["Neto / Net", line.net_cents],
  ];
  let ry = y + 24;
  for (const [label, cents] of rows) {
    doc.font("Helvetica").fontSize(7.5).fillColor("#191524");
    doc.text(label, x, ry, { width: width - 90 });
    doc.text(money(cents), x, ry, { width, align: "right" });
    ry += 11;
  }
  return ry;
}

/**
 * One page per pay line: check region on top, two stubs below.
 *
 * @param {object} p
 * @param {object} p.run - run + period fields
 * @param {Array}  p.lines - pay_lines with { employee }
 * @param {object} p.employer - business row
 * @param {object} p.offsets - { xMm, yMm }
 * @returns {Promise<Buffer>}
 */
export function buildPayChecksPdf({ run, lines, employer, offsets = {} }) {
  const dx = (Number(offsets.xMm) || 0) * MM;
  const dy = (Number(offsets.yMm) || 0) * MM;
  const sandbox = run.run_mode === "sandbox";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      autoFirstPage: false,
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const line of lines) {
      doc.addPage();

      // ── Check region (top ~3.5in of the stock) ──
      const cx = 36 + dx; // ~0.5in base margin
      const cy = 36 + dy;
      const cw = 540;

      // Date (stock's date box: right side, ~0.75in down)
      doc.font("Helvetica").fontSize(10).fillColor("#191524");
      doc.text(fmtDate(run.pay_date), cx + 420, cy + 18, { width: 110 });

      // Payee + numeric amount (~1.35in down)
      doc.font("Helvetica-Bold").fontSize(11);
      doc.text(line.employee.name, cx + 60, cy + 62, { width: 300 });
      doc.text(`**${money(line.net_cents)}`, cx + 420, cy + 62, {
        width: 110,
        align: "right",
      });

      // Amount in words (~1.8in down, full width line) — Spanish primary
      doc.font("Helvetica").fontSize(9);
      doc.text(
        `**${amountInWords(Number(line.net_cents), "es")}**`,
        cx + 12,
        cy + 95,
        {
          width: cw - 40,
        },
      );
      doc.fontSize(6.5).fillColor("#8a8598");
      doc.text(
        amountInWords(Number(line.net_cents), "en"),
        cx + 12,
        doc.y + 1,
        {
          width: cw - 40,
        },
      );

      // Memo (bottom-left of check region)
      doc.font("Helvetica").fontSize(8).fillColor("#191524");
      doc.text(
        `Nómina ${fmtDate(run.period_start)} — ${fmtDate(run.period_end)}`,
        cx + 40,
        cy + 172,
        { width: 260 },
      );

      // Sandbox strike-through
      if (sandbox) {
        doc.save();
        doc
          .font("Helvetica-Bold")
          .fontSize(28)
          .fillColor("#b3261e")
          .opacity(0.45)
          .rotate(-12, { origin: [306, 130] })
          .text("NO VÁLIDO — PRUEBAS", 90, 115, { width: 440, align: "center" })
          .rotate(12, { origin: [306, 130] })
          .opacity(1);
        doc.restore();
      }

      // ── Stub 1 (employee copy) + Stub 2 (employer copy) ──
      const stubY1 = 300 + dy;
      const stubY2 = 540 + dy;
      doc
        .moveTo(24, stubY1 - 16)
        .lineTo(588, stubY1 - 16)
        .dash(3, { space: 3 })
        .strokeColor("#b9b5c4")
        .stroke()
        .undash();
      stubBlock(
        doc,
        {
          title: `${employer.name} — Copia empleado(a) / Employee copy`,
          line,
          run,
        },
        36 + dx,
        stubY1,
        540,
      );
      doc
        .moveTo(24, stubY2 - 16)
        .lineTo(588, stubY2 - 16)
        .dash(3, { space: 3 })
        .strokeColor("#b9b5c4")
        .stroke()
        .undash();
      stubBlock(
        doc,
        {
          title: `${employer.name} — Copia patrono / Employer copy`,
          line,
          run,
        },
        36 + dx,
        stubY2,
        540,
      );

      if (sandbox) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#b3261e");
        doc.text("CÁLCULO NO VERIFICADO — SOLO PRUEBAS", 36, 760, {
          width: 540,
          align: "center",
        });
      }
    }

    doc.end();
  });
}
