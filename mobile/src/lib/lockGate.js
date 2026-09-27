// Biometric app lock — pure state (ROADMAP-V6 2.10).
//
// No React, no platform calls, no timers. App.jsx's LockGate feeds it the
// lifecycle events (backgrounded / resumed) and prefsStore's settings, and
// LockScreen.jsx does the actual biometric prompt. Keeping the decision here
// makes it unit-testable with plain timestamps.
//
// Rules:
//   - disabled → never lock;
//   - a cold start with the lock on locks until the first successful unlock
//     (the app may have been killed while it held an open session);
//   - after an unlock, the app locks again when it comes back after at least
//     lockAfterMinutes in the background (0 = lock on every return).

export const MINUTE_MS = 60_000;
export const LOCK_AFTER_OPTIONS = [1, 5, 15];

let backgroundedAt = null; // ms epoch of the last time the app left the foreground
let unlockedOnce = false; // false until the first successful unlock (cold start)

/** The app just left the foreground (visibilitychange hidden / native pause). */
export function markBackgrounded(now = Date.now()) {
  backgroundedAt = Number(now);
}

/** A biometric prompt succeeded (or the lock was just turned on by the user). */
export function markUnlocked() {
  unlockedOnce = true;
  backgroundedAt = null;
}

/**
 * Should the lock screen cover the app right now?
 * @param {number} now              ms epoch
 * @param {{ enabled: boolean, lockAfterMinutes: number }} settings
 */
export function shouldLock(
  now = Date.now(),
  { enabled, lockAfterMinutes } = {},
) {
  if (!enabled) return false;
  if (!unlockedOnce) return true;
  if (backgroundedAt == null) return false;
  const minutes = Math.max(0, Number(lockAfterMinutes) || 0);
  return Number(now) - backgroundedAt >= minutes * MINUTE_MS;
}

/** Snapshot for debugging/tests. */
export function getLockState() {
  return { backgroundedAt, unlockedOnce };
}

/** Back to the cold-start state (tests; sign-out could use it too). */
export function resetLockState() {
  backgroundedAt = null;
  unlockedOnce = false;
}
