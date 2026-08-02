/**
 * services/notifications.js — one entry point for "something happened that
 * teammates should know about" (V3 Phase 8).
 *
 * notify() always writes in-app notification rows (the bell); the user's
 * notify_prefs only gate the EMAIL copy. A missing pref key means enabled,
 * so new categories default on. Security email (resets, verification) is
 * NOT routed through here on purpose — it must always send.
 */

import pool from "../config/db.js";
import { sendMail } from "./email.js";

// Category → what the toggle covers. Keys are stored in users.notify_prefs
// and named in unsubscribe links; keep them stable.
export const CATEGORIES = ["invoices", "team", "accounting"];

export const emailEnabled = (prefs, category) =>
  !(prefs && prefs[category] === false);

const appUrl = () => process.env.APP_URL || "http://localhost:5173";

/**
 * Fan a notification out to every active member of the business (minus the
 * acting user). In-app rows are written in one INSERT; emails go
 * fire-and-forget per recipient, honoring notify_prefs[category].
 *
 * @param {object} opts
 * @param {string} opts.businessId
 * @param {string} opts.type       event slug, e.g. "invoice_paid"
 * @param {string} opts.category   one of CATEGORIES — gates the email
 * @param {string} opts.title      in-app line, already localized to EN
 * @param {string} [opts.body]     secondary in-app line
 * @param {string} [opts.link]     in-app click-through path, e.g. "/sales/invoices"
 * @param {string} [opts.excludeUserId]  the actor — they know already
 * @param {object} [opts.email]    {subject, text} — omit to skip email
 */
export async function notify({
  businessId,
  type,
  category,
  title,
  body = null,
  link = null,
  excludeUserId = null,
  email = null,
}) {
  try {
    const recipients = await pool.query(
      `SELECT id, email, name, language, notify_prefs, unsubscribe_token
       FROM users
       WHERE business_id = $1 AND is_active AND password_hash IS NOT NULL
         AND ($2::uuid IS NULL OR id <> $2)`,
      [businessId, excludeUserId],
    );
    if (recipients.rows.length === 0) return;

    await pool.query(
      `INSERT INTO notifications (business_id, user_id, type, title, body, link)
       SELECT $1, u.id, $2, $3, $4, $5
       FROM users u
       WHERE u.business_id = $1 AND u.is_active AND u.password_hash IS NOT NULL
         AND ($6::uuid IS NULL OR u.id <> $6)`,
      [businessId, type, title, body, link, excludeUserId],
    );

    if (!email) return;
    for (const user of recipients.rows) {
      if (!emailEnabled(user.notify_prefs, category)) continue;
      const unsubscribe =
        `${appUrl()}/unsubscribe?token=${user.unsubscribe_token}` +
        `&category=${category}`;
      // Fire-and-forget — a mail hiccup must never fail the triggering request.
      sendMail({
        to: user.email,
        subject: email.subject,
        text: `${email.text}\n\n—\nUnsubscribe from these emails: ${unsubscribe}`,
        tag: type,
      }).catch(() => {});
    }
  } catch (err) {
    // Notifications are best-effort by contract.
    console.error("notify error:", err.message);
  }
}
