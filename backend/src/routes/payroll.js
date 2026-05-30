import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { calculatePayslip, getPeriodsPerYear } from "../services/payroll.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ── GET /api/payroll ──────────────────────────────────────────
// Get all payroll runs for the business
router.get("/", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        pr.*,
        u.name AS created_by_name,
        COUNT(ps.id) AS employee_count
       FROM payroll_runs pr
       LEFT JOIN users u ON u.id = pr.created_by
       LEFT JOIN payslips ps ON ps.payroll_run_id = pr.id
       WHERE pr.business_id = $1
       GROUP BY pr.id, u.name
       ORDER BY pr.period_start DESC`,
      [businessId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Get payroll runs error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll runs" });
  }
});

// ── GET /api/payroll/:id ──────────────────────────────────────
// Get a single payroll run with all payslips
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    // Get payroll run
    const runResult = await pool.query(
      `SELECT pr.*, u.name AS created_by_name
       FROM payroll_runs pr
       LEFT JOIN users u ON u.id = pr.created_by
       WHERE pr.id = $1 AND pr.business_id = $2`,
      [id, businessId],
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found" });
    }

    // Get all payslips for this run
    const payslipsResult = await pool.query(
      `SELECT
        ps.*,
        e.name AS employee_name,
        e.pay_type,
        e.pay_frequency,
        e.email AS employee_email
       FROM payslips ps
       JOIN employees e ON e.id = ps.employee_id
       WHERE ps.payroll_run_id = $1
       ORDER BY e.name ASC`,
      [id],
    );

    return res.json({
      ...runResult.rows[0],
      payslips: payslipsResult.rows,
    });
  } catch (err) {
    console.error("Get payroll run error:", err);
    return res.status(500).json({ error: "Failed to fetch payroll run" });
  }
});

// ── POST /api/payroll ─────────────────────────────────────────
// Create a new payroll run — auto-calculates all active employees
router.post("/", async (req, res) => {
  const { businessId, userId } = req.user;
  const { periodStart, periodEnd, hoursWorked } = req.body;
  // hoursWorked: { employeeId: hours } — only needed for hourly employees

  if (!periodStart || !periodEnd) {
    return res
      .status(400)
      .json({ error: "periodStart and periodEnd are required" });
  }

  if (new Date(periodEnd) <= new Date(periodStart)) {
    return res
      .status(400)
      .json({ error: "periodEnd must be after periodStart" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get all active employees for this business
    const employeesResult = await client.query(
      `SELECT * FROM employees
       WHERE business_id = $1 AND is_active = TRUE`,
      [businessId],
    );

    if (employeesResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No active employees found" });
    }

    // Create the payroll run
    const runResult = await client.query(
      `INSERT INTO payroll_runs
        (business_id, period_start, period_end, created_by, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [businessId, periodStart, periodEnd, userId],
    );
    const run = runResult.rows[0];

    let totalGross = 0;
    let totalTaxes = 0;
    let totalNet = 0;

    // Calculate and insert payslip for each employee
    for (const employee of employeesResult.rows) {
      const periodsPerYear = getPeriodsPerYear(employee.pay_frequency);

      // Attach hours worked for hourly employees
      if (employee.pay_type === "hourly" && hoursWorked) {
        employee.hours_worked = hoursWorked[employee.id] || 0;
      }

      const payslip = calculatePayslip(employee, periodsPerYear);

      await client.query(
        `INSERT INTO payslips (
          payroll_run_id, employee_id,
          gross_pay, federal_tax, social_security,
          medicare, pr_state_tax, other_deductions,
          net_pay, hours_worked
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          run.id,
          employee.id,
          payslip.grossPay,
          payslip.federalTax,
          payslip.socialSecurity,
          payslip.medicare,
          payslip.prStateTax,
          payslip.otherDeductions,
          payslip.netPay,
          employee.pay_type === "hourly" ? employee.hours_worked || 0 : null,
        ],
      );

      totalGross += payslip.grossPay;
      totalTaxes += payslip.totalTaxes;
      totalNet += payslip.netPay;
    }

    // Update payroll run totals
    await client.query(
      `UPDATE payroll_runs SET
        total_gross = $1,
        total_taxes = $2,
        total_net   = $3
       WHERE id = $4`,
      [
        Math.round(totalGross * 100) / 100,
        Math.round(totalTaxes * 100) / 100,
        Math.round(totalNet * 100) / 100,
        run.id,
      ],
    );

    await client.query("COMMIT");

    // Return full run with payslips
    const full = await pool.query(
      `SELECT
        pr.*,
        json_agg(json_build_object(
          'employee_name', e.name,
          'gross_pay', ps.gross_pay,
          'federal_tax', ps.federal_tax,
          'social_security', ps.social_security,
          'medicare', ps.medicare,
          'pr_state_tax', ps.pr_state_tax,
          'net_pay', ps.net_pay,
          'hours_worked', ps.hours_worked
        )) AS payslips
       FROM payroll_runs pr
       JOIN payslips ps ON ps.payroll_run_id = pr.id
       JOIN employees e ON e.id = ps.employee_id
       WHERE pr.id = $1
       GROUP BY pr.id`,
      [run.id],
    );

    return res.status(201).json(full.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create payroll run error:", err);
    return res.status(500).json({ error: "Failed to create payroll run" });
  } finally {
    client.release();
  }
});

// ── PUT /api/payroll/:id/finalize ─────────────────────────────
// Finalize a payroll run — locks it from edits
router.put("/:id/finalize", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM payroll_runs WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found" });
    }

    if (existing.rows[0].status === "finalized") {
      return res
        .status(400)
        .json({ error: "Payroll run is already finalized" });
    }

    const result = await pool.query(
      `UPDATE payroll_runs SET status = 'finalized'
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [id, businessId],
    );

    return res.json({
      message: "Payroll run finalized",
      payrollRun: result.rows[0],
    });
  } catch (err) {
    console.error("Finalize payroll error:", err);
    return res.status(500).json({ error: "Failed to finalize payroll run" });
  }
});

