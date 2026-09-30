// Android hardware / gesture Back (ROADMAP-V6 3.2). @capacitor/app swallows
// the press once any listener exists, so App.jsx registers handleBackButton
// through native/appLifecycle.js and this decides everything:
//   1. an open sheet / dialog (role="dialog" aria-modal) closes — the same
//      Escape key the Modal already listens for; the LockScreen is a dialog
//      too and simply ignores it, so Back can never bypass the lock;
//   2. a tab root or the login screen → the app minimises;
//   3. a nested screen → one step back in history, or — with no history to
//      go back to (cold start straight into a nested route) — its section
//      root through the router.
// The plugin's `canGoBack` is ignored on purpose: the Android WebView reports
// false for the SPA's pushState entries (seen on the emulator with a history
// length of 4), so the decision is made from the route and history.length.
// Pure apart from the injected `doc` / `win` / `minimize` / `navigate`
// (unit-tested).
import { minimize as minimizeApp } from "../native/appLifecycle.js";

/** Screens where Back means "leave the app", not "go back". */
export const ROOT_PATHS = new Set([
  "/",
  "/scan",
  "/receipts",
  "/assistant",
  "/settings",
  "/login",
  "/update-required",
]);

/** "/receipts/abc/review" → "/receipts" */
export const sectionRoot = (path) => "/" + (path.split("/")[1] || "scan");

/**
 * handleBackButton(deps?) → "dialog" | "minimize" | "back" | "root" | "none"
 * (the plugin's { canGoBack } event is deliberately not consulted — see above)
 */
export function handleBackButton({
  doc = typeof document === "undefined" ? null : document,
  win = typeof window === "undefined" ? null : window,
  minimize = minimizeApp,
  navigate = null,
} = {}) {
  if (!doc || !win) return "none";
  if (doc.querySelector('[role="dialog"][aria-modal="true"]')) {
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    return "dialog";
  }
  const path = String(win.location?.pathname || "/").replace(/\/+$/, "") || "/";
  if (ROOT_PATHS.has(path)) {
    minimize();
    return "minimize";
  }
  if ((win.history?.length || 0) > 1) {
    win.history.back();
    return "back";
  }
  if (typeof navigate === "function") {
    navigate(sectionRoot(path), { replace: true });
    return "root";
  }
  minimize();
  return "minimize";
}

export default handleBackButton;
