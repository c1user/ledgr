/**
 * services/payStubPdf.js — bilingual pay stubs (ROADMAP-V5 · Phase 4.1).
 *
 * Spanish primary, English secondary, one page per employee, all stubs of
 * a run in a single PDF (the one-click print). Built on pdfkit like
 * invoicePdf.js — resolves to an in-memory Buffer.
 *
 * Regulation 9017 discipline: the minimum field list is DATA (the
 * paystub_fields_9017 rule). This template renders a known superset of
 * fields; if the verified rule ever demands a field the template does not
 * know, the stub carries a visible warning box naming it and the caller
 * receives it in `warnings` — the gap is never silent.
 *
 * Sandbox runs: every page carries the watermark banner (spec §1.2).
 * SSNs: only the masked last-4 ever reaches a stub.
 */

import PDFDocument from "pdfkit";
import { SANDBOX_WATERMARK } from "./payrollRules.js";

// Field keys this template knows how to render (superset of the
// placeholder 9017 list). Compared against the rule's required_fields.
const KNOWN_FIELDS = new Set([
  "employer_name",
  "employer_address",
  "employer_ein",
  "employee_name",
  "period_start",
  "period_end",
  "payment_date",
  "hours_regular",
  "hours_overtime",
  "rates_by_type",
  "gross_pay",
  "itemized_deductions",
  "net_pay",
]);

// Bilingual labels: Spanish primary / English secondary.
const L = {
  title: ["Comprobante de pago", "Pay stub"],
  employer: ["Patrono", "Employer"],
  ein: ["EIN patronal", "Employer EIN"],
  employee: ["Empleado(a)", "Employee"],
  ssn: ["Seguro Social", "SSN"],
  period: ["Período de pago", "Pay period"],
  paymentDate: ["Fecha de pago", "Payment date"],
  earnings: ["Ingresos", "Earnings"],
  hours: ["Horas", "Hours"],
  rate: ["Tarifa", "Rate"],
  amount: ["Importe", "Amount"],
  deductions: ["Deducciones del empleado", "Employee deductions"],
  current: ["Actual", "Current"],
  ytd: ["Acumulado año", "YTD"],
  employerContrib: ["Aportaciones patronales", "Employer contributions"],
  grossPay: ["Sueldo bruto", "Gross pay"],
  totalDeductions: ["Total deducciones", "Total deductions"],
  netPay: ["PAGO NETO", "NET PAY"],
  missingFields: [
    "AVISO: la regla de campos del talonario exige campos que esta plantilla no rinde:",
    "NOTICE: the stub-field rule requires fields this template does not render:",
  ],
};

const ITEM_LABELS = {
  salary: ["Salario", "Salary"],
  regular: ["Horas regulares", "Regular hours"],
  overtime_daily: ["Horas extra (diarias)", "Overtime (daily)"],
  overtime_weekly: ["Horas extra (semanales)", "Overtime (weekly)"],
  meal_period_penalty: ["Período de tomar alimentos", "Meal-period penalty"],
  pr_income_tax: ["Contribución sobre ingresos PR", "PR income tax"],
  social_security: ["Seguro Social", "Social Security"],
  medicare: ["Medicare", "Medicare"],
  medicare_additional: ["Medicare adicional", "Additional Medicare"],
  sinot: ["SINOT", "SINOT"],
  seguro_choferil: ["Seguro choferil", "Chauffeurs' insurance"],
  manual: ["Deducción manual", "Manual deduction"],
  social_security_employer: ["Seguro Social (patrono)", "Social Security (ER)"],
  medicare_employer: ["Medicare (patrono)", "Medicare (ER)"],
  sinot_employer: ["SINOT (patrono)", "SINOT (ER)"],
  suta: ["Desempleo (SUTA)", "Unemployment (SUTA)"],
  seguro_choferil_employer: [
    "Seguro choferil (patrono)",
    "Chauffeurs' ins. (ER)",
  ],
  cfse: ["CFSE (Fondo)", "CFSE (workers' comp)"],
  christmas_bonus: ["Bono de Navidad (acumulación)", "Christmas bonus accrual"],
};

// YTD per deduction code, from the accumulator row (null = not tracked).
const YTD_COLUMN = {
  pr_income_tax: "pr_tax_withheld_cents",
  social_security: "ss_withheld_cents",
  medicare: "medicare_withheld_cents",
};

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
    month: "short",
    day: "numeric",
  });
};

function dual(doc, [es, en], x, y, opts = {}) {
  doc
    .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(opts.size || 9)
    .fillColor(opts.color || "#191524")
    .text(es, x, y, opts.layout || {});
  doc
    .font("Helvetica")
    .fontSize((opts.size || 9) - 2.5)
    .fillColor("#8a8598")
    .text(en, x, doc.y - 1, opts.layout || {});
  return doc.y;
}

