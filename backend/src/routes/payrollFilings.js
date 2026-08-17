/**
 * routes/payrollFilings.js — compliance calendar + filing exports
 * (ROADMAP-V5 · Phase 5). Mounted behind gate("payroll").
 *
 * EXPORTS ONLY — the human downloads and files through the government
 * portals (spec §6 explicitly excludes direct electronic submission).
 *
 * Mode discipline: figures come from runs matching the business's
 * CURRENT payroll mode (sandbox mode sums sandbox runs so the export
 * pipeline is testable; production sums production runs). Sandbox
 * exports carry watermark header lines / filenames. The W-2PR
 * electronic file additionally hard-blocks in production while the
 * w2pr_file_spec rule is UNVERIFIED — a real filing may never follow an
 * unverified layout.
 *
 * SSNs: filing files (DTRH, W-2PR electronic) necessarily carry full
 * SSNs — decrypted straight into the download, never logged, never in
 * JSON responses. Draft PDFs stay masked.
 */

import express from "express";
import pool from "../config/db.js";
import { requireRole } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import { resolveRules } from "../services/payrollRules.js";
import {
  generateSchedule,
  displayStatus,
} from "../services/complianceSchedule.js";
import { buildW2prFile, buildW2prDraftPdf } from "../services/w2prFile.js";
import { decryptField } from "../services/fieldCrypto.js";
import { todayPR } from "../services/prDates.js";

const router = express.Router();
router.param("id", uuidParam("Obligation"));

const SCHEDULE_RULE_TYPES = [
  "hacienda_deposit_schedule",
  "quarterly_filing_schedule",
  "federal_employment_return",
  "w2pr_file_spec",
  "cfse_declaration",
  "christmas_bonus",
];

// Filing files that decrypt SSNs must be attributable (Phase 6.4): one
// audit row per generated file — who, which filing, how many SSNs. The
// SSNs themselves never appear (auditLog's scrub stays authoritative).
async function auditExport(user, summary, ssnCount) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (business_id, user_id, user_name, action, entity_type, summary, snapshot)
       VALUES ($1, $2, (SELECT name FROM users WHERE id = $2),
               'export', 'payroll-filings', $3, $4)`,
      [
        user.businessId,
        user.userId,
        summary,
        JSON.stringify({ ssn_count: ssnCount }),
      ],
    );
  } catch (err) {
    console.error("Export audit write error:", err.message);
  }
}

async function businessMode(businessId) {
  const r = await pool.query(
    "SELECT payroll_mode FROM businesses WHERE id = $1",
    [businessId],
  );
  return r.rows[0]?.payroll_mode || "sandbox";
}

async function employerRow(businessId) {
  const r = await pool.query(
    "SELECT name, address, city, state, zip, tax_id FROM businesses WHERE id = $1",
    [businessId],
  );
  return r.rows[0];
}

/**
 * Reversal-aware per-employee figures over a pay-date window, for runs
 * matching the given mode. Wages from pay_line delta columns, withheld
 * amounts from items.
 */
async function windowFigures(businessId, start, end, mode) {
  const linesResult = await pool.query(
    `SELECT l.employee_id, e.name, e.ssn_last4, e.ssn_encrypted,
            SUM(CASE WHEN r.reversal_of IS NULL THEN l.gross_cents ELSE -l.gross_cents END) AS gross_cents,
            SUM(CASE WHEN r.reversal_of IS NULL THEN l.ss_taxable_cents ELSE -l.ss_taxable_cents END) AS ss_wages_cents,
            SUM(CASE WHEN r.reversal_of IS NULL THEN l.medicare_taxable_cents ELSE -l.medicare_taxable_cents END) AS medicare_wages_cents,
            SUM(CASE WHEN r.reversal_of IS NULL THEN l.sinot_taxable_cents ELSE -l.sinot_taxable_cents END) AS sinot_wages_cents,
            SUM(CASE WHEN r.reversal_of IS NULL THEN l.suta_taxable_cents ELSE -l.suta_taxable_cents END) AS suta_wages_cents
     FROM pay_lines l
     JOIN payroll_runs_v2 r ON r.id = l.payroll_run_id
     JOIN pay_periods p ON p.id = r.pay_period_id
     JOIN employees e ON e.id = l.employee_id
     WHERE r.business_id = $1 AND r.run_mode = $2
       AND r.status IN ('finalized', 'reversed')
       AND p.pay_date BETWEEN $3 AND $4
     GROUP BY l.employee_id, e.name, e.ssn_last4, e.ssn_encrypted
     ORDER BY e.name`,
    [businessId, mode, start, end],
  );

  const itemsResult = await pool.query(
    `SELECT l.employee_id, i.code,
            SUM(CASE WHEN r.reversal_of IS NULL THEN i.amount_cents ELSE -i.amount_cents END) AS amount_cents
     FROM pay_items i
     JOIN pay_lines l ON l.id = i.pay_line_id
     JOIN payroll_runs_v2 r ON r.id = l.payroll_run_id
     JOIN pay_periods p ON p.id = r.pay_period_id
     WHERE r.business_id = $1 AND r.run_mode = $2
       AND r.status IN ('finalized', 'reversed')
       AND p.pay_date BETWEEN $3 AND $4
     GROUP BY l.employee_id, i.code`,
    [businessId, mode, start, end],
  );
  const byEmployee = new Map();
  for (const row of itemsResult.rows) {
    const m = byEmployee.get(row.employee_id) || {};
    m[row.code] = Number(row.amount_cents);
    byEmployee.set(row.employee_id, m);
  }

  return linesResult.rows
    .map((l) => {
      const items = byEmployee.get(l.employee_id) || {};
      return {
        employeeId: l.employee_id,
        name: l.name,
        ssnLast4: l.ssn_last4,
        ssnEncrypted: l.ssn_encrypted,
        grossCents: Number(l.gross_cents),
        prTaxCents: items.pr_income_tax || 0,
        ssWagesCents: Number(l.ss_wages_cents),
        ssWithheldCents: items.social_security || 0,
        medicareWagesCents: Number(l.medicare_wages_cents),
        medicareWithheldCents:
          (items.medicare || 0) + (items.medicare_additional || 0),
        sinotWagesCents: Number(l.sinot_wages_cents),
        sutaWagesCents: Number(l.suta_wages_cents),
      };
    })
    .filter((e) => e.grossCents !== 0);
}

const QUARTER_RANGES = {
  1: ["01-01", "03-31"],
  2: ["04-01", "06-30"],
  3: ["07-01", "09-30"],
  4: ["10-01", "12-31"],
};

function quarterWindow(year, q) {
  const range = QUARTER_RANGES[q];
  if (!range) return null;
  return [`${year}-${range[0]}`, `${year}-${range[1]}`];
}

// ── CSV helpers ──────────────────────────────────────────────
const csvEsc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvEsc).join(",");
const $ = (cents) => (Number(cents) / 100).toFixed(2);

function sendCsv(res, filename, rows, sandbox) {
  const lines = [...rows];
  if (sandbox) {
    lines.unshift([
      "CÁLCULO NO VERIFICADO — SOLO PRUEBAS / UNVERIFIED — TESTING ONLY",
    ]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sandbox ? "PRUEBA-" : ""}${filename}"`,
  );
  return res.send(lines.map(csvRow).join("\r\n") + "\r\n");
}

