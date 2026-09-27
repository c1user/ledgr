// App foreground/background + Android back button.
//   Device: @capacitor/app ("resume", "backButton").
//   Web:    visibilitychange → resume when the tab becomes visible; the back
//           button is the browser's own.
import { isNative } from "./platform.js";

export const isSupported = () => true;

function nativeListener(event, cb) {
  let handle = null;
  let cancelled = false;
  import("@capacitor/app")
    .then(({ App }) => App.addListener(event, cb))
    .then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    handle?.remove();
  };
}

/** onResume(cb) → unsubscribe. Fires when the app returns to the foreground. */
export function onResume(cb) {
  if (isNative()) return nativeListener("resume", () => cb());
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") cb();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

/**
 * onBackButton(cb) → unsubscribe. cb({ canGoBack }) — Android only; the
 * shell decides whether to navigate back or minimise. No-op on iOS/web.
 */
export function onBackButton(cb) {
  if (isNative()) return nativeListener("backButton", cb);
  return () => {};
}

/** Sends the app to the background (Android). No-op elsewhere. */
export async function minimize() {
  if (!isNative()) return;
  try {
    const { App } = await import("@capacitor/app");
    await App.minimizeApp();
  } catch {
    /* ignore */
  }
}
