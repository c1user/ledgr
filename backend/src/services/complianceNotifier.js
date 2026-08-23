/**
 * services/complianceNotifier.js — the compliance-calendar bell feed
 * (deferred from ROADMAP-V5 Phase 5 until cron infrastructure existed).
 *
 * A small in-process scheduler: on boot and twice a day it (1) refreshes
 * this year's + last year's obligations for businesses that actually use
 * payroll (have an employer profile) or invoice with IVU, then (2) alerts
 * owners/admins about obligations that are DUE SOON (within DUE_SOON_DAYS)
 * or LATE. Each obligation notifies at most once per state — the
 * notified_upcoming_at / notified_late_at columns are the dedup, so a
 * twice-daily sweep never stacks duplicate bell rows.
 *
 * Everything is best-effort: a sweep failure logs and the next tick tries
 * again. No external cron dependency; plain setInterval, unref'd so it
 * never keeps a test process alive.
 */

import pool from "../config/db.js";
import { notify } from "./notifications.js";
import { todayPR, toIso } from "./prDates.js";
import { resolveRules } from "./payrollRules.js";
import {
  generateSchedule,
  generateIvuSchedule,
} from "./complianceSchedule.js";

const DUE_SOON_DAYS = 7;
// Late alerts only for obligations that became due recently. Anything older
// is historical backfill (e.g. a business's first sweep generating two
// years of calendar) — it stays visible in the calendar UI but must not
// flood the bell; it is marked notified silently instead.
const LATE_ALERT_DAYS = 45;
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000; // twice a day

// Spanish labels for bell rows (the app is Spanish-first; the backend has
// no i18n layer — these mirror the frontend's obligation-type labels).
const TYPE_LABELS = {
  hacienda_deposit: "Depósito de retención (Hacienda)",
  hacienda_withholding_reconciliation: "Reconciliación trimestral (Hacienda)",
  dtrh_unemployment_sinot: "Informe trimestral de salarios (DTRH)",
  federal_employment_return: "Planilla federal patronal",
  w2pr_annual: "Radicación anual W-2PR",
  cfse_declaration: "Declaración anual CFSE",
  bonus_payment: "Pago del Bono de Navidad",
  ivu_monthly: "Planilla mensual de IVU (SC 2915)",
};

const LINK_BY_TYPE = (type) =>
  type === "ivu_monthly" ? "/reports/ivu" : "/payroll/compliance";

const label = (type) => TYPE_LABELS[type] || type;

const fmtEs = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-PR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// One batched upsert per business-year, skipping no-op updates so
// unchanged rows don't churn dead tuples twice a day.
const upsertObligations = (businessId, obligations) => {
  if (obligations.length === 0) return Promise.resolve();
  return pool.query(
    `INSERT INTO compliance_obligations
       (business_id, obligation_type, period_start, period_end, due_date, rule_id)
     SELECT $1, t.obligation_type, t.period_start::date, t.period_end::date,
            t.due_date::date, t.rule_id::uuid
     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       AS t(obligation_type, period_start, period_end, due_date, rule_id)
     ON CONFLICT (business_id, obligation_type, period_start)
     DO UPDATE SET period_end = EXCLUDED.period_end,
                   due_date = EXCLUDED.due_date,
                   rule_id = EXCLUDED.rule_id
     WHERE (compliance_obligations.period_end, compliance_obligations.due_date,
            compliance_obligations.rule_id)
           IS DISTINCT FROM
           (EXCLUDED.period_end, EXCLUDED.due_date, EXCLUDED.rule_id)`,
    [
      businessId,
      obligations.map((o) => o.obligation_type),
      obligations.map((o) => o.period_start),
      obligations.map((o) => o.period_end),
      obligations.map((o) => o.due_date),
      obligations.map((o) => o.rule_id),
    ],
  );
};

/**
 * Refresh obligations so the sweep doesn't depend on someone having opened
 * the calendar screens. Payroll obligations only for businesses that
 * onboarded payroll (employer profile exists); IVU only for businesses
 * with IVU invoices. Current + previous year: December-period due dates
 * land in January of the following year. Deadlines are real regardless of
 * sandbox/production payroll mode, so mode is deliberately not a filter —
 * the created-after-due grace in classifyObligation keeps backfill quiet.
 */
