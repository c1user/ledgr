import { describe, it, expect } from "vitest";
import {
  buildReminderPlan,
  extractDate,
  stableId,
  atHour,
  isComplianceNotification,
  RECEIPTS_REMINDER_ID,
  MAX_REMINDERS,
  DEADLINE_HOUR,
  RECEIPTS_HOUR,
} from "./reminders.js";

// A fake t(): "key" or "key{json of options}" so assertions can see the
// interpolation values without loading the real locale files.
const t = (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key);

// Saturday 26 Sep 2026, 10:00 local.
const NOW = new Date(2026, 8, 26, 10, 0, 0, 0);
const iso = (d) => new Date(d).toISOString();
const daysAgo = (n) => iso(new Date(NOW.getTime() - n * 86_400_000));

const compliance = (over = {}) => ({
  id: "6f1c0f7e-1111-4a2b-9c3d-000000000001",
  type: "obligation_due_soon",
  title: "Próximo vencimiento: Planilla mensual de IVU (SC 2915)",
  body: "Vence el 20 de octubre de 2026.",
  link: "/reports/ivu",
  read_at: null,
  created_at: daysAgo(1),
  ...over,
});

describe("extractDate", () => {
  it("reads Spanish long dates (the feed's format)", () => {
    const d = extractDate("Vence el 20 de octubre de 2026.", NOW);
    expect(d).toEqual(new Date(2026, 9, 20));
    const late = extractDate(
      "Venció el 15 de septiembre de 2026 y no está marcada como radicada.",
      NOW,
    );
    expect(late).toEqual(new Date(2026, 8, 15));
  });

  it("defaults a missing year to the reference year", () => {
    expect(extractDate("vence el 3 de enero", NOW)).toEqual(
      new Date(2026, 0, 3),
    );
  });

  it("reads ISO dates (e.g. in a link) and English dates", () => {
    expect(extractDate("/reports/ivu?due=2026-11-10", NOW)).toEqual(
      new Date(2026, 10, 10),
    );
    expect(extractDate("Due October 15, 2026", NOW)).toEqual(
      new Date(2026, 9, 15),
    );
    expect(extractDate("Due 15 October 2026", NOW)).toEqual(
      new Date(2026, 9, 15),
    );
  });

  it("returns null for text without a date or with an impossible one", () => {
    expect(
      extractDate("Revisa el calendario de cumplimiento.", NOW),
    ).toBeNull();
    expect(extractDate("30 de febrero de 2026", NOW)).toBeNull();
    expect(extractDate("", NOW)).toBeNull();
    expect(extractDate(null, NOW)).toBeNull();
  });
});

describe("stableId", () => {
  it("is deterministic, positive int32 and never the receipts id", () => {
    const a = stableId("6f1c0f7e-1111-4a2b-9c3d-000000000001");
    expect(a).toBe(stableId("6f1c0f7e-1111-4a2b-9c3d-000000000001"));
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(RECEIPTS_REMINDER_ID);
    expect(stableId("6f1c0f7e-1111-4a2b-9c3d-000000000002")).not.toBe(a);
    expect(stableId(42)).toBe(stableId("42"));
  });
});

describe("isComplianceNotification", () => {
  it("accepts category 'compliance' and the obligation_* row types", () => {
    expect(isComplianceNotification({ type: "compliance" })).toBe(true);
    expect(isComplianceNotification({ type: "obligation_due_soon" })).toBe(
      true,
    );
    expect(isComplianceNotification({ type: "obligation_late" })).toBe(true);
    expect(isComplianceNotification({ type: "invoice_paid" })).toBe(false);
    expect(isComplianceNotification(null)).toBe(false);
  });
});

describe("buildReminderPlan — receipts waiting", () => {
  it("schedules one reminder at 18:00 today while receipts are pending", () => {
    const plan = buildReminderPlan({ pendingCount: 3, now: NOW, t });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      id: RECEIPTS_REMINDER_ID,
      title: "mobile.receipts.title",
      body: 'mobile.reminders.receiptsToReview{"count":3}',
    });
    expect(plan[0].at).toEqual(atHour(NOW, RECEIPTS_HOUR));
  });

  it("moves to 18:00 tomorrow once today's slot has passed", () => {
    const evening = new Date(2026, 8, 26, 18, 0, 0, 0);
    const plan = buildReminderPlan({ pendingCount: 1, now: evening, t });
    expect(plan[0].at).toEqual(new Date(2026, 8, 27, RECEIPTS_HOUR));
  });

  it("schedules nothing without pending receipts", () => {
    expect(buildReminderPlan({ pendingCount: 0, now: NOW, t })).toEqual([]);
    expect(buildReminderPlan({ pendingCount: "x", now: NOW, t })).toEqual([]);
  });
});

