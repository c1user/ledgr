/**
 * routes/recurring.js
 *
 * Item 7 (Recurring transactions).
 *
 * A recurring transaction is a TEMPLATE. It never touches the ledger itself;
 * instead, on or after its due date it materializes a real `transactions` row
 * via services/transactionPosting.createLedgerTransaction — the same path the
 * manual create uses — so a generated transaction is indistinguishable from a
 * hand-entered one except for its recurring_id backreference.
 *
 * Generation is pull-based: there is no background worker yet. The frontend (or
 * a future cron) calls POST /:id/generate or POST /generate-due, and we
 * "catch up" by materializing every occurrence whose next_due has passed, up to
 * today, advancing next_due each step. String date math keeps it timezone-safe.
 *
 * Mount in server.js:  app.use("/api/recurring", recurringRoutes);
 */

import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateUuid.js";
import {
  resolveFundingSource,
  validateCategoryAccounts,
  createLedgerTransaction,
} from "../services/transactionPosting.js";

const router = express.Router();
router.use(requireAuth);
router.param("id", uuidParam("Recurring transaction"));

const FREQUENCIES = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Guard against a runaway catch-up (e.g. a daily template years overdue).
const MAX_GENERATE_PER_RUN = 1000;

// ── Date helpers (pure string YYYY-MM-DD math, UTC, no tz drift) ──

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Add whole months to (y, monthIndex, day), clamping the day to the target
// month and anchoring to the template's original day-of-month so repeated
// monthly generation off e.g. the 31st doesn't drift earlier over time.
function addMonths(y, monthIndex, monthsToAdd, anchorDay) {
  const total = monthIndex + monthsToAdd;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const nd = Math.min(anchorDay, daysInMonth(ny, nm));
  return new Date(Date.UTC(ny, nm, nd));
}

// The next occurrence date after `fromYmd` for a frequency. `startYmd` supplies
// the anchor day-of-month for the month-based frequencies.
export function computeNextDue(fromYmd, frequency, startYmd) {
  const [y, m, d] = fromYmd.split("-").map(Number);
  const mi = m - 1;
  const anchorDay = startYmd ? Number(startYmd.split("-")[2]) : d;

  let next;
  switch (frequency) {
    case "daily":
      next = new Date(Date.UTC(y, mi, d + 1));
      break;
    case "weekly":
      next = new Date(Date.UTC(y, mi, d + 7));
      break;
    case "monthly":
      next = addMonths(y, mi, 1, anchorDay);
      break;
    case "quarterly":
      next = addMonths(y, mi, 3, anchorDay);
      break;
    case "yearly":
      next = addMonths(y, mi, 12, anchorDay);
      break;
    default:
      throw new Error(`computeNextDue: unknown frequency ${frequency}`);
  }
  return next.toISOString().slice(0, 10);
}

// ── Shared SELECT ────────────────────────────────────────────
// Date columns cast to text so the JSON response (and the generator) get clean
// 'YYYY-MM-DD' strings instead of tz-shifted Date objects.
const TEMPLATE_SELECT = `
  SELECT
    r.id, r.business_id, r.type, r.merchant, r.amount, r.frequency,
    r.start_date::text   AS start_date,
    r.end_date::text     AS end_date,
    r.last_generated::text AS last_generated,
    r.next_due::text     AS next_due,
    r.is_active, r.notes, r.account_id, r.funding_coa_id,
    r.category_account_id, r.created_at,
    COALESCE(a.name, fcoa.name)  AS funding_name,
    fcoa.name_key                AS funding_name_key,
    cat.name      AS category_name,
    cat.name_key  AS category_name_key,
    cat.color     AS category_color,
    (SELECT COUNT(*)::int FROM transactions t WHERE t.recurring_id = r.id)
      AS generated_count
  FROM recurring_transactions r
  LEFT JOIN accounts a            ON a.id = r.account_id
  LEFT JOIN chart_of_accounts fcoa ON fcoa.id = r.funding_coa_id
  LEFT JOIN chart_of_accounts cat  ON cat.id = r.category_account_id`;

async function loadTemplate(runner, businessId, id) {
  const r = await runner.query(
    `${TEMPLATE_SELECT} WHERE r.id = $1 AND r.business_id = $2`,
    [id, businessId],
  );
  return r.rows[0] || null;
}

