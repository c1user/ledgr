/**
 * services/reportPdf.js
 *
 * Phase 3 — server-side report PDFs (pdfkit), replacing window.print().
 * Four builders sharing one layout kit: Profit & Loss, Tax Summary,
 * Balance Sheet, Chart of Accounts. Each resolves to an in-memory Buffer
 * (same contract as invoicePdf.js) so routes can stream it for download.
 *
 * i18n: labels and COA name_keys are resolved from the frontend locale
 * files (single source of truth). If those files aren't reachable in a
 * given deployment, every lookup falls back to a humanized key or the
 * explicit fallback string, so PDFs still render.
 */

import PDFDocument from "pdfkit";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";

/** Payer block for the PDF header — name, currency, mailing address. */
export async function fetchBusiness(businessId) {
  const r = await pool.query(
    `SELECT name, currency, address, city, state, zip FROM businesses WHERE id = $1`,
    [businessId],
  );
  return r.rows[0] || {};
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCALES = {};
for (const lang of ["en", "es"]) {
  try {
    LOCALES[lang] = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          `../../../frontend/src/i18n/locales/${lang}.json`,
        ),
        "utf8",
      ),
    );
  } catch {
    LOCALES[lang] = null;
  }
}

function humanize(key) {
  const last =
    String(key || "")
      .split(".")
      .pop() || "";
  const spaced = last.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Resolve an i18n key with {{var}} interpolation and graceful fallback. */
function tr(key, lang, fallback, vars = {}) {
  const dict = LOCALES[lang === "es" ? "es" : "en"];
  let value =
    dict &&
    key
      .split(".")
      .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), dict);
  if (typeof value !== "string") value = fallback ?? humanize(key);
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

/** System accounts carry a name_key; custom accounts a plain name. */
function accountLabel(nameKey, name, lang) {
  if (nameKey) return tr(nameKey, lang, name || humanize(nameKey));
  return name || "";
}

function fmtMoney(value, currency, lang) {
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(Number(value) || 0);
}

function fmtDate(value, lang) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── layout kit ───────────────────────────────────────────────
const LEFT = 50;
const RIGHT = 562; // 612pt LETTER − 50 margin
const BOTTOM = 720;
const INK = "#1a1a1a";
const GRAY = "#666666";
const FAINT = "#888888";
const RULE = "#e5e5e3";

function startDoc() {
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { ctx: { doc, y: 50 }, done };
}

function ensureSpace(ctx, needed = 24) {
  if (ctx.y + needed > BOTTOM) {
    ctx.doc.addPage();
    ctx.y = 50;
  }
}

/** Business name (left) + report title/period (right), with a heavy rule. */
function pageHeader(ctx, business, title, subtitle) {
  const { doc } = ctx;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(16);
  doc.text(business?.name || "", LEFT, 50, { width: 280 });
  const addr = [
    business?.address,
    [business?.city, business?.state, business?.zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(9).fillColor(GRAY);
  addr.forEach((line, i) => doc.text(line, LEFT, 72 + i * 12, { width: 280 }));

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#444444");
  doc.text(title, 300, 52, { width: RIGHT - 300, align: "right" });
  if (subtitle) {
    doc.font("Helvetica").fontSize(9).fillColor(GRAY);
    doc.text(subtitle, 300, 74, { width: RIGHT - 300, align: "right" });
  }

  const y = Math.max(96, 72 + addr.length * 12 + 8);
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1.5).strokeColor(INK).stroke();
  ctx.y = y + 18;
}

function sectionTitle(ctx, text) {
  ensureSpace(ctx, 36);
  const { doc } = ctx;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(FAINT);
  doc.text(text.toUpperCase(), LEFT, ctx.y, { characterSpacing: 1 });
  ctx.y += 13;
  doc
    .moveTo(LEFT, ctx.y)
    .lineTo(RIGHT, ctx.y)
    .lineWidth(1)
    .strokeColor(RULE)
    .stroke();
  ctx.y += 7;
}

/** One label/value line. opts: { bold, muted, indent, rule, big } */
function line(ctx, label, value, opts = {}) {
  ensureSpace(ctx, 20);
  const { doc } = ctx;
  const size = opts.big ? 12 : 10;
  doc
    .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(size)
    .fillColor(opts.muted ? GRAY : INK);
  doc.text(label, LEFT + (opts.indent ? 14 : 0), ctx.y, { width: 330 });
  doc.fillColor(opts.muted ? GRAY : INK);
  doc.text(value, 400, ctx.y, { width: RIGHT - 400, align: "right" });
  ctx.y += size + 6;
  if (opts.rule) {
    doc
      .moveTo(LEFT, ctx.y - 3)
      .lineTo(RIGHT, ctx.y - 3)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
  }
}

function heavyRule(ctx) {
  ensureSpace(ctx, 12);
  ctx.doc
    .moveTo(LEFT, ctx.y)
    .lineTo(RIGHT, ctx.y)
    .lineWidth(1.5)
    .strokeColor(INK)
    .stroke();
  ctx.y += 8;
}

/** Compact table: cols = [{ label, width, align }], rows = string[][] */
function table(ctx, cols, rows) {
  const { doc } = ctx;
  ensureSpace(ctx, 40);
  let x = LEFT;
  const xs = cols.map((c) => {
    const cur = x;
    x += c.width;
    return cur;
  });
  const headRow = () => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(FAINT);
    cols.forEach((c, i) =>
      doc.text(c.label.toUpperCase(), xs[i], ctx.y, {
        width: c.width - 8,
        align: c.align || "left",
      }),
    );
    ctx.y += 12;
    doc
      .moveTo(LEFT, ctx.y)
      .lineTo(RIGHT, ctx.y)
      .lineWidth(1)
      .strokeColor(RULE)
      .stroke();
    ctx.y += 6;
  };
  headRow();
  doc.font("Helvetica").fontSize(9);
  for (const row of rows) {
    if (ctx.y + 16 > BOTTOM) {
      doc.addPage();
      ctx.y = 50;
      headRow();
      doc.font("Helvetica").fontSize(9);
    }
    doc.fillColor(INK);
    row.forEach((cell, i) =>
      doc.text(String(cell), xs[i], ctx.y, {
        width: cols[i].width - 8,
        align: cols[i].align || "left",
      }),
    );
    ctx.y += 15;
  }
}

