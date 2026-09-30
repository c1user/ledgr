import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per-device preferences (never the token, never account data). Persisted
// under "abaco-mobile-prefs".
export const PREFS_STORAGE_KEY = "abaco-mobile-prefs";

const usePrefsStore = create(
  persist(
    (set) => ({
      defaultAccountId: null, // bank account preselected in "Book"
      lastType: "expense", // "expense" | "income" — last booked type
      biometricLock: false,
      lockAfterMinutes: 5,
      // Off until the user turns it on in Settings: that toggle is where the
      // OS notification permission is requested, with a rationale next to it
      // (ROADMAP-V6 2.12 — ask at the moment of use). The scheduler also flips
      // this back off if the permission is revoked later.
      remindersEnabled: false,

      setDefaultAccountId: (defaultAccountId) => set({ defaultAccountId }),
      setLastType: (lastType) =>
        set({ lastType: lastType === "income" ? "income" : "expense" }),
      setBiometricLock: (biometricLock) =>
        set({ biometricLock: !!biometricLock }),
      setLockAfterMinutes: (minutes) =>
        set({ lockAfterMinutes: Math.max(0, Number(minutes) || 0) }),
      setRemindersEnabled: (remindersEnabled) =>
        set({ remindersEnabled: !!remindersEnabled }),
    }),
    { name: PREFS_STORAGE_KEY },
  ),
);

export default usePrefsStore;
