// Re-export shim (ROADMAP-V6 Phase 1.4): the feedback store (toast +
// confirmDialog) lives in @abaco/ui so both apps share one implementation.
export {
  useFeedbackStore as default,
  toast,
  confirmDialog,
} from "@abaco/ui/feedback";