/** Category section shared by P&L and Tax Summary. */
function categorySection(
  ctx,
  titleText,
  categories,
  total,
  totalLabel,
  money,
  lang,
) {
  sectionTitle(ctx, titleText);
  if (!categories.length) {
    line(ctx, "—", "", { muted: true });
  } else {
    for (const cat of categories) {
      line(
        ctx,
        accountLabel(cat.category_name_key, cat.category_name, lang),
        money(cat.total),
        { rule: true },
      );
    }
  }
  line(ctx, totalLabel, money(total), { bold: true });
  ctx.y += 8;
}

// ── Profit & Loss ────────────────────────────────────────────
export function buildPlPdf(
  data,
  business,
  { startDate, endDate, lang = "en" },
) {
  const money = (v) => fmtMoney(v, business?.currency, lang);
  const { ctx, done } = startDoc();

  pageHeader(
    ctx,
    business,
    tr("reports.profitLoss", lang, "Profit & Loss"),
    `${fmtDate(startDate, lang)} – ${fmtDate(endDate, lang)}`,
  );

  categorySection(
    ctx,
    tr("reports.revenue", lang, "Revenue"),
    data.income_categories,
    data.total_income,
    tr("reports.totalRevenue", lang, "Total revenue"),
    money,
    lang,
  );
  categorySection(
    ctx,
    tr("reports.expenses", lang, "Expenses"),
    data.expense_categories,
    data.total_expenses,
    tr("reports.totalExpenses", lang, "Total expenses"),
    money,
    lang,
  );

  heavyRule(ctx);
  const isProfit = data.net_income >= 0;
  line(
    ctx,
    isProfit
      ? tr("reports.netIncome", lang, "Net income")
      : tr("reports.netLoss", lang, "Net loss"),
    money(Math.abs(data.net_income)),
    { bold: true, big: true },
  );

  // Monthly trend (only meaningful when the range spans multiple months)
  if ((data.monthly_trend || []).length > 1) {
    ctx.y += 10;
    sectionTitle(ctx, tr("reports.monthlyTrend", lang, "Monthly trend"));
    table(
      ctx,
      [
        { label: tr("reports.trendMonth", lang, "Month"), width: 200 },
        {
          label: tr("reports.trendIncome", lang, "Income"),
          width: 156,
          align: "right",
        },
        {
          label: tr("reports.trendExpenses", lang, "Expenses"),
          width: 156,
          align: "right",
        },
      ],
      data.monthly_trend.map((m) => [
        m.month,
        money(m.income),
        money(m.expenses),
      ]),
    );
  }

  // FX summary
  if ((data.fx_currencies || []).length > 0) {
    ctx.y += 10;
    sectionTitle(
      ctx,
      tr("fx.fxSectionTitle", lang, "Foreign currency activity"),
    );
    table(
      ctx,
      [
        { label: tr("fx.fxCurrencyCol", lang, "Currency"), width: 120 },
        {
          label: tr("fx.fxTransactions", lang, "transactions"),
          width: 100,
          align: "right",
        },
        {
          label: tr("fx.fxOriginalCol", lang, "Original"),
          width: 146,
          align: "right",
        },
        {
          label: tr("fx.fxConvertedCol", lang, "Converted ({{base}})", {
            base: business?.currency || "USD",
          }),
          width: 146,
          align: "right",
        },
      ],
      data.fx_currencies.map((r) => [
        r.currency,
        r.count,
        fmtMoney(r.original_total, r.currency, lang),
        money(r.converted_total),
      ]),
    );
  }

  ctx.doc.end();
  return done;
}

