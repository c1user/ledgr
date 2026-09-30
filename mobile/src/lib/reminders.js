// Local reminders — ROADMAP-V6 2.12.
//
// buildReminderPlan() is a pure planner (unit-tested): it turns the bell feed
// (GET /api/notifications) and the pending-receipt count into on-device
// notifications. useReminderScheduler() (mounted by App.jsx while signed in
// and prefsStore.remindersEnabled) fetches the inputs, builds the plan and
// hands it to native/notifications.js — a no-op in the browser.
//
// Plan shape: [{ id: int32 > 0 (stable), title, body, at: Date }]
//   - one reminder per compliance notification: at 09:00 on the due date
//     when the body/link carries a future date; otherwise (unread and recent
//     only) at 09:00 the next morning — so an old, already-read alert cannot
//     nag every day;
//   - one "receipts waiting for review" reminder at 18:00 today (or tomorrow
//     once 18:00 has passed) while pendingCount > 0;
//   - honours notify_prefs.compliance === false (no deadline reminders).
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import api from "./api.js";
import {
  cancelAll,
  checkPermission,
  isSupported as notificationsSupported,
  schedule,
} from "../native/notifications.js";
import usePrefsStore from "../store/prefsStore.js";
import { onResume } from "../native/appLifecycle.js";

/** Fixed id for the pending-receipts reminder (int32 max; hashes stay below). */
export const RECEIPTS_REMINDER_ID = 2147483647;
/** iOS keeps at most 64 pending local notifications; the feed is ≤ 30 rows. */
export const MAX_REMINDERS = 30;
/** Reschedule at most this often on resume (mount always reschedules). */
export const RESCHEDULE_MIN_INTERVAL_MS = 10 * 60 * 1000;

export const DEADLINE_HOUR = 9; // 09:00 local
export const RECEIPTS_HOUR = 18; // 18:00 local
/** A dateless alert older than this is stale — skip the next-morning fallback. */
export const RECENT_DAYS = 14;

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MONTHS_EN = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * FNV-1a over the notification id → stable positive int32 (Android
 * notification ids are Java ints), never RECEIPTS_REMINDER_ID.
 */
export function stableId(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h & 0x7fffffff) % (RECEIPTS_REMINDER_ID - 1)) + 1; // 1..2147483646
}

const monthIndex = (name, table) => {
  const n = name.toLowerCase();
  const idx = table.indexOf(n);
  if (idx >= 0) return idx;
  // "sept", "Oct." — accept unambiguous prefixes of at least three letters.
  if (n.length >= 3) {
    const hits = table.filter((m) => m.startsWith(n));
    if (hits.length === 1) return table.indexOf(hits[0]);
  }
  return -1;
};

const makeDate = (year, month, day) => {
  const d = new Date(year, month, day, 0, 0, 0, 0);
  // Reject "30 de febrero" and friends: the Date rolled over.
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
};

/**
 * Finds a calendar date inside free text (a notification body or link).
 * Recognises ISO "2026-10-20", Spanish "20 de octubre de 2026" (the feed is
 * Spanish-first), English "October 20, 2026" / "20 October 2026". A missing
 * year means the reference year. Returns a local-midnight Date or null.
 */
export function extractDate(text, ref = new Date()) {
  const s = String(text ?? "");
  if (!s) return null;

  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = makeDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (d) return d;
  }

  const es = s.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?/i);
  if (es) {
    const m = monthIndex(es[2], MONTHS_ES);
    if (m >= 0) {
      const d = makeDate(
        es[3] ? Number(es[3]) : ref.getFullYear(),
        m,
        Number(es[1]),
      );
      if (d) return d;
    }
  }

  const enMdy = s.match(
    /\b([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/i,
  );
  if (enMdy) {
    const m = monthIndex(enMdy[1], MONTHS_EN);
    if (m >= 0) {
      const d = makeDate(
        enMdy[3] ? Number(enMdy[3]) : ref.getFullYear(),
        m,
        Number(enMdy[2]),
      );
      if (d) return d;
    }
  }

  const enDmy = s.match(/\b(\d{1,2})\s+([a-z]{3,})\.?(?:\s+(\d{4}))?\b/i);
  if (enDmy) {
    const m = monthIndex(enDmy[2], MONTHS_EN);
    if (m >= 0) {
      const d = makeDate(
        enDmy[3] ? Number(enDmy[3]) : ref.getFullYear(),
        m,
        Number(enDmy[1]),
      );
      if (d) return d;
    }
  }

  return null;
}

/** Same calendar day as `date`, at `hour`:00 local. */
export function atHour(date, hour) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    0,
    0,
    0,
  );
}

const addDays = (date, days) => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
};

/** The bell feed's compliance rows: category "compliance" (obligation_* types). */
export const isComplianceNotification = (n) =>
  !!n &&
  (n.type === "compliance" || /^obligation_/i.test(String(n.type || "")));

const isRecent = (createdAt, now) => {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= RECENT_DAYS * 24 * 60 * 60 * 1000;
};

