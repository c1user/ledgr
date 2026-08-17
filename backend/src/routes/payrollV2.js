/**
 * routes/payrollV2.js — the PR payroll run API (ROADMAP-V5 · Phase 3).
 * Mounted behind gate("payroll"). Watermark contract: every run response
 * includes run_mode; the UI stamps the sandbox banner whenever
 * run_mode === 'sandbox' (the mode travels with the run forever).
 */

import express from "express";
import pool from "../config/db.js";
import { requireRole } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import {
  createRun,
  finalizeRun,
  reverseRun,
  RunError,
} from "../services/payrollRunV2.js";
import { resolveRules } from "../services/payrollRules.js";
import { selectBonusRegime } from "../services/payrollEngine.js";
import { mulRate } from "../services/money.js";
import { buildPayStubsPdf } from "../services/payStubPdf.js";
import { buildPayChecksPdf } from "../services/payChecksPdf.js";
import { todayPR, toIso as dateStr } from "../services/prDates.js";

// Everything a PDF needs about a run, fetched server-side. Employee rows
// keep ssn_last4 for the stub (masked there) — they are never sent to the
// client as JSON from these routes.
async function fetchRunBundle(businessId, runId) {
  const runResult = await pool.query(
    `SELECT r.*, p.frequency, p.period_start, p.period_end, p.pay_date
     FROM payroll_runs_v2 r JOIN pay_periods p ON p.id = r.pay_period_id
     WHERE r.id = $1 AND r.business_id = $2`,
    [runId, businessId],
  );
  if (runResult.rows.length === 0) return null;
  const run = runResult.rows[0];

  const linesResult = await pool.query(
    `SELECT l.*, e.name, e.ssn_last4, e.address
     FROM pay_lines l JOIN employees e ON e.id = l.employee_id
     WHERE l.payroll_run_id = $1 ORDER BY e.name ASC`,
    [runId],
  );
  const itemsResult = await pool.query(
    `SELECT i.* FROM pay_items i
     JOIN pay_lines l ON l.id = i.pay_line_id
     WHERE l.payroll_run_id = $1`,
    [runId],
  );
  const itemsByLine = {};
  for (const it of itemsResult.rows) {
    (itemsByLine[it.pay_line_id] ||= []).push(it);
  }
  const lines = linesResult.rows.map((l) => ({
    ...l,
    employee: { name: l.name, ssn_last4: l.ssn_last4, address: l.address },
    items: itemsByLine[l.id] || [],
  }));

  const employerResult = await pool.query(
    "SELECT name, address, city, state, zip, tax_id FROM businesses WHERE id = $1",
    [businessId],
  );

  return { run, lines, employer: employerResult.rows[0] };
}

const router = express.Router();
router.param("id", uuidParam("Payroll run"));

const canRun = requireRole("owner", "admin");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sendRunError(res, err) {
  if (!(err instanceof RunError)) throw err;
  const status =
    err.code === "NOT_FOUND"
      ? 404
      : err.code === "PREFLIGHT_BLOCKED" || err.code === "SNAPSHOT_UNVERIFIED"
        ? 422
        : 400;
  return res
    .status(status)
    .json({ error: err.message, code: err.code, blockers: err.details });
}

