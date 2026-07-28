import { create } from "zustand";
import { persist } from "zustand/middleware";

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      business: null,

      setAuth: (token, user, business) => set({ token, user, business }),

      // Patch business fields in place (e.g. after a plan switch).
      setBusiness: (patch) =>
        set((s) => ({ business: { ...s.business, ...patch } })),

      // Patch user fields in place (e.g. after email verification).
      setUser: (patch) => set((s) => ({ user: { ...s.user, ...patch } })),

      // Swap the JWT only (e.g. after a token_version bump keeps this
      // session alive while signing out other devices).
      setToken: (token) => set({ token }),

      logout: () => set({ token: null, user: null, business: null }),
    }),
    {
      name: "ledgr-auth", // key in localStorage
    },
  ),
);

export default useAuthStore;