describe("buildReminderPlan — compliance deadlines", () => {
  it("reminds at 09:00 on a future due date found in the body, in the user's language", () => {
    const n = compliance();
    const es = buildReminderPlan({
      notifications: [n],
      now: NOW,
      lang: "es",
      t,
    });
    expect(es).toHaveLength(1);
    expect(es[0].id).toBe(stableId(n.id));
    expect(es[0].title).toBe("mobile.reminders.deadlineTitle");
    expect(es[0].at).toEqual(new Date(2026, 9, 20, DEADLINE_HOUR));
    expect(es[0].body).toContain("mobile.reminders.deadlineBody");
    expect(es[0].body).toContain(n.title);
    expect(es[0].body).toContain("octubre");

    const en = buildReminderPlan({
      notifications: [n],
      now: NOW,
      lang: "en",
      t,
    });
    expect(en[0].body).toContain("October");
  });

  it("uses a date carried by the link when the body has none", () => {
    const n = compliance({
      body: "Revisa el calendario.",
      link: "/payroll/compliance?due=2026-12-01",
    });
    const [r] = buildReminderPlan({ notifications: [n], now: NOW, t });
    expect(r.at).toEqual(new Date(2026, 11, 1, DEADLINE_HOUR));
  });

  it("falls back to 09:00 next morning for an unread recent alert without a future date", () => {
    const late = compliance({
      id: "late-1",
      type: "obligation_late",
      title: "Obligación vencida: Declaración anual CFSE",
      body: "Venció el 15 de septiembre de 2026 y no está marcada como radicada.",
      created_at: daysAgo(2),
    });
    const dateless = compliance({
      id: "dateless-1",
      body: "Revisa el calendario de cumplimiento.",
      created_at: daysAgo(3),
    });
    const plan = buildReminderPlan({
      notifications: [late, dateless],
      now: NOW,
      t,
    });
    expect(plan).toHaveLength(2);
    for (const r of plan) {
      expect(r.at).toEqual(new Date(2026, 8, 27, DEADLINE_HOUR));
    }
    // A dateless alert carries the feed's own title as its body.
    const d = plan.find((r) => r.id === stableId("dateless-1"));
    expect(d.body).toBe(dateless.title);
  });

  it("skips read or stale alerts that have no future date", () => {
    const read = compliance({
      id: "read-1",
      body: "Venció el 1 de septiembre de 2026.",
      read_at: daysAgo(1),
    });
    const stale = compliance({
      id: "stale-1",
      body: "Sin fecha.",
      created_at: daysAgo(40),
    });
    expect(
      buildReminderPlan({ notifications: [read, stale], now: NOW, t }),
    ).toEqual([]);
  });

  it("still reminds on the due day even if the alert was read", () => {
    const n = compliance({ read_at: daysAgo(1) });
    const plan = buildReminderPlan({ notifications: [n], now: NOW, t });
    expect(plan).toHaveLength(1);
    expect(plan[0].at).toEqual(new Date(2026, 9, 20, DEADLINE_HOUR));
  });

  it("ignores non-compliance rows", () => {
    const other = compliance({ id: "inv-1", type: "invoice_paid" });
    expect(buildReminderPlan({ notifications: [other], now: NOW, t })).toEqual(
      [],
    );
  });

  it("honours notify_prefs.compliance === false (receipts reminder stays)", () => {
    const plan = buildReminderPlan({
      notifications: [compliance()],
      pendingCount: 2,
      now: NOW,
      t,
      prefs: { compliance: false, invoices: true },
    });
    expect(plan.map((r) => r.id)).toEqual([RECEIPTS_REMINDER_ID]);
  });
});

describe("buildReminderPlan — shape", () => {
  it("is sorted by time, capped, with unique ids and Date instances", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      compliance({
        id: `n-${i}`,
        body: `Vence el ${(i % 28) + 1} de noviembre de 2026.`,
      }),
    );
    const plan = buildReminderPlan({
      notifications: rows,
      pendingCount: 5,
      now: NOW,
      t,
    });
    expect(plan.length).toBe(MAX_REMINDERS);
    const ids = new Set(plan.map((r) => r.id));
    expect(ids.size).toBe(plan.length);
    for (let i = 1; i < plan.length; i += 1) {
      expect(plan[i].at.getTime()).toBeGreaterThanOrEqual(
        plan[i - 1].at.getTime(),
      );
    }
    for (const r of plan) {
      expect(r.at).toBeInstanceOf(Date);
      expect(typeof r.title).toBe("string");
      expect(typeof r.body).toBe("string");
      expect(Object.keys(r).sort()).toEqual(["at", "body", "id", "title"]);
    }
    // The receipts reminder (today 18:00) sorts first.
    expect(plan[0].id).toBe(RECEIPTS_REMINDER_ID);
  });

  it("is deterministic for the same input", () => {
    const input = {
      notifications: [compliance(), compliance({ id: "n-2" })],
      pendingCount: 1,
      now: NOW,
      t,
    };
    expect(buildReminderPlan(input)).toEqual(buildReminderPlan(input));
  });

  it("requires t()", () => {
    expect(() => buildReminderPlan({ pendingCount: 1 })).toThrow(TypeError);
  });
});
