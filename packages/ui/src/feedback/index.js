// App-wide feedback layer: toast notifications + promise-based confirm
// dialog. The store is framework-agnostic (zustand); <FeedbackHost /> renders
// it once per app, near the root, and needs react-i18next to be initialised
// (it reads common.* keys for the default labels).
export {
  default as useFeedbackStore,
  toast,
  confirmDialog,
} from "./feedbackStore.js";
export { default as FeedbackHost } from "./FeedbackHost.jsx";