// ── GET /api/payroll-v2 ───────────────────────────────────────
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  try {
    const result = await pool.query(
      `SELECT r.id, r.run_mode, r.status, r.reversal_of, r.gross_cents,
              r.employee_deductions_cents, r.employer_contributions_cents,
              r.net_cents, r.created_at, r.finalized_at,
              p.frequency, p.period_start, p.period_end, p.pay_date,
              u.name AS created_by_name,
              (SELECT COUNT(*) FROM pay_lines l WHERE l.payroll_run_id = r.id)::int
                AS employee_count
       FROM payroll_runs_v2 r
       JOIN pay_periods p ON p.id = r.pay_period_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.business_id = $1
       ORDER BY p.period_start DESC, r.created_at DESC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("List payroll v2 runs error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll runs" });
  }
});

// ── GET /api/payroll-v2/reports/bonus-eligibility ─────────────
// Law 148 Christmas-bonus eligibility (Phase 4.3): per active employee,
// qualifying hours to date vs the regime threshold, band, and projected
// bonus at current rules. Everything from the christmas_bonus rule.
router.get("/reports/bonus-eligibility", async (req, res) => {
  const { businessId } = req.user;
  const date =
    req.query.date && DATE_RE.test(req.query.date) ? req.query.date : todayPR();
  const year = Number(date.slice(0, 4));

  try {
    const resolved = await resolveRules(pool, businessId, date);
    const bonusRule = resolved.christmas_bonus;
    if (!bonusRule) {
      return res
        .status(422)
        .json({ error: "No christmas_bonus rule covers this date" });
    }

    const [modeResult, profileResult, empResult, accResult] = await Promise.all(
      [
        pool.query("SELECT payroll_mode FROM businesses WHERE id = $1", [
          businessId,
        ]),
        pool.query(
          "SELECT size_band FROM payroll_employer_profiles WHERE business_id = $1",
          [businessId],
        ),
        pool.query(
          `SELECT id, name, start_date FROM employees
           WHERE business_id = $1 AND is_active = TRUE ORDER BY name`,
          [businessId],
        ),
        pool.query(
          `SELECT employee_id, gross_cents, bonus_qualifying_hours
           FROM employee_year_accumulators
           WHERE business_id = $1 AND year = $2`,
          [businessId, year],
        ),
      ],
    );

    const sizeBand = profileResult.rows[0]?.size_band || null;
    const accBy = new Map(accResult.rows.map((r) => [r.employee_id, r]));

    const rows = empResult.rows.map((emp) => {
      const hireDate = dateStr(emp.start_date);
      const regime = selectBonusRegime(bonusRule.payload, hireDate);
      const band =
        regime && sizeBand
          ? regime.bands.find((b) => b.size_band === sizeBand) || null
          : null;
      const acc = accBy.get(emp.id);
      const hours = Number(acc?.bonus_qualifying_hours || 0);
      const ytdGross = Number(acc?.gross_cents || 0);
      const threshold = regime?.qualifying_hours ?? null;
      return {
        employee_id: emp.id,
        name: emp.name,
        hire_date: hireDate,
        qualifying_hours: hours,
        threshold,
        eligible: threshold != null ? hours >= threshold : null,
        percentage: band?.percentage ?? null,
        cap_cents: band?.cap_cents ?? null,
        projected_bonus_cents: band
          ? Math.min(band.cap_cents, mulRate(ytdGross, band.percentage))
          : null,
      };
    });

    return res.json({
      as_of: date,
      year,
      mode: modeResult.rows[0].payroll_mode,
      watermark: modeResult.rows[0].payroll_mode === "sandbox",
      rule_status: bonusRule.verification_status,
      size_band: sizeBand,
      payment_window: bonusRule.payload.payment_window || null,
      employees: rows,
    });
  } catch (err) {
    console.error("Bonus eligibility error:", err);
    return res
      .status(500)
      .json({ error: "Failed to build bonus eligibility report" });
  }
});

// ── POST /api/payroll-v2 ──────────────────────────────────────
router.post("/", canRun, async (req, res) => {
  const { businessId, userId } = req.user;
  const { periodStart, periodEnd, payDate, frequency, manualDeductions } =
    req.body;

  for (const [name, v] of [
    ["periodStart", periodStart],
    ["periodEnd", periodEnd],
    ["payDate", payDate],
  ]) {
    if (!v || !DATE_RE.test(v)) {
      return res.status(400).json({ error: `${name} must be YYYY-MM-DD` });
    }
  }
  if (periodEnd < periodStart) {
    return res.status(400).json({ error: "periodEnd must be ≥ periodStart" });
  }
  if (!["weekly", "biweekly", "semimonthly", "monthly"].includes(frequency)) {
    return res.status(400).json({ error: "Invalid frequency" });
  }

  try {
    const result = await createRun(pool, {
      businessId,
      userId,
      periodStart,
      periodEnd,
      payDate,
      frequency,
      manualDeductions: manualDeductions || {},
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof RunError) return sendRunError(res, err);
    console.error("Create payroll v2 run error:", err);
    return res.status(500).json({ error: "Failed to create payroll run" });
  }
});

// ── GET /api/payroll-v2/:id ───────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const runResult = await pool.query(
      `SELECT r.*, p.frequency, p.period_start, p.period_end, p.pay_date,
              u.name AS created_by_name
       FROM payroll_runs_v2 r
       JOIN pay_periods p ON p.id = r.pay_period_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = $1 AND r.business_id = $2`,
      [id, businessId],
    );
    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found" });
    }

    const linesResult = await pool.query(
      `SELECT l.*, e.name AS employee_name
       FROM pay_lines l JOIN employees e ON e.id = l.employee_id
       WHERE l.payroll_run_id = $1
       ORDER BY e.name ASC`,
      [id],
    );
    const itemsResult = await pool.query(
      `SELECT i.* FROM pay_items i
       JOIN pay_lines l ON l.id = i.pay_line_id
       WHERE l.payroll_run_id = $1`,
      [id],
    );
    const itemsByLine = {};
    for (const it of itemsResult.rows) {
      (itemsByLine[it.pay_line_id] ||= []).push(it);
    }

    return res.json({
      ...runResult.rows[0],
      lines: linesResult.rows.map((l) => ({
        ...l,
        items: itemsByLine[l.id] || [],
      })),
    });
  } catch (err) {
    console.error("Get payroll v2 run error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll run" });
  }
});

// ── GET /api/payroll-v2/:id/stubs ─────────────────────────────
// All pay stubs of a run in one PDF (the one-click print). Sandbox runs
// carry the watermark on every page; 9017 field gaps are surfaced.
router.get("/:id/stubs", async (req, res) => {
  const { businessId } = req.user;
  try {
    const bundle = await fetchRunBundle(businessId, req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: "Payroll run not found" });
    }

    const accResult = await pool.query(
      `SELECT * FROM employee_year_accumulators
       WHERE business_id = $1 AND year = $2`,
      [businessId, Number(dateStr(bundle.run.pay_date).slice(0, 4))],
    );
    const accumulatorsByEmployee = new Map(
      accResult.rows.map((r) => [r.employee_id, r]),
    );

    const resolved = await resolveRules(
      pool,
      businessId,
      dateStr(bundle.run.pay_date),
    );

    const { pdf, warnings } = await buildPayStubsPdf({
      ...bundle,
      accumulatorsByEmployee,
      stubFieldsRule: resolved.paystub_fields_9017 || null,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="stubs-${dateStr(bundle.run.pay_date)}.pdf"`,
    );
    if (warnings.length) res.setHeader("X-Stub-Warnings", warnings.join("; "));
    return res.send(pdf);
  } catch (err) {
    console.error("Pay stubs PDF error:", err);
    return res.status(500).json({ error: "Failed to build pay stubs" });
  }
});