// Validate + normalize a create/update body. Returns { error } or { input }.
function readTemplateInput(body) {
  const type = body.type;
  const amount = parseFloat(body.amount);
  const frequency = body.frequency;
  const startDate = body.startDate;
  const endDate = body.endDate || null;
  const merchant = (body.merchant ?? "").trim() || null;
  const notes = (body.notes ?? "").trim() || null;
  const categoryId = body.categoryId || null;
  const accountId = body.accountId || null;
  const fundingCoaId = body.fundingCoaId || null;
  const isActive = body.isActive === undefined ? true : !!body.isActive;

  if (!["income", "expense"].includes(type))
    return { error: "type must be income or expense" };
  if (!(amount > 0)) return { error: "amount must be greater than 0" };
  if (!FREQUENCIES.has(frequency))
    return { error: "frequency must be daily, weekly, monthly, quarterly or yearly" };
  if (!startDate || !DATE_RE.test(startDate))
    return { error: "startDate (YYYY-MM-DD) is required" };
  if (endDate && !DATE_RE.test(endDate))
    return { error: "endDate must be YYYY-MM-DD" };
  if (endDate && endDate < startDate)
    return { error: "endDate cannot be before startDate" };
  if (!categoryId)
    return { error: "categoryId (a revenue/expense account) is required" };
  if ((!accountId && !fundingCoaId) || (accountId && fundingCoaId))
    return {
      error: "Provide exactly one funding source: accountId or fundingCoaId",
    };

  return {
    input: {
      type,
      amount,
      frequency,
      startDate,
      endDate,
      merchant,
      notes,
      categoryId,
      accountId,
      fundingCoaId,
      isActive,
    },
  };
}

// Confirm the funding source + category account exist and are the right type
// for this business. Returns { error } or { ok: true }.
async function validateTemplateAccounts(runner, businessId, input) {
  const funding = await resolveFundingSource(runner, businessId, {
    accountId: input.accountId,
    fundingCoaId: input.fundingCoaId,
  });
  if (funding.error) return { error: funding.error };

  const catCheck = await validateCategoryAccounts(
    runner,
    businessId,
    [input.categoryId],
    input.type,
  );
  if (catCheck.error) return { error: catCheck.error };

  return { ok: true };
}

// ── Generation core ──────────────────────────────────────────
// Materialize every due occurrence of one template up to `today`, advancing
// next_due/last_generated. Runs inside the caller's open transaction.
// When end_date is reached the template auto-deactivates. `respectActive`
// gates the loop on is_active (true for the bulk sweep; false for an explicit
// single-template generate so a paused template can still be run on demand).
//
// Returns the array of created transaction rows.
async function generateDue(client, businessId, userId, tmpl, today, respectActive) {
  const created = [];
  let nextDue = tmpl.next_due;
  let lastGenerated = tmpl.last_generated;
  let isActive = tmpl.is_active;

  for (let i = 0; i < MAX_GENERATE_PER_RUN; i++) {
    if (respectActive && !isActive) break;
    if (nextDue > today) break;
    if (tmpl.end_date && nextDue > tmpl.end_date) break;

    const result = await createLedgerTransaction(client, {
      businessId,
      userId,
      date: nextDue,
      merchant: tmpl.merchant,
      totalAmount: tmpl.amount,
      type: tmpl.type,
      notes: tmpl.notes,
      accountId: tmpl.account_id,
      fundingCoaId: tmpl.funding_coa_id,
      allocations: [
        { accountId: tmpl.category_account_id, amount: Number(tmpl.amount), memo: null },
      ],
      recurringId: tmpl.id,
    });
    if (result.error) throw new Error(result.error);

    created.push(result.transaction);
    lastGenerated = nextDue;
    nextDue = computeNextDue(nextDue, tmpl.frequency, tmpl.start_date);
  }

  // Nothing left to ever generate → retire the template.
  if (tmpl.end_date && nextDue > tmpl.end_date) isActive = false;

  await client.query(
    `UPDATE recurring_transactions
       SET last_generated = $1, next_due = $2, is_active = $3
     WHERE id = $4 AND business_id = $5`,
    [lastGenerated, nextDue, isActive, tmpl.id, businessId],
  );

  return created;
}

