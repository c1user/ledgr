import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import { encryptField } from "../services/fieldCrypto.js";

const router = express.Router();

// All routes require authentication
router.use(requireAuth);
router.param("id", uuidParam("Employee"));

const PAY_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"];
const CLASSIFICATIONS = ["nonexempt_hourly", "exempt_salaried"];

// Full SSN handling (ROADMAP-V5 Phase 2.2): the plaintext arrives once,
// is encrypted immediately (AES-256-GCM), and only the last 4 digits are
// kept in clear for display. The plaintext is NEVER echoed back, logged
// (auditLog scrubs /ssn/i keys), or stored anywhere else.
// Returns { error } | { ssnEncrypted, ssnLast4 } | null when absent.
function processSsn(ssn) {
  if (ssn === undefined || ssn === null || ssn === "") return null;
  const digits = String(ssn).replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) {
    return { error: "ssn must be 9 digits (dashes optional)" };
  }
  try {
    return { ssnEncrypted: encryptField(digits), ssnLast4: digits.slice(-4) };
  } catch (err) {
    // Key misconfiguration — fail closed, never store plaintext instead.
    console.error("SSN encryption unavailable:", err.message);
    return { error: "SSN encryption is not configured on this server" };
  }
}

// Strip every SSN column and mask the display last-4.
function presentEmployee(row) {
  const { ssn_encrypted, ssn_last4, ...emp } = row;
  emp.ssn_last4 = ssn_last4 ? `***-**-${ssn_last4}` : null;
  emp.has_ssn = Boolean(ssn_encrypted);
  return emp;
}

// ── GET /api/employees ────────────────────────────────────────
// Get all employees for the business
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { active } = req.query; // optional: true | false

  try {
    // v2 figures, matched to the business's current payroll mode and
    // reversal-aware (a reversed pair nets to zero).
    let query = `
      SELECT
        e.*,
        (
          SELECT (l.net_cents::NUMERIC / 100)
          FROM pay_lines l
          JOIN payroll_runs_v2 r ON r.id = l.payroll_run_id
          JOIN pay_periods p ON p.id = r.pay_period_id
          WHERE l.employee_id = e.id
            AND r.status = 'finalized' AND r.reversal_of IS NULL
            AND r.run_mode = (SELECT payroll_mode FROM businesses b WHERE b.id = e.business_id)
          ORDER BY p.period_end DESC
          LIMIT 1
        ) AS last_net_pay,
        (
          SELECT COALESCE(SUM(
            CASE WHEN r.reversal_of IS NULL THEN l.gross_cents ELSE -l.gross_cents END
          ), 0)::NUMERIC / 100
          FROM pay_lines l
          JOIN payroll_runs_v2 r ON r.id = l.payroll_run_id
          JOIN pay_periods p ON p.id = r.pay_period_id
          WHERE l.employee_id = e.id
            AND r.status IN ('finalized', 'reversed')
            AND r.run_mode = (SELECT payroll_mode FROM businesses b WHERE b.id = e.business_id)
            AND EXTRACT(YEAR FROM p.pay_date) = EXTRACT(YEAR FROM NOW())
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

    // Never return SSN columns in list view
    const employees = result.rows.map(
      ({ ssn_last4, ssn_encrypted, ...emp }) => emp,
    );

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

    return res.json(presentEmployee(result.rows[0]));
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
    ssn,
    ssnLast4,
    address,
    payType,
    payRate,
    payFrequency,
    classification,
    elections499r4,
    isChauffeur,
    startDate,
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

  if (!PAY_FREQUENCIES.includes(payFrequency)) {
    return res.status(400).json({
      error: `payFrequency must be one of: ${PAY_FREQUENCIES.join(", ")}`,
    });
  }

  if (classification && !CLASSIFICATIONS.includes(classification)) {
    return res.status(400).json({
      error: `classification must be one of: ${CLASSIFICATIONS.join(", ")}`,
    });
  }

  if (
    elections499r4 !== undefined &&
    (elections499r4 === null ||
      typeof elections499r4 !== "object" ||
      Array.isArray(elections499r4))
  ) {
    return res.status(400).json({ error: "elections499r4 must be an object" });
  }

  if (payRate <= 0) {
    return res.status(400).json({ error: "payRate must be greater than 0" });
  }

  const ssnResult = processSsn(ssn);
  if (ssnResult?.error) {
    return res.status(400).json({ error: ssnResult.error });
  }
  // Legacy path: last-4 only, no full SSN on file.
  if (!ssnResult && ssnLast4 && !/^\d{4}$/.test(ssnLast4)) {
    return res.status(400).json({ error: "ssnLast4 must be exactly 4 digits" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO employees (
        business_id, name, email, ssn_last4, ssn_encrypted, address,
        pay_type, pay_rate, pay_frequency, classification,
        elections_499r4, is_chauffeur, start_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        businessId,
        name,
        email || null,
        ssnResult?.ssnLast4 || ssnLast4 || null,
        ssnResult?.ssnEncrypted || null,
        address || null,
        payType,
        payRate,
        payFrequency,
        classification ||
          (payType === "hourly" ? "nonexempt_hourly" : "exempt_salaried"),
        JSON.stringify(elections499r4 || {}),
        isChauffeur === true,
        startDate,
      ],
    );

    return res.status(201).json(presentEmployee(result.rows[0]));
  } catch (err) {
    console.error("Create employee error:", err.message);
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
    ssn,
    address,
    payType,
    payRate,
    payFrequency,
    classification,
    elections499r4,
    isChauffeur,
    endDate,
    isActive,
  } = req.body;

  if (payFrequency && !PAY_FREQUENCIES.includes(payFrequency)) {
    return res.status(400).json({
      error: `payFrequency must be one of: ${PAY_FREQUENCIES.join(", ")}`,
    });
  }

  if (classification && !CLASSIFICATIONS.includes(classification)) {
    return res.status(400).json({
      error: `classification must be one of: ${CLASSIFICATIONS.join(", ")}`,
    });
  }

  if (
    elections499r4 !== undefined &&
    (elections499r4 === null ||
      typeof elections499r4 !== "object" ||
      Array.isArray(elections499r4))
  ) {
    return res.status(400).json({ error: "elections499r4 must be an object" });
  }

  // SSN is write-only: sent → replaced (encrypted); absent → unchanged.
  const ssnResult = processSsn(ssn);
  if (ssnResult?.error) {
    return res.status(400).json({ error: ssnResult.error });
  }

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
        end_date              = COALESCE($6,  end_date),
        is_active             = COALESCE($7,  is_active),
        ssn_encrypted         = COALESCE($8,  ssn_encrypted),
        ssn_last4             = COALESCE($9,  ssn_last4),
        address               = COALESCE($10, address),
        classification        = COALESCE($11, classification),
        elections_499r4       = COALESCE($12, elections_499r4),
        is_chauffeur          = COALESCE($13, is_chauffeur)
       WHERE id = $14 AND business_id = $15
       RETURNING *`,
      [
        name || null,
        email || null,
        payType || null,
        payRate || null,
        payFrequency || null,
        endDate || null,
        isActive ?? null,
        ssnResult?.ssnEncrypted || null,
        ssnResult?.ssnLast4 || null,
        address ?? null,
        classification || null,
        elections499r4 !== undefined ? JSON.stringify(elections499r4) : null,
        typeof isChauffeur === "boolean" ? isChauffeur : null,
        id,
        businessId,
      ],
    );

    return res.json(presentEmployee(result.rows[0]));
  } catch (err) {
    console.error("Update employee error:", err.message);
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