function parseYearQuarter(req, res) {
  const year = Number(req.query.year);
  const q = Number(req.query.q);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: "year is required" });
    return null;
  }
  if (![1, 2, 3, 4].includes(q)) {
    res.status(400).json({ error: "q must be 1-4" });
    return null;
  }
  return { year, q };
}

// ── GET /api/payroll-filings/calendar?year= ───────────────────
// Idempotent: regenerates obligations from the CURRENT schedule rules
// (due dates follow rule updates; user-set statuses survive).
router.get("/calendar", async (req, res) => {
  const { businessId } = req.user;
  const year = Number(req.query.year) || Number(todayPR().slice(0, 4));

  try {
    const resolved = await resolveRules(pool, businessId, `${year}-06-30`);
    const schedule = generateSchedule(resolved, year);

    for (const o of schedule) {
      await pool.query(
        `INSERT INTO compliance_obligations
           (business_id, obligation_type, period_start, period_end, due_date, rule_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (business_id, obligation_type, period_start) DO UPDATE SET
           period_end = EXCLUDED.period_end,
           due_date   = EXCLUDED.due_date,
           rule_id    = EXCLUDED.rule_id`,
        [
          businessId,
          o.obligation_type,
          o.period_start,
          o.period_end,
          o.due_date,
          o.rule_id,
        ],
      );
    }

    const rows = await pool.query(
      `SELECT * FROM compliance_obligations
       WHERE business_id = $1 AND due_date BETWEEN $2 AND $3
       ORDER BY due_date ASC, obligation_type ASC`,
      [businessId, `${year}-01-01`, `${year + 1}-01-31`],
    );

    const today = todayPR();
    const mode = await businessMode(businessId);
    const unverifiedSources = SCHEDULE_RULE_TYPES.filter(
      (t) => resolved[t] && resolved[t].verification_status !== "VERIFIED",
    );

    return res.json({
      year,
      mode,
      watermark: mode === "sandbox",
      unverified_schedule_rules: unverifiedSources,
      obligations: rows.rows.map((r) => ({
        ...r,
        display_status: displayStatus(r, today),
      })),
    });
  } catch (err) {
    console.error("Compliance calendar error:", err);
    return res.status(500).json({ error: "Failed to build calendar" });
  }
});