// ── GET /api/recurring ───────────────────────────────────────
// List all templates. `?due=true` returns only active ones with an occurrence
// ready to generate (next_due <= today).
router.get("/", async (req, res) => {
  const { businessId } = req.user;
  const { due } = req.query;

  try {
    let where = "WHERE r.business_id = $1";
    if (due === "true") {
      where += ` AND r.is_active = TRUE AND r.next_due <= CURRENT_DATE
                 AND (r.end_date IS NULL OR r.next_due <= r.end_date)`;
    }
    const result = await pool.query(
      `${TEMPLATE_SELECT} ${where}
       ORDER BY r.is_active DESC, r.next_due ASC`,
      [businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get recurring error:", err);
    return res.status(500).json({ error: "Failed to fetch recurring transactions" });
  }
});

// ── GET /api/recurring/:id ───────────────────────────────────
router.get("/:id", async (req, res) => {
  const { businessId } = req.user;
  try {
    const tmpl = await loadTemplate(pool, businessId, req.params.id);
    if (!tmpl) return res.status(404).json({ error: "Recurring transaction not found" });
    return res.json(tmpl);
  } catch (err) {
    console.error("Get recurring error:", err);
    return res.status(500).json({ error: "Failed to fetch recurring transaction" });
  }
});

// ── GET /api/recurring/:id/transactions ──────────────────────
// The transactions this template has generated (most recent first).
router.get("/:id/transactions", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  try {
    const exists = await pool.query(
      "SELECT id FROM recurring_transactions WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (exists.rows.length === 0)
      return res.status(404).json({ error: "Recurring transaction not found" });

    const result = await pool.query(
      `SELECT t.id, t.date, t.merchant, t.total_amount, t.type, t.notes, t.created_at
       FROM transactions t
       WHERE t.recurring_id = $1 AND t.business_id = $2
       ORDER BY t.date DESC, t.created_at DESC`,
      [id, businessId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Get recurring transactions error:", err);
    return res.status(500).json({ error: "Failed to fetch generated transactions" });
  }
});

// ── POST /api/recurring ──────────────────────────────────────
// Create a template. The first occurrence is start_date (next_due = start_date);
// nothing is generated here — call generate to materialize due occurrences.
router.post("/", async (req, res) => {
  const { businessId, userId } = req.user;

  const parsed = readTemplateInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const input = parsed.input;

  try {
    const acctCheck = await validateTemplateAccounts(pool, businessId, input);
    if (acctCheck.error) return res.status(400).json({ error: acctCheck.error });

    const inserted = await pool.query(
      `INSERT INTO recurring_transactions
         (business_id, account_id, funding_coa_id, category_account_id, type,
          merchant, amount, frequency, start_date, end_date, next_due,
          is_active, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $11, $12, $13)
       RETURNING id`,
      [
        businessId,
        input.accountId,
        input.fundingCoaId,
        input.categoryId,
        input.type,
        input.merchant,
        input.amount,
        input.frequency,
        input.startDate,
        input.endDate,
        input.isActive,
        input.notes,
        userId,
      ],
    );

    const tmpl = await loadTemplate(pool, businessId, inserted.rows[0].id);
    return res.status(201).json(tmpl);
  } catch (err) {
    console.error("Create recurring error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to create recurring transaction" });
  }
});

// ── PUT /api/recurring/:id ───────────────────────────────────
// Edit a template. next_due is recomputed from the new frequency/start_date:
// off last_generated if any occurrences have run, else off start_date.
router.put("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  const parsed = readTemplateInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const input = parsed.input;

  try {
    const existing = await loadTemplate(pool, businessId, id);
    if (!existing)
      return res.status(404).json({ error: "Recurring transaction not found" });

    const acctCheck = await validateTemplateAccounts(pool, businessId, input);
    if (acctCheck.error) return res.status(400).json({ error: acctCheck.error });

    const nextDue = existing.last_generated
      ? computeNextDue(existing.last_generated, input.frequency, input.startDate)
      : input.startDate;

    await pool.query(
      `UPDATE recurring_transactions SET
         account_id = $1, funding_coa_id = $2, category_account_id = $3,
         type = $4, merchant = $5, amount = $6, frequency = $7,
         start_date = $8, end_date = $9, next_due = $10, is_active = $11,
         notes = $12
       WHERE id = $13 AND business_id = $14`,
      [
        input.accountId,
        input.fundingCoaId,
        input.categoryId,
        input.type,
        input.merchant,
        input.amount,
        input.frequency,
        input.startDate,
        input.endDate,
        nextDue,
        input.isActive,
        input.notes,
        id,
        businessId,
      ],
    );

    const tmpl = await loadTemplate(pool, businessId, id);
    return res.json(tmpl);
  } catch (err) {
    console.error("Update recurring error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to update recurring transaction" });
  }
});

// ── PATCH /api/recurring/:id/active ──────────────────────────
// Pause / resume — flips is_active without re-validating the whole template.
router.patch("/:id/active", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;
  const isActive = !!req.body.isActive;

  try {
    const result = await pool.query(
      `UPDATE recurring_transactions SET is_active = $1
       WHERE id = $2 AND business_id = $3 RETURNING id`,
      [isActive, id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Recurring transaction not found" });

    const tmpl = await loadTemplate(pool, businessId, id);
    return res.json(tmpl);
  } catch (err) {
    console.error("Toggle recurring error:", err);
    return res.status(500).json({ error: "Failed to update recurring transaction" });
  }
});

// ── POST /api/recurring/:id/skip ─────────────────────────────
// Skip the next occurrence: advance next_due one period WITHOUT generating.
router.post("/:id/skip", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const tmpl = await loadTemplate(pool, businessId, id);
    if (!tmpl)
      return res.status(404).json({ error: "Recurring transaction not found" });

    let nextDue = computeNextDue(tmpl.next_due, tmpl.frequency, tmpl.start_date);
    let isActive = tmpl.is_active;
    if (tmpl.end_date && nextDue > tmpl.end_date) isActive = false;

    await pool.query(
      `UPDATE recurring_transactions SET next_due = $1, is_active = $2
       WHERE id = $3 AND business_id = $4`,
      [nextDue, isActive, id, businessId],
    );
    const updated = await loadTemplate(pool, businessId, id);
    return res.json(updated);
  } catch (err) {
    console.error("Skip recurring error:", err);
    return res.status(500).json({ error: "Failed to skip occurrence" });
  }
});