// ── Tax Summary ──────────────────────────────────────────────
export function buildTaxPdf(data, business, { lang = "en" }) {
  const money = (v) => fmtMoney(v, business?.currency, lang);
  const { ctx, done } = startDoc();

  pageHeader(
    ctx,
    business,
    tr("tax.title", lang, "Tax Summary"),
    tr("tax.fiscalYear", lang, "Fiscal year {{year}}", { year: data.year }),
  );

  categorySection(
    ctx,
    tr("tax.revenue", lang, "Revenue"),
    data.income_categories,
    data.total_income,
    tr("tax.totalRevenue", lang, "Total revenue"),
    money,
    lang,
  );
  categorySection(
    ctx,
    tr("tax.expenses", lang, "Expenses"),
    data.expense_categories,
    data.total_expenses,
    tr("tax.totalExpenses", lang, "Total expenses"),
    money,
    lang,
  );

  heavyRule(ctx);
  const isProfit = (data.net_income || 0) >= 0;
  line(
    ctx,
    isProfit
      ? tr("tax.netIncome", lang, "Net income")
      : tr("tax.netLoss", lang, "Net loss"),
    money(Math.abs(data.net_income)),
    { bold: true, big: true },
  );
  ctx.y += 10;

  // Payroll taxes
  const p = data.payroll;
  sectionTitle(ctx, tr("tax.payrollTaxes", lang, "Payroll taxes"));
  if (!p || Number(p.run_count) === 0) {
    line(
      ctx,
      tr("tax.noPayroll", lang, "No finalized payroll runs this year."),
      "",
      {
        muted: true,
      },
    );
  } else {
    line(
      ctx,
      tr("tax.grossPayroll", lang, "Gross payroll"),
      money(p.total_gross),
      { rule: true },
    );
    line(
      ctx,
      tr("tax.federalIncomeTax", lang, "Federal income tax"),
      money(p.total_federal_tax),
      { muted: true, rule: true },
    );
    line(
      ctx,
      tr("tax.socialSecurity", lang, "Social Security"),
      money(p.total_social_security),
      { muted: true, rule: true },
    );
    line(ctx, tr("tax.medicare", lang, "Medicare"), money(p.total_medicare), {
      muted: true,
      rule: true,
    });
    line(
      ctx,
      tr("tax.prStateTax", lang, "PR state tax"),
      money(p.total_pr_state_tax),
      { muted: true, rule: true },
    );
    if (Number(p.total_other_deductions) > 0) {
      line(
        ctx,
        tr("tax.otherDeductions", lang, "Other deductions"),
        money(p.total_other_deductions),
        { muted: true, rule: true },
      );
    }
    const totalWithheld =
      Number(p.total_federal_tax) +
      Number(p.total_social_security) +
      Number(p.total_medicare) +
      Number(p.total_pr_state_tax) +
      Number(p.total_other_deductions);
    line(
      ctx,
      tr("tax.totalTaxesWithheld", lang, "Total taxes withheld"),
      money(totalWithheld),
      { bold: true },
    );
    line(
      ctx,
      `${tr("tax.payrollRuns", lang, "Payroll runs")}: ${p.run_count} · ${tr("tax.employeesPaid", lang, "Employees paid")}: ${p.employee_count}`,
      "",
      { muted: true },
    );
  }
  ctx.y += 10;

  // Quarterly breakdown
  sectionTitle(ctx, tr("tax.quarterlyBreakdown", lang, "Quarterly breakdown"));
  table(
    ctx,
    [
      { label: "Q", width: 120 },
      { label: tr("tax.income", lang, "Income"), width: 196, align: "right" },
      {
        label: tr("tax.expenses", lang, "Expenses"),
        width: 196,
        align: "right",
      },
    ],
    (data.quarterly || []).map((q) => [
      q.quarter,
      money(q.income),
      money(q.expenses),
    ]),
  );

  ctx.doc.end();
  return done;
}

