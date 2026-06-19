import { create } from "zustand";

const useInventoryStore = create((set) => ({
  reorderCount: 0,
  setReorderCount: (n) => set({ reorderCount: n }),
}));

export default useInventoryStore;
