// Local (on-device) reminders — ROADMAP-V6 2.12.
//   Device: @capacitor/local-notifications.
//   Web:    no-op; requestPermission() resolves false so callers skip.
import { isNative } from "./platform.js";

export const isSupported = () => isNative();

// Resolve with a wrapper, never with the plugin proxy itself: "await" would
// otherwise call LocalNotifications.then() natively (see secureStorage.js).
async function plugin() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return { ln: LocalNotifications };
}

/** → true when notifications may be shown. */
export async function requestPermission() {
  if (!isNative()) return false;
  try {
    const { ln } = await plugin();
    const { display } = await ln.requestPermissions();
    return display === "granted";
  } catch {
    return false;
  }
}

/**
 * schedule([{ id: number, title, body, at: Date }]) → true when scheduled.
 * Ids are stable integers so a reschedule replaces the previous reminder.
 */
export async function schedule(items) {
  if (!isNative() || !items?.length) return false;
  try {
    const { ln } = await plugin();
    await ln.schedule({
      notifications: items.map(({ id, title, body, at }) => ({
        id,
        title,
        body,
        schedule: { at, allowWhileIdle: true },
        // Android: inexact on purpose — 09:00 / 18:00 reminders need no clock
        // precision, and the default (exact) makes the plugin open the system
        // "Alarms & reminders" screen on every schedule() until granted.
        isExactNotification: false,
        smallIcon: "ic_stat_abaco",
      })),
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelAll() {
  if (!isNative()) return;
  try {
    const { ln } = await plugin();
    const { notifications } = await ln.getPending();
    if (notifications?.length) {
      await ln.cancel({
        notifications: notifications.map(({ id }) => ({ id })),
      });
    }
  } catch {
    /* ignore */
  }
}
