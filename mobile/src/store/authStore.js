import { create } from "zustand";
import api, {
  setAuthToken,
  getAuthToken,
  registerSessionExpiredHandler,
} from "../lib/api.js";
import { isNetworkError } from "../lib/apiErrors.js";
import { isExpired, expiresWithin } from "../lib/jwt.js";
import { getToken, setToken, clearToken } from "../lib/secureStore.js";
import { queryClient } from "../lib/queryClient.js";
import { setAppLanguage } from "../i18n.js";

// Session store — NOT persisted. The token lives in lib/api.js memory while
// the app runs and in the Keychain / KeyStore (lib/secureStore.js) between
// launches; user/business are re-fetched from GET /auth/me on every start.
//
// status:
//   "booting"          hydrate() has not finished
//   "anon"             no token → Login
//   "authed"           token accepted (or unverifiable offline → stale: true)
//   "expired"          token dead (exp passed, 401, signed out everywhere)
//   "update-required"  GET /api/meta.minMobileBuild > this build
const RESUME_WARN_SECONDS = 24 * 60 * 60; // prompt re-login 24 h before exp

const APP_BUILD = Number(import.meta.env.VITE_BUILD) || 0;

const anon = {
  user: null,
  business: null,
  stale: false,
  expiresSoon: false,
};

let hydrating = null;

const useAuthStore = create((set, get) => ({
  user: null,
  business: null,
  status: "booting",
  expiredReason: null, // "expired" | "signed-out-everywhere" | "manual"
  stale: false, // authed but /auth/me could not be verified (offline)
  expiresSoon: false, // token expires within 24 h → banner suggesting re-login
  updateRequired: false,
  build: APP_BUILD,

  /**
   * Boot sequence. Idempotent while in flight (StrictMode double-mounts).
   *   1. Meta gate — GET /api/meta; minMobileBuild > VITE_BUILD → update-required.
   *      A build of 0 is an unversioned dev/web build and skips the gate.
   *   2. Token from secure storage: none → anon; expired → clear + expired.
   *   3. GET /auth/me → authed; 401 → expired; network error → authed+stale.
   */
  hydrate: () => {
    if (hydrating) return hydrating;
    hydrating = (async () => {
      set({ status: "booting" });
      try {
        const { data } = await api.get("/meta");
        const min = Number(data?.minMobileBuild) || 0;
        if (APP_BUILD > 0 && min > APP_BUILD) {
          set({ updateRequired: true, status: "update-required" });
          return;
        }
      } catch {
        /* meta unreachable: never block the app on it */
      }

      let token;
      try {
        token = await getToken();
      } catch (err) {
        // Keychain / KeyStore refused (rotated key, corrupt entry): a dead
        // boot is worse than a re-login. Best-effort wipe, land on Login.
        console.warn("[abaco] secure storage unavailable:", err?.message);
        await clearToken().catch(() => {});
        setAuthToken(null);
        set({ ...anon, status: "anon", expiredReason: null });
        return;
      }
      if (!token) {
        set({ ...anon, status: "anon", expiredReason: null });
        return;
      }
      if (isExpired(token)) {
        await clearToken().catch(() => {});
        setAuthToken(null);
        set({ ...anon, status: "expired", expiredReason: "expired" });
        return;
      }

      setAuthToken(token);
      try {
        const { data } = await api.get("/auth/me");
        if (data?.user?.language) setAppLanguage(data.user.language);
        set({
          user: data.user,
          business: data.business,
          status: "authed",
          stale: false,
          expiredReason: null,
          expiresSoon: expiresWithin(token, RESUME_WARN_SECONDS),
        });
      } catch (err) {
        if (err?.response?.status === 401) {
          // The api interceptor already called expire(); make it explicit.
          await get().expire("expired");
          return;
        }
        // Offline or server trouble: keep the token so the outbox / offline
        // banner can work; screens must tolerate user === null while stale.
        set({
          status: "authed",
          stale: true,
          expiredReason: null,
          expiresSoon: expiresWithin(token, RESUME_WARN_SECONDS),
          networkError: isNetworkError(err),
        });
      }
    })().finally(() => {
      hydrating = null;
    });
    return hydrating;
  },

  /**
   * Resume watchdog (App.jsx calls it on foreground): a token that expired
   * while the app slept flips to "expired"; one within 24 h of expiry sets
   * expiresSoon so the shell can suggest signing in again.
   */
  checkToken: () => {
    const token = getAuthToken();
    if (!token || get().status !== "authed") return;
    if (isExpired(token)) {
      get().expire("expired");
      return;
    }
    const soon = expiresWithin(token, RESUME_WARN_SECONDS);
    if (soon !== get().expiresSoon) set({ expiresSoon: soon });
  },

  /** After POST /auth/login or /auth/2fa/verify-login succeeds. */
  signIn: async ({ token, user, business }) => {
    await setToken(token);
    setAuthToken(token);
    if (user?.language) setAppLanguage(user.language);
    set({
      user,
      business,
      status: "authed",
      stale: false,
      expiredReason: null,
      expiresSoon: expiresWithin(token, RESUME_WARN_SECONDS),
    });
  },

  /** Session is dead (server said 401, or exp passed). App → /login?expired=1 */
  expire: async (reason = "expired") => {
    setAuthToken(null);
    queryClient.clear();
    set({ ...anon, status: "expired", expiredReason: reason });
    await clearToken();
  },

  /** Explicit sign-out on this device only. */
  signOut: async () => {
    setAuthToken(null);
    queryClient.clear();
    set({ ...anon, status: "anon", expiredReason: null });
    await clearToken();
  },

  /** POST /auth/logout-all bumps token_version → every device signs out. */
  signOutEverywhere: async () => {
    try {
      await api.post("/auth/logout-all");
    } finally {
      await get().signOut();
    }
  },

  /** PATCH /auth/language — optimistic; reverts (store + i18n) on failure. */
  setLanguage: async (lang) => {
    const safe = lang === "es" ? "es" : "en";
    const prev = get().user;
    const prevLang = prev?.language || "en";
    setAppLanguage(safe);
    if (prev) set({ user: { ...prev, language: safe } });
    try {
      await api.patch("/auth/language", { language: safe });
    } catch (err) {
      setAppLanguage(prevLang);
      if (prev) set({ user: { ...prev, language: prevLang } });
      throw err;
    }
  },

  // Patch helpers (mirror the web store).
  setUser: (patch) => set((s) => ({ user: { ...s.user, ...patch } })),
  setBusiness: (patch) =>
    set((s) => ({ business: { ...s.business, ...patch } })),
}));

// A 401 on an authenticated request anywhere in the app ends the session.
registerSessionExpiredHandler(() => {
  if (useAuthStore.getState().status !== "expired") {
    useAuthStore.getState().expire("expired");
  }
});

export default useAuthStore;
