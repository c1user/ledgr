/**
 * services/invoicePdf.js
 *
 * Item 10 — server-side invoice PDF (pdfkit). Mirrors the EN/ES print
 * template in frontend Invoices.jsx: business header, INVOICE meta, Bill-To,
 * line items, subtotal, tax (IVU itemized separately for PR), total, notes.
 *
 * buildInvoicePdf() resolves to an in-memory Buffer so the route can both
 * attach it to an email and stream it for download — no temp files.
 */

import PDFDocument from "pdfkit";

const LABELS = {
  en: {
    invoice: "INVOICE",
    issueDate: "Issue date",
    dueDate: "Due date",
    billTo: "Bill to",
    description: "Description",
    qty: "Qty",
    unitPrice: "Unit price",
    amount: "Amount",
    subtotal: "Subtotal",
    tax: "Tax",
    total: "Total",
    notes: "Notes",
  },
  es: {
    invoice: "FACTURA",
    issueDate: "Fecha de emisión",
    dueDate: "Fecha de vencimiento",
    billTo: "Facturar a",
    description: "Descripción",
    qty: "Cant.",
    unitPrice: "Precio unit.",
    amount: "Importe",
    subtotal: "Subtotal",
    tax: "Impuesto",
    total: "Total",
    notes: "Notas",
  },
};

function fmtMoney(value, currency, lang) {
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(Number(value) || 0);
}

function fmtDate(value, lang) {
  if (!value) return "";
  // value is 'YYYY-MM-DD' (or a Date) — render at UTC noon to avoid tz slips.
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * @returns {Promise<Buffer>} the rendered PDF
 */
export function buildInvoicePdf(invoice, business, lang = "en") {
  const L = LABELS[lang === "es" ? "es" : "en"];
  const currency = business?.currency || "USD";
  const money = (v) => fmtMoney(v, currency, lang);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 50;
    const right = 562; // 612pt page width − 50 margin
    const grayrgb = "#666666";

    // ── Header: business (left) + INVOICE meta (right) ──
    doc.fillColor("#1a1a1a").font("Helvetica-Bold").fontSize(18);
    doc.text(business?.name || "", left, 50, { width: 280 });
    const bizAddr = [
      business?.address,
      [business?.city, business?.state, business?.zip].filter(Boolean).join(", "),
    ].filter(Boolean);
    doc.font("Helvetica").fontSize(9).fillColor(grayrgb);
    bizAddr.forEach((line, i) => doc.text(line, left, 74 + i * 12, { width: 280 }));

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#444444");
    doc.text(L.invoice, 330, 50, { width: right - 330, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor("#333333");
    doc.text(invoice.invoice_number || "", 330, 80, { width: right - 330, align: "right" });
    doc.fillColor(grayrgb).fontSize(9);
    doc.text(`${L.issueDate}: ${fmtDate(invoice.issue_date, lang)}`, 330, 96, { width: right - 330, align: "right" });
    doc.text(`${L.dueDate}: ${fmtDate(invoice.due_date, lang)}`, 330, 108, { width: right - 330, align: "right" });

    // ── Bill to ──
    let y = 150;
    doc.fillColor("#888888").font("Helvetica").fontSize(8).text(L.billTo.toUpperCase(), left, y);
    y += 14;
    doc.fillColor("#333333").fontSize(10);
    const billTo = [
      invoice.client_name,
      invoice.billing_address,
      [invoice.client_city, invoice.client_state, invoice.client_zip].filter(Boolean).join(", "),
      invoice.billing_email,
    ].filter(Boolean);
    billTo.forEach((line) => { doc.text(line, left, y, { width: 300 }); y += 13; });

    // ── Line-items table ──
    y += 18;
    const cols = {
      desc: left,
      qty: 330,
      unit: 400,
      amount: 470,
    };
    const colW = { desc: 270, qty: 60, unit: 60, amount: 92 };
    const headRow = (yy) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#1a1a1a");
      doc.text(L.description.toUpperCase(), cols.desc, yy, { width: colW.desc });
      doc.text(L.qty.toUpperCase(), cols.qty, yy, { width: colW.qty, align: "right" });
      doc.text(L.unitPrice.toUpperCase(), cols.unit, yy, { width: colW.unit, align: "right" });
      doc.text(L.amount.toUpperCase(), cols.amount, yy, { width: colW.amount, align: "right" });
    };
    headRow(y);
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1.5).strokeColor("#1a1a1a").stroke();
    y += 8;

    doc.font("Helvetica").fontSize(10).fillColor("#1a1a1a");
    for (const item of invoice.line_items || []) {
      const descHeight = doc.heightOfString(item.description || "", { width: colW.desc });
      if (y + descHeight > 700) { doc.addPage(); y = 50; headRow(y); y += 22; }
      doc.fillColor("#1a1a1a").text(item.description || "", cols.desc, y, { width: colW.desc });
      doc.fillColor("#333333");
      doc.text(String(Number(item.quantity)), cols.qty, y, { width: colW.qty, align: "right" });
      doc.text(money(item.unit_price), cols.unit, y, { width: colW.unit, align: "right" });
      doc.text(money(item.total), cols.amount, y, { width: colW.amount, align: "right" });
      y += Math.max(descHeight, 12) + 8;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor("#eeeeee").stroke();
    }

    // ── Totals ──
    y += 8;
    const totalLine = (label, value, opts = {}) => {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.bold ? 13 : 10);
      doc.fillColor(opts.bold ? "#1a1a1a" : grayrgb);
      doc.text(label, cols.unit - 60, y, { width: 120 + 60, align: "right" });
      doc.fillColor("#1a1a1a").text(value, cols.amount, y, { width: colW.amount, align: "right" });
      y += opts.bold ? 22 : 16;
    };
    totalLine(L.subtotal, money(invoice.subtotal));
    if (Number(invoice.tax_total) > 0) {
      const taxName = invoice.tax_type === "ivu" ? "IVU" : L.tax;
      totalLine(`${taxName} (${Number(invoice.tax_rate)}%)`, money(invoice.tax_total));
    }
    doc.moveTo(cols.unit - 60, y).lineTo(right, y).lineWidth(1.5).strokeColor("#1a1a1a").stroke();
    y += 6;
    totalLine(L.total, money(invoice.total), { bold: true });

    // ── Notes ──
    if (invoice.notes) {
      y += 16;
      doc.fillColor("#888888").font("Helvetica").fontSize(8).text(L.notes.toUpperCase(), left, y);
      y += 12;
      doc.fillColor("#555555").fontSize(10).text(invoice.notes, left, y, { width: right - left });
    }

    doc.end();
  });
}