/**
 * Missing 9017 fields for this template, per the (possibly updated) rule.
 */
export function stubFieldGaps(stubFieldsRule) {
  const required = stubFieldsRule?.payload?.required_fields || [];
  return required.filter((f) => !KNOWN_FIELDS.has(f));
}

/**
 * Build the all-stubs PDF for a run: one page per pay line.
 *
 * @param {object} p
 * @param {object} p.run - payroll_runs_v2 row + period fields (pay_date, period_start/end)
 * @param {Array}  p.lines - pay_lines rows each with { employee, items }
 * @param {object} p.employer - business row (name, address, city, state, zip, tax_id)
 * @param {Map|object} p.accumulatorsByEmployee - employee_id -> accumulator row
 * @param {object|null} p.stubFieldsRule - resolved paystub_fields_9017 rule
 * @returns {Promise<{ pdf: Buffer, warnings: string[] }>}
 */
export function buildPayStubsPdf({
  run,
  lines,
  employer,
  accumulatorsByEmployee = {},
  stubFieldsRule = null,
}) {
  const sandbox = run.run_mode === "sandbox";
  const gaps = stubFieldGaps(stubFieldsRule);
  const warnings = gaps.length
    ? [`unrendered_9017_fields: ${gaps.join(", ")}`]
    : [];
  const accOf = (employeeId) =>
    (accumulatorsByEmployee instanceof Map
      ? accumulatorsByEmployee.get(employeeId)
      : accumulatorsByEmployee[employeeId]) || {};

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 50,
      autoFirstPage: false,
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve({ pdf: Buffer.concat(chunks), warnings }));
    doc.on("error", reject);

    const left = 50;
    const right = 562;
    const width = right - left;

    for (const line of lines) {
      doc.addPage();
      let y = 50;

      // ── Sandbox watermark banner ──
      if (sandbox) {
        doc.rect(left, y, width, 26).fill("#fdecec");
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#b3261e")
          .text(SANDBOX_WATERMARK, left, y + 7, { width, align: "center" });
        y += 34;
      }

      // ── Header: employer + title ──
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#191524");
      doc.text(employer.name || "", left, y, { width: 300 });
      const addr = [
        employer.address,
        [employer.city, employer.state, employer.zip]
          .filter(Boolean)
          .join(", "),
      ]
        .filter(Boolean)
        .join(" · ");
      doc.font("Helvetica").fontSize(8).fillColor("#4f4a60");
      if (addr) doc.text(addr, left, doc.y + 2, { width: 300 });
      doc.text(
        `${L.ein[0]} / ${L.ein[1]}: ${employer.tax_id || "—"}`,
        left,
        doc.y + 1,
      );

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#191524");
      doc.text(L.title[0], left, y, { width, align: "right" });
      doc.font("Helvetica").fontSize(8).fillColor("#8a8598");
      doc.text(L.title[1], left, doc.y, { width, align: "right" });
      doc.text(
        `${L.paymentDate[0]} / ${L.paymentDate[1]}: ${fmtDate(run.pay_date)}`,
        left,
        doc.y + 4,
        { width, align: "right" },
      );

      y = Math.max(doc.y + 14, y + 64);

      // ── Employee + period box ──
      doc.rect(left, y, width, 40).fill("#f5f4f8");
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#191524");
      doc.text(line.employee.name, left + 10, y + 7);
      doc.font("Helvetica").fontSize(8).fillColor("#4f4a60");
      const ssn = line.employee.ssn_last4
        ? `***-**-${line.employee.ssn_last4}`
        : "—";
      doc.text(`${L.ssn[0]} / ${L.ssn[1]}: ${ssn}`, left + 10, y + 22);
      doc.text(
        `${L.period[0]} / ${L.period[1]}: ${fmtDate(run.period_start)} — ${fmtDate(run.period_end)}`,
        left + 250,
        y + 7,
      );
      if (line.employee.address) {
        doc.text(line.employee.address, left + 250, y + 22, { width: 250 });
      }
      y += 52;

      const itemsOf = (type) => line.items.filter((i) => i.item_type === type);
      const label = (code) => ITEM_LABELS[code] || [code, code];

      // ── Earnings table ──
      y = dual(doc, L.earnings, left, y, { bold: true, size: 10 }) + 4;
      doc.moveTo(left, y).lineTo(right, y).strokeColor("#d9d6e0").stroke();
      y += 4;
      doc.font("Helvetica").fontSize(8).fillColor("#8a8598");
      doc.text(`${L.hours[0]}/${L.hours[1]}`, left + 250, y, {
        width: 60,
        align: "right",
      });
      doc.text(`${L.rate[0]}/${L.rate[1]}`, left + 315, y, {
        width: 80,
        align: "right",
      });
      doc.text(`${L.amount[0]}/${L.amount[1]}`, left + 400, y, {
        width: 112,
        align: "right",
      });
      y += 12;
      for (const it of itemsOf("earning")) {
        const [es, en] = label(it.code);
        doc.font("Helvetica").fontSize(9).fillColor("#191524");
        doc.text(`${es} · ${en}`, left, y, { width: 245 });
        doc.text(
          it.quantity != null ? String(Number(it.quantity)) : "—",
          left + 250,
          y,
          { width: 60, align: "right" },
        );
        doc.text(
          it.rate_cents != null ? money(it.rate_cents) : "—",
          left + 315,
          y,
          {
            width: 80,
            align: "right",
          },
        );
        doc.text(money(it.amount_cents), left + 400, y, {
          width: 112,
          align: "right",
        });
        y += 14;
      }
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#191524");
      doc.text(`${L.grossPay[0]} / ${L.grossPay[1]}`, left, y, { width: 340 });
      doc.text(money(line.gross_cents), left + 400, y, {
        width: 112,
        align: "right",
      });
      y += 22;

      // ── Deductions table (with YTD) ──
      const acc = accOf(line.employee_id);
      y = dual(doc, L.deductions, left, y, { bold: true, size: 10 }) + 4;
      doc.moveTo(left, y).lineTo(right, y).strokeColor("#d9d6e0").stroke();
      y += 4;
      doc.font("Helvetica").fontSize(8).fillColor("#8a8598");
      doc.text(`${L.current[0]}/${L.current[1]}`, left + 315, y, {
        width: 80,
        align: "right",
      });
      doc.text(`${L.ytd[0]}/${L.ytd[1]}`, left + 400, y, {
        width: 112,
        align: "right",
      });
      y += 12;
      let dedTotal = 0;
      for (const it of itemsOf("employee_deduction")) {
        const [es, en] = label(it.code);
        dedTotal += Number(it.amount_cents);
        const ytdCol = YTD_COLUMN[it.code];
        doc.font("Helvetica").fontSize(9).fillColor("#191524");
        doc.text(`${es} · ${en}`, left, y, { width: 310 });
        doc.text(money(it.amount_cents), left + 315, y, {
          width: 80,
          align: "right",
        });
        doc.text(ytdCol ? money(acc[ytdCol] || 0) : "—", left + 400, y, {
          width: 112,
          align: "right",
        });
        y += 14;
      }
      doc.font("Helvetica-Bold").fontSize(9);
      doc.text(`${L.totalDeductions[0]} / ${L.totalDeductions[1]}`, left, y, {
        width: 310,
      });
      doc.text(money(dedTotal), left + 315, y, { width: 80, align: "right" });
      y += 22;

      // ── Employer contributions ──
      const er = itemsOf("employer_contribution");
      if (er.length > 0) {
        y = dual(doc, L.employerContrib, left, y, { bold: true, size: 10 }) + 4;
        doc.moveTo(left, y).lineTo(right, y).strokeColor("#d9d6e0").stroke();
        y += 6;
        for (const it of er) {
          const [es, en] = label(it.code);
          doc.font("Helvetica").fontSize(9).fillColor("#4f4a60");
          doc.text(`${es} · ${en}`, left, y, { width: 340 });
          doc.text(money(it.amount_cents), left + 400, y, {
            width: 112,
            align: "right",
          });
          y += 14;
        }
        y += 8;
      }

      // ── Net pay ──
      doc.rect(left, y, width, 30).fill("#eef4f1");
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#1e5e46");
      doc.text(`${L.netPay[0]} / ${L.netPay[1]}`, left + 10, y + 9);
      doc.text(money(line.net_cents), left, y + 9, {
        width: width - 10,
        align: "right",
      });
      y += 42;

      // ── Footer disclaimer (Phase 6.5) ──
      doc.font("Helvetica").fontSize(6.5).fillColor("#8a8598");
      doc.text(
        "Este documento no constituye asesoría contributiva ni legal. / This document is not tax or legal advice.",
        left,
        742,
        { width, align: "center" },
      );

      // ── 9017 gap warning (never silent) ──
      if (gaps.length > 0) {
        doc.rect(left, y, width, 30).fill("#fff4e5");
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#8a5a00");
        doc.text(`${L.missingFields[0]} ${gaps.join(", ")}`, left + 8, y + 6, {
          width: width - 16,
        });
        doc.font("Helvetica").fontSize(6.5);
        doc.text(
          `${L.missingFields[1]} ${gaps.join(", ")}`,
          left + 8,
          doc.y + 1,
          {
            width: width - 16,
          },
        );
      }
    }

    doc.end();
  });
}
