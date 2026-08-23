/**
 * services/complianceSchedule.js — obligation generation (ROADMAP-V5 · 5.1).
 *
 * PURE: resolved schedule-rule payloads + a calendar year in, the list of
 * compliance obligations out. Every due date comes from a rule payload —
 * nothing scheduled here is hardcoded. The route layer upserts the output
 * into compliance_obligations (idempotent; user-set statuses survive).
 *
 * Display status is also computed here so the calendar and tests agree:
 *   done (user-set) > late (due date passed) > ready (period ended,
 *   can be prepared) > upcoming.
 */

import { toIso } from "./prDates.js";

const pad2 = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

// Last day of month (m: 1-12).
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// "MM-DD" + year → ISO date.
const mmdd = (y, s) => `${y}-${s}`;

// date + N days → ISO (UTC math, no tz drift).
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const QUARTERS = [
  { q: 1, start: [1, 1], end: [3, 31] },
  { q: 2, start: [4, 1], end: [6, 30] },
  { q: 3, start: [7, 1], end: [9, 30] },
  { q: 4, start: [10, 1], end: [12, 31] },
];

/**
 * @param {object} rules - rule_type -> resolved rule row ({ id, payload })
 * @param {number} year - calendar year to generate for
 * @returns {Array<{obligation_type, period_start, period_end, due_date, rule_id}>}
 */
export function generateSchedule(rules, year) {
  const out = [];

  // ── Monthly Hacienda withholding deposits ──
  const dep = rules.hacienda_deposit_schedule;
  if (dep?.payload?.default_frequency === "monthly") {
    const dueDay = dep.payload.monthly_due_day;
    for (let m = 1; m <= 12; m++) {
      const nextY = m === 12 ? year + 1 : year;
      const nextM = m === 12 ? 1 : m + 1;
      out.push({
        obligation_type: "hacienda_deposit",
        period_start: iso(year, m, 1),
        period_end: iso(year, m, monthEnd(year, m)),
        due_date: iso(nextY, nextM, Math.min(dueDay, monthEnd(nextY, nextM))),
        rule_id: dep.id,
      });
    }
  }

  // ── Quarterly filings (Hacienda reconciliation, DTRH) ──
  const qf = rules.quarterly_filing_schedule;
  for (const filing of qf?.payload?.filings || []) {
    for (const { start, end } of QUARTERS) {
      const periodEnd = iso(year, end[0], end[1]);
      out.push({
        obligation_type: filing.key,
        period_start: iso(year, start[0], start[1]),
        period_end: periodEnd,
        due_date: addDays(periodEnd, filing.due_days_after_quarter_end),
        rule_id: qf.id,
      });
    }
  }

  // ── Federal employment return (form itself is a VERIFY item) ──
  const fed = rules.federal_employment_return;
  if (fed?.payload?.filing_frequency === "quarterly") {
    for (const { start, end } of QUARTERS) {
      const periodEnd = iso(year, end[0], end[1]);
      out.push({
        obligation_type: "federal_employment_return",
        period_start: iso(year, start[0], start[1]),
        period_end: periodEnd,
        due_date: addDays(periodEnd, fed.payload.due_days_after_quarter_end),
        rule_id: fed.id,
      });
    }
  }

  // ── W-2PR for the PRIOR tax year (window falls in `year`) ──
  const w2 = rules.w2pr_file_spec;
  if (w2?.payload?.generation_window) {
    out.push({
      obligation_type: "w2pr_annual",
      period_start: iso(year - 1, 1, 1),
      period_end: iso(year - 1, 12, 31),
      due_date: mmdd(year, w2.payload.generation_window.end),
      rule_id: w2.id,
    });
  }

  // ── CFSE annual declaration (policy year ending in `year`) ──
  const cfse = rules.cfse_declaration;
  if (cfse?.payload?.annual_due && cfse.payload.period) {
    out.push({
      obligation_type: "cfse_declaration",
      period_start: mmdd(year - 1, cfse.payload.period.start),
      period_end: mmdd(year, cfse.payload.period.end),
      due_date: mmdd(year, cfse.payload.annual_due),
      rule_id: cfse.id,
    });
  }

  // ── Christmas bonus payment window ──
  const bonus = rules.christmas_bonus;
  if (bonus?.payload?.payment_window) {
    const w = bonus.payload.payment_window;
    const acc = bonus.payload.accrual_window || {
      start: "10-01",
      end: "09-30",
    };
    out.push({
      obligation_type: "bonus_payment",
      period_start: mmdd(year - 1, acc.start),
      period_end: mmdd(year, acc.end),
      due_date: mmdd(year, w.end),
      rule_id: bonus.id,
    });
  }

  return out;
}

// SC 2915 (Planilla Mensual de IVU) is due the 20th of the following month —
// a statutory date, not a payroll rule, so unlike generateSchedule this is
// not rule-driven and rule_id is null. Filed electronically through SURI.
const IVU_DUE_DAY = 20;

/**
 * Monthly IVU (SC 2915) obligations for a calendar year.
 * @param {number} year - calendar year to generate for
 * @returns {Array<{obligation_type, period_start, period_end, due_date, rule_id}>}
 */
export function generateIvuSchedule(year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const nextY = m === 12 ? year + 1 : year;
    const nextM = m === 12 ? 1 : m + 1;
    out.push({
      obligation_type: "ivu_monthly",
      period_start: iso(year, m, 1),
      period_end: iso(year, m, monthEnd(year, m)),
      due_date: iso(
        nextY,
        nextM,
        Math.min(IVU_DUE_DAY, monthEnd(nextY, nextM)),
      ),
      rule_id: null,
    });
  }
  return out;
}

/**
 * Display status for an obligation row.
 * @param {object} row - { status, due_date, period_end }
 * @param {string} today - YYYY-MM-DD
 */
export function displayStatus(row, today) {
  if (row.status === "done") return "done";
  const due = toIso(row.due_date);
  const periodEnd = toIso(row.period_end);
  if (due < today) return "late";
  if (periodEnd <= today) return "ready";
  return "upcoming";
}