export function formatReminderDate(date, lang) {
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Pure planner.
 * @param {object} input
 * @param {Array}  input.notifications  rows of GET /api/notifications
 * @param {number} input.pendingCount   receipts with status "pending"
 * @param {Date}   [input.now]
 * @param {"en"|"es"} [input.lang]
 * @param {Function} input.t            i18next t
 * @param {object} [input.prefs]        GET /api/notifications/prefs → prefs
 * @returns {Array<{ id: number, title: string, body: string, at: Date }>}
 */
export function buildReminderPlan({
  notifications = [],
  pendingCount = 0,
  now = new Date(),
  lang = "en",
  t,
  prefs = null,
} = {}) {
  if (typeof t !== "function") throw new TypeError("buildReminderPlan: t()");
  const plan = [];

  const pending = Number(pendingCount) || 0;
  if (pending > 0) {
    let at = atHour(now, RECEIPTS_HOUR);
    if (at.getTime() <= now.getTime())
      at = atHour(addDays(now, 1), RECEIPTS_HOUR);
    plan.push({
      id: RECEIPTS_REMINDER_ID,
      title: t("mobile.receipts.title"),
      body: t("mobile.reminders.receiptsToReview", { count: pending }),
      at,
    });
  }

  const complianceOn = !(prefs && prefs.compliance === false);
  if (complianceOn && Array.isArray(notifications)) {
    const seen = new Set();
    for (const n of notifications) {
      if (!isComplianceNotification(n)) continue;
      const due = extractDate(`${n.body || ""} ${n.link || ""}`, now);

      let at = null;
      if (due) {
        const onDueDay = atHour(due, DEADLINE_HOUR);
        if (onDueDay.getTime() > now.getTime()) at = onDueDay;
      }
      if (!at && !n.read_at && isRecent(n.created_at, now)) {
        at = atHour(addDays(now, 1), DEADLINE_HOUR);
      }
      if (!at) continue;

      const id = stableId(n.id);
      if (seen.has(id)) continue;
      seen.add(id);

      plan.push({
        id,
        title: t("mobile.reminders.deadlineTitle"),
        body: due
          ? t("mobile.reminders.deadlineBody", {
              title: n.title,
              date: formatReminderDate(due, lang),
            })
          : String(n.title || ""),
        at,
      });
    }
  }

  plan.sort((a, b) => a.at.getTime() - b.at.getTime());
  return plan.slice(0, MAX_REMINDERS);
}

/** Fetches the planner's inputs from the API and builds the plan. */
export async function fetchReminderPlan({ t, lang, now = new Date() }) {
  const [notifications, pendingCount, prefs] = await Promise.all([
    api
      .get("/notifications")
      .then((r) =>
        Array.isArray(r.data?.notifications) ? r.data.notifications : [],
      ),
    api
      .get("/receipts", { params: { status: "pending", limit: 50 } })
      .then((r) => (Array.isArray(r.data) ? r.data.length : 0)),
    // Email prefs double as the on-device opt-out for deadlines. Best effort.
    api
      .get("/notifications/prefs")
      .then((r) => r.data?.prefs || null)
      .catch(() => null),
  ]);
  return buildReminderPlan({
    notifications,
    pendingCount,
    now,
    lang,
    t,
    prefs,
  });
}

// Module-level so the 10-minute debounce survives remounts; reset by a
// failed run so the next resume retries.
let lastScheduledAt = 0;

/**
 * Keeps the device's pending notifications equal to the current plan.
 * Runs on mount (always) and on app resume (at most every 10 minutes).
 * Unmounting — the toggle went off or the session ended — cancels them all.
 */
export function useReminderScheduler() {
  const { i18n } = useTranslation();

  useEffect(() => {
    let alive = true;

    const run = async (force) => {
      const startedAt = Date.now();
      if (!force && startedAt - lastScheduledAt < RESCHEDULE_MIN_INTERVAL_MS) {
        return;
      }
      lastScheduledAt = startedAt;
      try {
        // The OS permission is requested only by the Settings toggle (with
        // its rationale). Revoked since? Turn the toggle off so it tells the
        // truth instead of silently scheduling nothing.
        if (notificationsSupported() && !(await checkPermission())) {
          usePrefsStore.getState().setRemindersEnabled(false);
          return;
        }
        const lang = String(i18n.language || "en").startsWith("es")
          ? "es"
          : "en";
        const plan = await fetchReminderPlan({
          t: (key, opts) => i18n.t(key, opts),
          lang,
        });
        if (!alive) return;
        await cancelAll();
        if (plan.length) await schedule(plan);
        if (import.meta.env.DEV) {
          console.debug("[abaco] reminders planned:", plan);
        }
      } catch (err) {
        lastScheduledAt = 0;
        if (import.meta.env.DEV) {
          console.warn("[abaco] reminders: not scheduled —", err?.message);
        }
      }
    };

    run(true);
    const unsubscribe = onResume(() => run(false));

    return () => {
      alive = false;
      unsubscribe();
      lastScheduledAt = 0;
      cancelAll();
    };
  }, [i18n]);
}
