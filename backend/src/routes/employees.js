import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ── GET /api/employees ────────────────────────────────────────
// Get all employees for the business
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { active } = req.query; // optional: true | false

  try {
    let query = `
      SELECT
        e.*,
        -- Most recent payslip net pay
        (
          SELECT ps.net_pay
          FROM payslips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
          WHERE ps.employee_id = e.id
          ORDER BY pr.period_end DESC
          LIMIT 1
        ) AS last_net_pay,
        -- Total paid this year
        (
          SELECT COALESCE(SUM(ps.gross_pay), 0)
          FROM payslips ps
          JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
          WHERE ps.employee_id = e.id
            AND EXTRACT(YEAR FROM pr.period_end) = EXTRACT(YEAR FROM NOW())
        ) AS ytd_gross
      FROM employees e
      WHERE e.business_id = $1
    `;

    const params = [businessId];

    if (active !== undefined) {
      query += ` AND e.is_active = $2`;
      params.push(active === "true");
    }

    query += ` ORDER BY e.is_active DESC, e.name ASC`;

    const result = await pool.query(query, params);

    // Never return ssn_last4 in list view
    const employees = result.rows.map(({ ssn_last4, ...emp }) => emp);

    return res.json(employees);
  } catch (err) {
    console.error("Get employees error:", err);
    return res.status(500).json({ error: "Failed to fetch employees" });
  }
});

// ── GET /api/employees/:id ────────────────────────────────────
// Get a single employee
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM employees
       WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Mask SSN — only show last 4
    const employee = result.rows[0];
    if (employee.ssn_last4) {
      employee.ssn_last4 = `***-**-${employee.ssn_last4}`;
    }

    return res.json(employee);
  } catch (err) {
    console.error("Get employee error:", err);
    return res.status(500).json({ error: "Failed to fetch employee" });
  }
});

// ── POST /api/employees ───────────────────────────────────────
// Create a new employee
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const {
    name,
    email,
    ssnLast4,
    payType,
    payRate,
    payFrequency,
    federalFilingStatus,
    federalAllowances,
    prStateTaxRate,
    startDate,
    federalExempt,
  } = req.body;

  // Validation
  if (!name || !payType || !payRate || !payFrequency || !startDate) {
    return res.status(400).json({
      error: "name, payType, payRate, payFrequency, and startDate are required",
    });
  }

  if (!["salary", "hourly"].includes(payType)) {
    return res.status(400).json({ error: "payType must be salary or hourly" });
  }

  if (!["weekly", "biweekly", "monthly"].includes(payFrequency)) {
    return res.status(400).json({
      error: "payFrequency must be weekly, biweekly, or monthly",
    });
  }

  if (payRate <= 0) {
    return res.status(400).json({ error: "payRate must be greater than 0" });
  }

  if (ssnLast4 && !/^\d{4}$/.test(ssnLast4)) {
    return res.status(400).json({ error: "ssnLast4 must be exactly 4 digits" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO employees (
        business_id, name, email, ssn_last4,
        pay_type, pay_rate, pay_frequency,
        federal_filing_status, federal_allowances,
        pr_state_tax_rate, start_date, federal_exempt
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        businessId,
        name,
        email || null,
        ssnLast4 || null,
        payType,
        payRate,
        payFrequency,
        federalFilingStatus || "single",
        federalAllowances || 0,
        prStateTaxRate || 0.07,
        startDate,
        federalExempt ?? true,
      ],
    );

    const employee = result.rows[0];
    // Mask SSN before returning
    if (employee.ssn_last4) {
      employee.ssn_last4 = `***-**-${employee.ssn_last4}`;
    }

    return res.status(201).json(employee);
  } catch (err) {
    console.error("Create employee error:", err);
    return res.status(500).json({ error: "Failed to create employee" });
  }
});

// ── PUT /api/employees/:id ────────────────────────────────────
// Update an employee
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const {
    name,
    email,
    payType,
    payRate,
    payFrequency,
    federalFilingStatus,
    federalAllowances,
    prStateTaxRate,
    endDate,
    isActive,
  } = req.body;

  try {
    const existing = await pool.query(
      "SELECT * FROM employees WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const result = await pool.query(
      `UPDATE employees SET
        name                  = COALESCE($1,  name),
        email                 = COALESCE($2,  email),
        pay_type              = COALESCE($3,  pay_type),
        pay_rate              = COALESCE($4,  pay_rate),
        pay_frequency         = COALESCE($5,  pay_frequency),
        federal_filing_status = COALESCE($6,  federal_filing_status),
        federal_allowances    = COALESCE($7,  federal_allowances),
        pr_state_tax_rate     = COALESCE($8,  pr_state_tax_rate),
        end_date              = COALESCE($9,  end_date),
        is_active             = COALESCE($10, is_active)
       WHERE id = $11 AND business_id = $12
       RETURNING *`,
      [
        name || null,
        email || null,
        payType || null,
        payRate || null,
        payFrequency || null,
        federalFilingStatus || null,
        federalAllowances ?? null,
        prStateTaxRate || null,
        endDate || null,
        isActive ?? null,
        id,
        businessId,
      ],
    );

    const employee = result.rows[0];
    if (employee.ssn_last4) {
      employee.ssn_last4 = `***-**-${employee.ssn_last4}`;
    }

    return res.json(employee);
  } catch (err) {
    console.error("Update employee error:", err);
    return res.status(500).json({ error: "Failed to update employee" });
  }
});

// ── DELETE /api/employees/:id ─────────────────────────────────
// Soft delete — sets is_active to false and records end date
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const existing = await pool.query(
      "SELECT * FROM employees WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Soft delete — preserve payroll history
    await pool.query(
      `UPDATE employees SET
        is_active = FALSE,
        end_date  = COALESCE(end_date, CURRENT_DATE)
       WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );

    return res.json({
      message: "Employee deactivated. Payroll history preserved.",
    });
  } catch (err) {
    console.error("Delete employee error:", err);
    return res.status(500).json({ error: "Failed to deactivate employee" });
  }
});

export default router;
