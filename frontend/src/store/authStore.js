import { create } from "zustand";
import { persist } from "zustand/middleware";

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      business: null,

      setAuth: (token, user, business) => set({ token, user, business }),

      logout: () => set({ token: null, user: null, business: null }),
    }),
    {
      name: "ledgr-auth", // key in localStorage
    },
  ),
);

export default useAuthStore;