// ── GET /api/payroll-v2/:id/checks ────────────────────────────
// Printable check run onto pre-printed stock. Finalized runs only —
// never drafts, never reversals. Sandbox checks are struck NO VÁLIDO.
router.get("/:id/checks", async (req, res) => {
  const { businessId } = req.user;
  try {
    const bundle = await fetchRunBundle(businessId, req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: "Payroll run not found" });
    }
    if (bundle.run.status !== "finalized" || bundle.run.reversal_of) {
      return res.status(409).json({
        error: "Checks can only be printed for finalized (non-reversal) runs",
      });
    }

    const profileResult = await pool.query(
      `SELECT check_offset_x_mm, check_offset_y_mm
       FROM payroll_employer_profiles WHERE business_id = $1`,
      [businessId],
    );
    const offsets = {
      xMm: profileResult.rows[0]?.check_offset_x_mm || 0,
      yMm: profileResult.rows[0]?.check_offset_y_mm || 0,
    };

    const pdf = await buildPayChecksPdf({ ...bundle, offsets });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="checks-${dateStr(bundle.run.pay_date)}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    console.error("Pay checks PDF error:", err);
    return res.status(500).json({ error: "Failed to build checks" });
  }
});

// ── POST /api/payroll-v2/:id/finalize ─────────────────────────
router.post("/:id/finalize", canRun, async (req, res) => {
  const { businessId, userId } = req.user;
  try {
    const run = await finalizeRun(pool, {
      businessId,
      userId,
      runId: req.params.id,
    });
    return res.json(run);
  } catch (err) {
    if (err instanceof RunError) return sendRunError(res, err);
    console.error("Finalize payroll v2 run error:", err);
    return res.status(500).json({ error: "Failed to finalize payroll run" });
  }
});

// ── POST /api/payroll-v2/:id/reverse ──────────────────────────
router.post("/:id/reverse", canRun, async (req, res) => {
  const { businessId, userId } = req.user;
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: "Reversal requires confirm: true" });
  }
  try {
    const run = await reverseRun(pool, {
      businessId,
      userId,
      runId: req.params.id,
    });
    return res.json(run);
  } catch (err) {
    if (err instanceof RunError) return sendRunError(res, err);
    console.error("Reverse payroll v2 run error:", err);
    return res.status(500).json({ error: "Failed to reverse payroll run" });
  }
});

// ── DELETE /api/payroll-v2/:id ────────────────────────────────
// Drafts only — the DB trigger backstops finalized/reversed runs.
router.delete("/:id", canRun, async (req, res) => {
  const { businessId } = req.user;
  try {
    const existing = await pool.query(
      "SELECT status FROM payroll_runs_v2 WHERE id = $1 AND business_id = $2",
      [req.params.id, businessId],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found" });
    }
    if (existing.rows[0].status !== "draft") {
      return res.status(409).json({
        error: "Finalized runs cannot be deleted — post a reversal instead",
      });
    }
    await pool.query(
      "DELETE FROM payroll_runs_v2 WHERE id = $1 AND business_id = $2",
      [req.params.id, businessId],
    );
    return res.json({ message: "Draft payroll run deleted" });
  } catch (err) {
    console.error("Delete payroll v2 run error:", err);
    return res.status(500).json({ error: "Failed to delete payroll run" });
  }
});

export default router;