// ── PUT /api/payroll-filings/calendar/:id/status ──────────────
router.put(
  "/calendar/:id/status",
  requireRole("owner", "admin"),
  async (req, res) => {
    const { businessId } = req.user;
    const done = req.body?.done === true;
    try {
      const result = await pool.query(
        `UPDATE compliance_obligations SET status = $1
         WHERE id = $2 AND business_id = $3 RETURNING *`,
        [done ? "done" : "upcoming", req.params.id, businessId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Obligation not found" });
      }
      return res.json({
        ...result.rows[0],
        display_status: displayStatus(result.rows[0], todayPR()),
      });
    } catch (err) {
      console.error("Obligation status error:", err);
      return res.status(500).json({ error: "Failed to update obligation" });
    }
  },
);

// ── GET /api/payroll-filings/hacienda-quarterly?year&q ───────
// Pre-filled worksheet for the quarterly Hacienda withholding
// reconciliation — figures for manual SURI entry.
router.get("/hacienda-quarterly", async (req, res) => {
  const { businessId } = req.user;
  const parsed = parseYearQuarter(req, res);
  if (!parsed) return;
  const { year, q } = parsed;

  try {
    const [start, end] = quarterWindow(year, q);
    const mode = await businessMode(businessId);
    const employer = await employerRow(businessId);
    const figures = await windowFigures(businessId, start, end, mode);
    const totals = figures.reduce(
      (a, e) => ({
        gross: a.gross + e.grossCents,
        prTax: a.prTax + e.prTaxCents,
      }),
      { gross: 0, prTax: 0 },
    );

    return sendCsv(
      res,
      `hacienda-recon-${year}-Q${q}.csv`,
      [
        ["Hacienda quarterly withholding reconciliation (worksheet)"],
        ["Employer", employer.name, "EIN", employer.tax_id || ""],
        ["Period", `${start} — ${end}`],
        [],
        ["Employee", "Wages paid", "PR income tax withheld"],
        ...figures.map((e) => [e.name, $(e.grossCents), $(e.prTaxCents)]),
        [],
        ["TOTAL", $(totals.gross), $(totals.prTax)],
        ["Employees paid", figures.length],
      ],
      mode === "sandbox",
    );
  } catch (err) {
    console.error("Hacienda quarterly export error:", err);
    return res.status(500).json({ error: "Failed to build worksheet" });
  }
});

// ── GET /api/payroll-filings/dtrh-quarterly?year&q ───────────
// DTRH quarterly wage report (unemployment/SINOT). Carries full SSNs —
// this IS the filing worksheet.
router.get("/dtrh-quarterly", async (req, res) => {
  const { businessId } = req.user;
  const parsed = parseYearQuarter(req, res);
  if (!parsed) return;
  const { year, q } = parsed;

  try {
    const [start, end] = quarterWindow(year, q);
    const mode = await businessMode(businessId);
    const employer = await employerRow(businessId);
    const profile = await pool.query(
      "SELECT dtrh_employer_no FROM payroll_employer_profiles WHERE business_id = $1",
      [businessId],
    );
    const figures = await windowFigures(businessId, start, end, mode);

    const warnings = [];
    const rows = figures.map((e) => {
      let ssn = "";
      if (e.ssnEncrypted) {
        try {
          ssn = decryptField(e.ssnEncrypted);
        } catch {
          warnings.push(e.name);
        }
      } else {
        warnings.push(e.name);
      }
      return [
        e.name,
        ssn,
        $(e.grossCents),
        $(e.sutaWagesCents),
        $(e.sinotWagesCents),
      ];
    });

    await auditExport(
      req.user,
      `dtrh-quarterly ${year}-Q${q}`,
      figures.length - warnings.length,
    );

    return sendCsv(
      res,
      `dtrh-wages-${year}-Q${q}.csv`,
      [
        ["DTRH quarterly wage report (worksheet)"],
        [
          "Employer",
          employer.name,
          "Employer no. (patronal)",
          profile.rows[0]?.dtrh_employer_no || "",
        ],
        ["Period", `${start} — ${end}`],
        ...(warnings.length
          ? [["MISSING SSN (fix before filing)", warnings.join("; ")]]
          : []),
        [],
        ["Employee", "SSN", "Total wages", "SUTA taxable", "SINOT wages"],
        ...rows,
        [],
        [
          "TOTAL",
          "",
          $(figures.reduce((a, e) => a + e.grossCents, 0)),
          $(figures.reduce((a, e) => a + e.sutaWagesCents, 0)),
          $(figures.reduce((a, e) => a + e.sinotWagesCents, 0)),
        ],
      ],
      mode === "sandbox",
    );
  } catch (err) {
    console.error("DTRH quarterly export error:", err);
    return res.status(500).json({ error: "Failed to build wage report" });
  }
});

// ── GET /api/payroll-filings/w2pr?year[&draft=1] ─────────────
router.get("/w2pr", async (req, res) => {
  const { businessId } = req.user;
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: "year is required" });
  }

  try {
    const mode = await businessMode(businessId);
    const resolved = await resolveRules(pool, businessId, `${year}-12-31`);
    const specRule = resolved.w2pr_file_spec;
    if (!specRule) {
      return res
        .status(422)
        .json({ error: "No w2pr_file_spec rule covers this tax year" });
    }
    // A real filing may never follow an unverified layout.
    if (mode === "production" && specRule.verification_status !== "VERIFIED") {
      return res.status(422).json({
        error:
          "The W-2PR file specification rule is UNVERIFIED — verify it against Hacienda's current publication before generating a filing",
        code: "SPEC_UNVERIFIED",
      });
    }

    const employer = await employerRow(businessId);
    const figures = await windowFigures(
      businessId,
      `${year}-01-01`,
      `${year}-12-31`,
      mode,
    );
    if (figures.length === 0) {
      return res
        .status(422)
        .json({ error: `No ${mode} payroll figures for ${year}` });
    }

    if (req.query.draft === "1") {
      const pdf = await buildW2prDraftPdf({
        year,
        employer,
        watermark: mode === "sandbox",
        employees: figures.map((e) => ({ ...e, ssnLast4: e.ssnLast4 })),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="w2pr-borrador-${year}.pdf"`,
      );
      return res.send(pdf);
    }

    const employees = figures.map((e) => {
      let ssn = null;
      if (e.ssnEncrypted) {
        try {
          ssn = decryptField(e.ssnEncrypted);
        } catch {
          ssn = null;
        }
      }
      return { ...e, ssn };
    });

    const { content, filename, warnings } = buildW2prFile({
      specVersion: specRule.payload.spec_version,
      year,
      employer,
      employees,
    });

    await auditExport(
      req.user,
      `w2pr ${year}`,
      employees.filter((e) => e.ssn).length,
    );

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${mode === "sandbox" ? "PRUEBA-" : ""}${filename}"`,
    );
    if (warnings.length) res.setHeader("X-W2PR-Warnings", warnings.join("; "));
    return res.send(content);
  } catch (err) {
    console.error("W2PR export error:", err.message);
    return res
      .status(500)
      .json({ error: `Failed to build W-2PR file: ${err.message}` });
  }
});