// ── POST /api/recurring/:id/generate ─────────────────────────
// Materialize all due occurrences of ONE template (works even if paused).
router.post("/:id/generate", async (req, res) => {
  const { businessId, userId } = req.user;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tmpl = await loadTemplate(client, businessId, id);
    if (!tmpl) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Recurring transaction not found" });
    }

    const created = await generateDue(
      client,
      businessId,
      userId,
      tmpl,
      todayYmd(),
      false,
    );

    await client.query("COMMIT");
    const updated = await loadTemplate(pool, businessId, id);
    return res.json({ generated: created, generated_count: created.length, recurring: updated });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Generate recurring error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to generate transactions" });
  } finally {
    client.release();
  }
});

// ── POST /api/recurring/generate-due ─────────────────────────
// Sweep every active template with due occurrences and materialize them. This
// is the "generate pending" endpoint the frontend triggers (and a cron later).
router.post("/generate-due", async (req, res) => {
  const { businessId, userId } = req.user;
  const today = todayYmd();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dueTemplates = await client.query(
      `${TEMPLATE_SELECT}
       WHERE r.business_id = $1 AND r.is_active = TRUE
         AND r.next_due <= $2::date
         AND (r.end_date IS NULL OR r.next_due <= r.end_date)
       ORDER BY r.next_due ASC`,
      [businessId, today],
    );

    let totalGenerated = 0;
    const perTemplate = [];
    for (const tmpl of dueTemplates.rows) {
      const created = await generateDue(client, businessId, userId, tmpl, today, true);
      totalGenerated += created.length;
      perTemplate.push({ id: tmpl.id, generated_count: created.length });
    }

    await client.query("COMMIT");
    return res.json({
      generated_count: totalGenerated,
      templates_run: perTemplate.length,
      templates: perTemplate,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Generate-due recurring error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to generate due transactions" });
  } finally {
    client.release();
  }
});

// ── DELETE /api/recurring/:id ────────────────────────────────
// Delete the template. Generated transactions are kept (recurring_id is set
// NULL via FK) so posted ledger history is never destroyed.
router.delete("/:id", async (req, res) => {
  const { businessId } = req.user;
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM recurring_transactions WHERE id = $1 AND business_id = $2 RETURNING id",
      [id, businessId],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Recurring transaction not found" });
    return res.json({ message: "Recurring transaction deleted" });
  } catch (err) {
    console.error("Delete recurring error:", err);
    return res.status(500).json({ error: "Failed to delete recurring transaction" });
  }
});

export default router;