async function refreshObligations(years) {
  const payrollBusinesses = await pool.query(
    "SELECT business_id FROM payroll_employer_profiles",
  );
  for (const { business_id } of payrollBusinesses.rows) {
    for (const year of years) {
      const resolved = await resolveRules(pool, business_id, `${year}-06-30`);
      await upsertObligations(business_id, generateSchedule(resolved, year));
    }
  }

  const ivuBusinesses = await pool.query(
    `SELECT DISTINCT business_id FROM invoices
     WHERE tax_type = 'ivu' AND status IN ('sent', 'paid', 'overdue')`,
  );
  for (const { business_id } of ivuBusinesses.rows) {
    for (const year of years) {
      await upsertObligations(business_id, generateIvuSchedule(year));
    }
  }
}

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Classify one obligation row for the sweep. Exported for tests.
 * Returns "late" (alert), "upcoming" (alert), "stale" (mark silently —
 * historical backfill), or null (nothing to do).
 *
 * Backfill grace: an obligation whose ROW was created after its own due
 * date was never being watched when it went late — it exists only because
 * a sweep or calendar view backfilled history. Those are marked silently:
 * a fresh deploy must not blast "vencida" alerts for filings the business
 * made outside the app before this feature existed.
 */
export function classifyObligation(row, today) {
  if (row.status === "done") return null;
  const due = toIso(row.due_date);
  if (due < today && !row.notified_late_at) {
    if (row.created_at && toIso(row.created_at) > due) return "stale";
    return due >= addDays(today, -LATE_ALERT_DAYS) ? "late" : "stale";
  }
  if (due >= today && !row.notified_upcoming_at) {
    if (due <= addDays(today, DUE_SOON_DAYS)) return "upcoming";
  }
  return null;
}

/** Bell/email copy for one obligation + state. Exported for tests. */
export function obligationMessage(row, state) {
  const due = toIso(row.due_date);
  const name = label(row.obligation_type);
  if (state === "late") {
    return {
      type: "obligation_late",
      title: `Obligación vencida: ${name}`,
      body: `Venció el ${fmtEs(due)} y no está marcada como radicada.`,
    };
  }
  return {
    type: "obligation_due_soon",
    title: `Próximo vencimiento: ${name}`,
    body: `Vence el ${fmtEs(due)}.`,
  };
}

/**
 * One full sweep. Returns counts (for logging/tests).
 */
export async function runComplianceSweep(today = todayPR()) {
  const year = Number(today.slice(0, 4));
  await refreshObligations([year - 1, year]);

  // Match each due side against ITS OWN marker — a plain OR would re-fetch
  // every late-handled row forever (their notified_upcoming_at stays NULL).
  const pending = await pool.query(
    `SELECT * FROM compliance_obligations
     WHERE status <> 'done'
       AND ((due_date >= $1::date AND due_date <= ($1::date + $2::int)
             AND notified_upcoming_at IS NULL)
         OR (due_date < $1::date AND notified_late_at IS NULL))`,
    [today, DUE_SOON_DAYS],
  );

  let notified = 0;
  for (const row of pending.rows) {
    const state = classifyObligation(row, today);
    if (!state) continue;

    // Claim the row BEFORE notifying: the conditional UPDATE is the lock,
    // so two server instances (rolling deploy, PM2 cluster) can't both
    // alert the same obligation. Late/stale also stamp the upcoming
    // marker so the row drops out of the pending scan for good.
    const column =
      state === "upcoming" ? "notified_upcoming_at" : "notified_late_at";
    const extra =
      state === "upcoming" ? "" : ", notified_upcoming_at = COALESCE(notified_upcoming_at, NOW())";
    const claim = await pool.query(
      `UPDATE compliance_obligations
       SET ${column} = NOW()${extra}
       WHERE id = $1 AND ${column} IS NULL
       RETURNING id`,
      [row.id],
    );
    if (claim.rowCount === 0) continue; // another instance got here first

    if (state === "stale") continue; // backfill: marked, no bell row

    const msg = obligationMessage(row, state);
    await notify({
      businessId: row.business_id,
      type: msg.type,
      category: "compliance",
      title: msg.title,
      body: msg.body,
      link: LINK_BY_TYPE(row.obligation_type),
      roles: ["owner", "admin"],
      email: {
        subject: msg.title,
        text: `${msg.body}\n\nRevisa el calendario de cumplimiento en la aplicación.`,
      },
    });
    notified += 1;
  }

  return { scanned: pending.rows.length, notified };
}

/**
 * Start the in-process scheduler: one sweep shortly after boot (delayed so
 * startup isn't slowed), then every SWEEP_INTERVAL_MS. Timers are unref'd —
 * they never keep the process alive on their own.
 */
export function startComplianceNotifier() {
  const run = () =>
    runComplianceSweep()
      .then(({ notified }) => {
        if (notified > 0) {
          console.log(`complianceNotifier: ${notified} notification(s) sent`);
        }
      })
      .catch((err) => console.error("complianceNotifier error:", err.message));

  const boot = setTimeout(run, 15_000);
  boot.unref?.();
  const interval = setInterval(run, SWEEP_INTERVAL_MS);
  interval.unref?.();
  return {
    stop: () => {
      clearTimeout(boot);
      clearInterval(interval);
    },
  };
}
