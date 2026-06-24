import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";

const router = express.Router();
router.use(requireAuth);
router.param("id", uuidParam("Project"));

const STATUSES = new Set(["active", "completed", "archived"]);

// Validate + normalize a create/update body. Returns { error } or { input }.
function readProjectInput(body) {
  const name = (body.name ?? "").trim();
  if (!name) return { error: "name is required" };
  const status = body.status || "active";
  if (!STATUSES.has(status))
    return { error: "status must be active, completed or archived" };
  const budget =
    body.budget === "" || body.budget == null ? null : parseFloat(body.budget);
  if (budget != null && !(budget >= 0))
    return { error: "budget must be a positive number" };
  return {
    input: {
      name,
      description: body.description || null,
      color: body.color || "#4f8ef7",
      clientId: body.client_id || body.clientId || null,
      status,
      budget,
      startDate: body.start_date || body.startDate || null,
      endDate: body.end_date || body.endDate || null,
      isActive: status === "active",
    },
  };
}

// Confirm a client (if given) belongs to this business.
async function validateClient(businessId, clientId) {
  if (!clientId) return { ok: true };
  const r = await pool.query(
    "SELECT id FROM clients WHERE id = $1 AND business_id = $2",
    [clientId, businessId],
  );
  return r.rows.length ? { ok: true } : { error: "Client not found" };
}

// ── GET /api/projects ────────────────────────────────────────
// List with job-costing financials. Hours and transaction totals use scalar
// subqueries so they don't fan out against each other.
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { status } = req.query;
  try {
    const params = [businessId];
    let where = "WHERE p.business_id = $1";
    if (status && STATUSES.has(status)) {
      where += " AND p.status = $2";
      params.push(status);
    }
    const result = await pool.query(
      `SELECT
        p.id, p.name, p.description, p.color, p.is_active, p.status,
        p.client_id, p.budget,
        p.start_date::text AS start_date, p.end_date::text AS end_date, p.created_at,
        c.name AS client_name,
        COALESCE((SELECT SUM(te.hours) FROM time_entries te WHERE te.project_id = p.id), 0)::numeric AS total_hours,
        COALESCE((SELECT COUNT(*) FROM time_entries te WHERE te.project_id = p.id), 0)::int AS entry_count,
        COALESCE((SELECT SUM(CASE WHEN te.is_billable AND te.hourly_rate IS NOT NULL
          THEN te.hours * te.hourly_rate ELSE 0 END) FROM time_entries te WHERE te.project_id = p.id), 0)::numeric AS billable_amount,
        COALESCE((SELECT SUM(t.total_amount) FROM transactions t
          WHERE t.project_id = p.id AND t.business_id = $1 AND t.type = 'income'), 0)::numeric AS income_total,
        COALESCE((SELECT SUM(t.total_amount) FROM transactions t
          WHERE t.project_id = p.id AND t.business_id = $1 AND t.type = 'expense'), 0)::numeric AS expense_total
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       ${where}
       ORDER BY p.created_at DESC`,
      params,
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get projects error:", err);
    return res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// ── GET /api/projects/:id/hours — declared before /:id ──────
router.get("/:id/hours", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN is_billable     THEN hours ELSE 0 END), 0)::numeric AS billable_hours,
        COALESCE(SUM(CASE WHEN NOT is_billable THEN hours ELSE 0 END), 0)::numeric AS non_billable_hours,
        COALESCE(SUM(hours), 0)::numeric                                            AS total_hours,
        COALESCE(SUM(CASE WHEN is_billable AND hourly_rate IS NOT NULL
          THEN hours * hourly_rate ELSE 0 END), 0)::numeric                        AS billable_amount
       FROM time_entries
       WHERE project_id = $1 AND business_id = $2`,
      [id, businessId],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get project hours error:", err);
    return res.status(500).json({ error: "Failed to fetch project hours" });
  }
});

// ── GET /api/projects/:id/summary — declared before /:id ────
// Per-job P&L from ACTUAL tagged transactions (the ledger truth) + a category
// breakdown, with hours logged shown separately and budget-vs-actual where the
// actual cost is tagged expenses.
router.get("/:id/summary", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const projRes = await pool.query(
      `SELECT p.id, p.name, p.status, p.budget,
              p.start_date::text AS start_date, p.end_date::text AS end_date,
              p.client_id, c.name AS client_name
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1 AND p.business_id = $2`,
      [id, businessId],
    );
    if (projRes.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    const project = projRes.rows[0];

    // Income/expense totals from tagged transactions.
    const totalsRes = await pool.query(
      `SELECT
         COALESCE(SUM(total_amount) FILTER (WHERE type = 'income'), 0)::numeric  AS income_total,
         COALESCE(SUM(total_amount) FILTER (WHERE type = 'expense'), 0)::numeric AS expense_total,
         COUNT(*)::int AS transaction_count
       FROM transactions WHERE project_id = $1 AND business_id = $2`,
      [id, businessId],
    );
    const income = parseFloat(totalsRes.rows[0].income_total);
    const expense = parseFloat(totalsRes.rows[0].expense_total);

    // Category breakdown over the tagged transactions' journal lines.
    const catRes = await pool.query(
      `SELECT coa.id, coa.name_key, coa.name, coa.color, coa.account_type,
         SUM(CASE WHEN coa.account_type = 'revenue'
                  THEN jel.credit - jel.debit ELSE jel.debit - jel.credit END)::numeric AS total
       FROM transactions t
       JOIN journal_entries je ON je.source_type = 'transaction' AND je.source_id = t.id
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
         AND coa.account_type IN ('revenue','expense')
       WHERE t.project_id = $1 AND t.business_id = $2
       GROUP BY coa.id, coa.name_key, coa.name, coa.color, coa.account_type
       HAVING SUM(CASE WHEN coa.account_type = 'revenue'
                  THEN jel.credit - jel.debit ELSE jel.debit - jel.credit END) <> 0
       ORDER BY total DESC`,
      [id, businessId],
    );

    const hoursRes = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN is_billable     THEN hours ELSE 0 END), 0)::numeric AS billable_hours,
        COALESCE(SUM(CASE WHEN NOT is_billable THEN hours ELSE 0 END), 0)::numeric AS non_billable_hours,
        COALESCE(SUM(hours), 0)::numeric AS total_hours,
        COALESCE(SUM(CASE WHEN is_billable AND hourly_rate IS NOT NULL
          THEN hours * hourly_rate ELSE 0 END), 0)::numeric AS billable_amount
       FROM time_entries WHERE project_id = $1 AND business_id = $2`,
      [id, businessId],
    );

    const budget = project.budget != null ? parseFloat(project.budget) : null;

    return res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        client_id: project.client_id,
        client_name: project.client_name,
        budget,
        start_date: project.start_date,
        end_date: project.end_date,
      },
      income_total: parseFloat(income.toFixed(2)),
      expense_total: parseFloat(expense.toFixed(2)),
      net: parseFloat((income - expense).toFixed(2)),
      transaction_count: totalsRes.rows[0].transaction_count,
      categories: catRes.rows,
      hours: hoursRes.rows[0],
      // Budget tracks cost: actual = tagged expenses.
      actual_cost: parseFloat(expense.toFixed(2)),
      budget_remaining: budget != null ? parseFloat((budget - expense).toFixed(2)) : null,
    });
  } catch (err) {
    console.error("Get project summary error:", err);
    return res.status(500).json({ error: "Failed to fetch project summary" });
  }
});