// ── GET /api/payroll-filings/cfse?year= ──────────────────────
// CFSE annual payroll declaration worksheet — policy year ending in
// `year`, window from the cfse_declaration rule.
router.get("/cfse", async (req, res) => {
  const { businessId } = req.user;
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: "year is required" });
  }

  try {
    const mode = await businessMode(businessId);
    const resolved = await resolveRules(pool, businessId, `${year}-06-30`);
    const cfseRule = resolved.cfse_declaration;
    if (!cfseRule?.payload?.period) {
      return res
        .status(422)
        .json({ error: "No cfse_declaration rule covers this year" });
    }
    const start = `${year - 1}-${cfseRule.payload.period.start}`;
    const end = `${year}-${cfseRule.payload.period.end}`;

    const employer = await employerRow(businessId);
    const profile = await pool.query(
      "SELECT cfse_policy_no FROM payroll_employer_profiles WHERE business_id = $1",
      [businessId],
    );
    const figures = await windowFigures(businessId, start, end, mode);

    return sendCsv(
      res,
      `cfse-declaration-${year}.csv`,
      [
        ["CFSE annual payroll declaration (worksheet)"],
        [
          "Employer",
          employer.name,
          "Policy no.",
          profile.rows[0]?.cfse_policy_no || "",
        ],
        ["Policy year", `${start} — ${end}`],
        [],
        ["Employee", "Total wages"],
        ...figures.map((e) => [e.name, $(e.grossCents)]),
        [],
        ["TOTAL", $(figures.reduce((a, e) => a + e.grossCents, 0))],
        ["Employees", figures.length],
      ],
      mode === "sandbox",
    );
  } catch (err) {
    console.error("CFSE export error:", err);
    return res.status(500).json({ error: "Failed to build CFSE worksheet" });
  }
});

export default router;
