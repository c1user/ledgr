// Connectivity. Device: @capacitor/network. Web: navigator.onLine + events.
import { isNative } from "./platform.js";

export const isSupported = () => true;

export async function isOnline() {
  if (isNative()) {
    try {
      const { Network } = await import("@capacitor/network");
      const { connected } = await Network.getStatus();
      return !!connected;
    } catch {
      return true;
    }
  }
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * onChange(cb) → unsubscribe. cb(online: boolean) fires on every change.
 */
export function onChange(cb) {
  if (isNative()) {
    let handle = null;
    let cancelled = false;
    import("@capacitor/network")
      .then(({ Network }) =>
        Network.addListener("networkStatusChange", ({ connected }) =>
          cb(!!connected),
        ),
      )
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
  if (typeof window === "undefined") return () => {};
  const up = () => cb(true);
  const down = () => cb(false);
  window.addEventListener("online", up);
  window.addEventListener("offline", down);
  return () => {
    window.removeEventListener("online", up);
    window.removeEventListener("offline", down);
  };
}