// ── DELETE /api/payroll/:id ───────────────────────────────────
// Delete a draft payroll run — finalized runs cannot be deleted
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM payroll_runs WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Payroll run not found" });
    }

    if (existing.rows[0].status === "finalized") {
      return res.status(400).json({
        error: "Finalized payroll runs cannot be deleted",
      });
    }

    // Payslips deleted via ON DELETE CASCADE
    await pool.query(
      "DELETE FROM payroll_runs WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    return res.json({ message: "Payroll run deleted" });
  } catch (err) {
    console.error("Delete payroll run error:", err);
    return res.status(500).json({ error: "Failed to delete payroll run" });
  }
});

// ── GET /api/payroll/summary/ytd ──────────────────────────────
// Year to date payroll summary for dashboard
router.get("/summary/ytd", async (req, res) => {
  const { businessId } = req.user;

  try {
    const result = await pool.query(
      `SELECT
        COALESCE(SUM(pr.total_gross), 0) AS ytd_gross,
        COALESCE(SUM(pr.total_taxes), 0) AS ytd_taxes,
        COALESCE(SUM(pr.total_net), 0)   AS ytd_net,
        COUNT(DISTINCT pr.id)             AS total_runs,
        COUNT(DISTINCT ps.employee_id)    AS total_employees_paid
       FROM payroll_runs pr
       LEFT JOIN payslips ps ON ps.payroll_run_id = pr.id
       WHERE pr.business_id = $1
         AND pr.status = 'finalized'
         AND EXTRACT(YEAR FROM pr.period_end) = EXTRACT(YEAR FROM NOW())`,
      [businessId],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("YTD summary error:", err);
    return res.status(500).json({ error: "Failed to fetch YTD summary" });
  }
});

export default router;