// ── GET /api/projects/:id ────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.*, p.start_date::text AS start_date, p.end_date::text AS end_date,
              c.name AS client_name
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1 AND p.business_id = $2`,
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Get project error:", err);
    return res.status(500).json({ error: "Failed to fetch project" });
  }
});

// ── POST /api/projects ───────────────────────────────────────
router.post("/", async (req, res) => {
  const { businessId } = req.user;
  const parsed = readProjectInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.input;

  try {
    const clientCheck = await validateClient(businessId, p.clientId);
    if (clientCheck.error)
      return res.status(400).json({ error: clientCheck.error });

    const result = await pool.query(
      `INSERT INTO projects
         (business_id, name, description, color, client_id, status, budget, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        businessId, p.name, p.description, p.color, p.clientId, p.status,
        p.budget, p.startDate, p.endDate, p.isActive,
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create project error:", err);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

// ── PUT /api/projects/:id ────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const parsed = readProjectInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.input;

  try {
    const clientCheck = await validateClient(businessId, p.clientId);
    if (clientCheck.error)
      return res.status(400).json({ error: clientCheck.error });

    const result = await pool.query(
      `UPDATE projects SET
         name = $1, description = $2, color = $3, client_id = $4, status = $5,
         budget = $6, start_date = $7, end_date = $8, is_active = $9
       WHERE id = $10 AND business_id = $11 RETURNING *`,
      [
        p.name, p.description, p.color, p.clientId, p.status,
        p.budget, p.startDate, p.endDate, p.isActive, id, businessId,
      ],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update project error:", err);
    return res.status(500).json({ error: "Failed to update project" });
  }
});

// ── DELETE /api/projects/:id ─────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM projects WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    return res.json({ message: "Project deleted" });
  } catch (err) {
    console.error("Delete project error:", err);
    return res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
