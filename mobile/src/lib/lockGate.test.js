import { describe, it, expect, beforeEach } from "vitest";
import {
  MINUTE_MS,
  markBackgrounded,
  markUnlocked,
  shouldLock,
  getLockState,
  resetLockState,
} from "./lockGate.js";

const T0 = Date.UTC(2026, 8, 26, 14, 0, 0); // any fixed instant
const on = (lockAfterMinutes = 5) => ({ enabled: true, lockAfterMinutes });

describe("lockGate", () => {
  beforeEach(() => resetLockState());

  it("never locks while the setting is off", () => {
    expect(shouldLock(T0, { enabled: false, lockAfterMinutes: 5 })).toBe(false);
    markBackgrounded(T0);
    expect(
      shouldLock(T0 + 60 * MINUTE_MS, { enabled: false, lockAfterMinutes: 0 }),
    ).toBe(false);
    expect(shouldLock(T0)).toBe(false); // no settings at all
  });

  it("locks on a cold start until the first unlock", () => {
    expect(getLockState()).toEqual({
      backgroundedAt: null,
      unlockedOnce: false,
    });
    expect(shouldLock(T0, on())).toBe(true);
    markUnlocked();
    expect(shouldLock(T0, on())).toBe(false);
  });

  it("does not lock while the app never left the foreground", () => {
    markUnlocked();
    expect(shouldLock(T0 + 24 * 60 * MINUTE_MS, on(1))).toBe(false);
  });

  it("locks once the background time reaches lockAfterMinutes", () => {
    markUnlocked();
    markBackgrounded(T0);
    expect(shouldLock(T0 + 4 * MINUTE_MS + 59_000, on(5))).toBe(false);
    expect(shouldLock(T0 + 5 * MINUTE_MS, on(5))).toBe(true);
    expect(shouldLock(T0 + 40 * MINUTE_MS, on(15))).toBe(true);
    expect(shouldLock(T0 + 14 * MINUTE_MS, on(15))).toBe(false);
  });

  it("treats 0 (or garbage) minutes as 'lock on every return'", () => {
    markUnlocked();
    markBackgrounded(T0);
    expect(shouldLock(T0, on(0))).toBe(true);
    expect(shouldLock(T0 + 1, on("abc"))).toBe(true);
    expect(shouldLock(T0 + 1, on(-3))).toBe(true);
  });

  it("a later background stamp replaces the earlier one", () => {
    markUnlocked();
    markBackgrounded(T0);
    markBackgrounded(T0 + 10 * MINUTE_MS); // came back and left again
    expect(shouldLock(T0 + 12 * MINUTE_MS, on(5))).toBe(false);
    expect(shouldLock(T0 + 15 * MINUTE_MS, on(5))).toBe(true);
  });

  it("an unlock clears the background stamp", () => {
    markUnlocked();
    markBackgrounded(T0);
    expect(shouldLock(T0 + 10 * MINUTE_MS, on(5))).toBe(true);
    markUnlocked();
    expect(getLockState().backgroundedAt).toBeNull();
    expect(shouldLock(T0 + 10 * MINUTE_MS, on(5))).toBe(false);
  });

  it("resetLockState returns to the cold-start state", () => {
    markUnlocked();
    markBackgrounded(T0);
    resetLockState();
    expect(getLockState()).toEqual({
      backgroundedAt: null,
      unlockedOnce: false,
    });
    expect(shouldLock(T0, on())).toBe(true);
  });
});
