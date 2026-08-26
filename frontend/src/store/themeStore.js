import { create } from "zustand";
import { persist } from "zustand/middleware";

// Theme store — persists under "ledgr-theme" ({ state: { theme } }), the same
// shape main.jsx reads before React mounts to set data-theme without a flash.
// NOTE: this must NOT share a storage key with the auth store — it previously
// persisted under "ledgr-auth" and every theme toggle clobbered the token.
const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: "light",

      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        set({ theme: next });
      },
    }),
    {
      name: "ledgr-theme", // key in localStorage
    },
  ),
);

export default useThemeStore;