// ── Balance Sheet ────────────────────────────────────────────
export function buildBalanceSheetPdf(data, business, { asOf, lang = "en" }) {
  const money = (v) => fmtMoney(v, business?.currency, lang);
  const { ctx, done } = startDoc();

  pageHeader(
    ctx,
    business,
    tr("balanceSheet.title", lang, "Balance Sheet"),
    `${tr("balanceSheet.asOf", lang, "As of")} ${fmtDate(asOf, lang)}`,
  );

  const group = (
    titleKey,
    fallback,
    accounts,
    totalLabelKey,
    totalFallback,
    total,
    extra,
  ) => {
    sectionTitle(ctx, tr(titleKey, lang, fallback));
    for (const a of accounts) {
      line(ctx, accountLabel(a.name_key, a.name, lang), money(a.balance), {
        indent: true,
        rule: true,
      });
    }
    if (extra) extra();
    line(ctx, tr(totalLabelKey, lang, totalFallback), money(total), {
      bold: true,
    });
    ctx.y += 8;
  };

  group(
    "coa.assets",
    "Assets",
    data.assets.accounts,
    "coa.totalAssets",
    "Total assets",
    data.assets.total,
  );
  group(
    "coa.liabilities",
    "Liabilities",
    data.liabilities.accounts,
    "coa.totalLiabilities",
    "Total liabilities",
    data.liabilities.total,
  );
  group(
    "coa.equity",
    "Equity",
    data.equity.accounts,
    "balanceSheet.totalEquity",
    "Total equity",
    data.equity.total,
    () =>
      line(
        ctx,
        tr("balanceSheet.currentEarnings", lang, "Current period earnings"),
        money(data.equity.current_period_earnings),
        { indent: true, muted: true, rule: true },
      ),
  );

  heavyRule(ctx);
  line(
    ctx,
    tr(
      "balanceSheet.totalLiabilitiesEquity",
      lang,
      "Total liabilities & equity",
    ),
    money(data.total_liabilities_and_equity),
    { bold: true, big: true },
  );

  ctx.y += 8;
  line(
    ctx,
    data.balances
      ? tr(
          "balanceSheet.balanced",
          lang,
          "Balanced — assets equal liabilities plus equity",
        )
      : tr("balanceSheet.notBalanced", lang, "Out of balance by {{amount}}", {
          amount: money(Math.abs(data.difference)),
        }),
    "",
    { muted: !data.balances ? false : true },
  );

  ctx.doc.end();
  return done;
}

// ── Chart of Accounts ────────────────────────────────────────
const COA_TYPE_KEYS = {
  asset: ["coa.assets", "Assets"],
  liability: ["coa.liabilities", "Liabilities"],
  equity: ["coa.equity", "Equity"],
  revenue: ["coa.revenue", "Revenue"],
  expense: ["coa.expenses", "Expenses"],
};

export function buildCoaPdf(groups, business, { lang = "en" }) {
  const money = (v) => fmtMoney(v, business?.currency, lang);
  const { ctx, done } = startDoc();

  pageHeader(
    ctx,
    business,
    tr("coa.title", lang, "Chart of Accounts"),
    fmtDate(new Date().toISOString(), lang),
  );

  const renderNode = (node, depth) => {
    ensureSpace(ctx, 20);
    const { doc } = ctx;
    doc.font("Helvetica").fontSize(10);
    if (node.code) {
      doc
        .fillColor(GRAY)
        .text(String(node.code), LEFT + depth * 14, ctx.y, { width: 40 });
    }
    const label =
      accountLabel(node.name_key, node.name, lang) +
      (node.is_active ? "" : ` (${tr("coa.inactive", lang, "inactive")})`);
    doc
      .fillColor(node.is_active ? INK : GRAY)
      .text(label, LEFT + depth * 14 + 46, ctx.y, { width: 300 - depth * 14 });
    doc.fillColor(INK).text(money(node.balance), 400, ctx.y, {
      width: RIGHT - 400,
      align: "right",
    });
    ctx.y += 16;
    ctx.doc
      .moveTo(LEFT, ctx.y - 4)
      .lineTo(RIGHT, ctx.y - 4)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    (node.children || []).forEach((c) => renderNode(c, depth + 1));
  };

  for (const g of groups) {
    const [key, fallback] = COA_TYPE_KEYS[g.account_type] || [
      null,
      g.account_type,
    ];
    sectionTitle(ctx, key ? tr(key, lang, fallback) : fallback);
    g.accounts.forEach((n) => renderNode(n, 0));
    line(ctx, "", money(g.total), { bold: true });
    ctx.y += 6;
  }

  ctx.doc.end();
  return done;
}
