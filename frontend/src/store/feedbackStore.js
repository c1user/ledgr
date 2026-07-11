import { create } from "zustand";

/**
 * App-wide user feedback: toast notifications and a promise-based confirm
 * dialog (replaces window.alert / window.confirm). The plain-function
 * exports below work outside React — e.g. react-query onError callbacks.
 * <FeedbackHost /> (mounted once in App) renders the state.
 */

let nextToastId = 1;

const useFeedbackStore = create((set, get) => ({
  toasts: [],
  confirm: null,

  pushToast(tone, message) {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }));
    setTimeout(() => get().dismissToast(id), 4500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  openConfirm(options, resolve) {
    set({ confirm: { ...options, resolve } });
  },

  // Resolves the pending confirmDialog() promise and closes the dialog.
  closeConfirm(result) {
    const pending = get().confirm;
    set({ confirm: null });
    pending?.resolve(result);
  },
}));

export default useFeedbackStore;

export const toast = {
  success: (message) => useFeedbackStore.getState().pushToast("success", message),
  error: (message) => useFeedbackStore.getState().pushToast("error", message),
  info: (message) => useFeedbackStore.getState().pushToast("info", message),
};

/**
 * @param {object} options
 * @param {string} options.message   body text (already translated)
 * @param {string} [options.title]   defaults to common.confirmTitle
 * @param {string} [options.confirmLabel]  defaults to Delete when danger, else Confirm
 * @param {boolean} [options.danger] red confirm button for destructive actions
 * @returns {Promise<boolean>} true if the user confirmed
 */
export function confirmDialog(options) {
  return new Promise((resolve) =>
    useFeedbackStore.getState().openConfirm(options, resolve),
  );
}
