import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setStyle as setSystemBarsStyle } from "../native/systemBars.js";

// Persists under "abaco-mobile-theme" ({ state: { theme } }) — the same shape
// main.jsx reads before React mounts so there is no flash. Never share a
// storage key with another store (the web once clobbered its token that way).
export const THEME_STORAGE_KEY = "abaco-mobile-theme";
export const THEMES = ["light", "dark", "system"];

const media = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** "light" | "dark" | "system" → the data-theme value to apply. */
export const resolveTheme = (theme) => {
  if (theme === "dark" || theme === "light") return theme;
  return media()?.matches ? "dark" : "light";
};

const applyDom = (resolved) => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  // Native status / navigation bar icons follow the APP theme, not the OS
  // night mode (no-op on the web).
  setSystemBarsStyle(resolved);
};

let mediaUnsub = null;

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: "system",
      resolved: "light",

      setTheme: (next) => {
        const theme = THEMES.includes(next) ? next : "system";
        set({ theme });
        get().apply();
      },

      /**
       * Applies data-theme from the current choice and, when "system", follows
       * the OS setting live. Safe to call repeatedly (App.jsx on mount).
       */
      apply: () => {
        const { theme } = get();
        const resolved = resolveTheme(theme);
        applyDom(resolved);
        set({ resolved });

        mediaUnsub?.();
        mediaUnsub = null;
        if (theme === "system") {
          const mq = media();
          if (mq) {
            const onChange = (e) => {
              const r = e.matches ? "dark" : "light";
              applyDom(r);
              set({ resolved: r });
            };
            mq.addEventListener("change", onChange);
            mediaUnsub = () => mq.removeEventListener("change", onChange);
          }
        }
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);

export default useThemeStore;
