// Share-sheet intake (ROADMAP-V6 2.6): images/PDFs shared from other apps
// enter the upload pipeline.
//   Device: the "send-intent" plugin (published for Capacitor 7; its peer
//           range accepts core 8 so the JS is installed — the native side is
//           verified in Phase 3.2/3.4, and iOS additionally needs the share
//           extension target from 3.1). // Phase 3: plugin verification
//   Web:    no-op.
import { isNative, toWebUrl } from "./platform.js";

export const isSupported = () => isNative();

async function intentToFile(intent) {
  if (!intent?.url) return null;
  const url = decodeURIComponent(intent.url);
  const res = await fetch(toWebUrl(url));
  const blob = await res.blob();
  const filename =
    intent.title ||
    `shared-${new Date().toISOString().replace(/[:.]/g, "-")}.${
      blob.type.includes("pdf") ? "pdf" : "jpg"
    }`;
  return { blob, filename, previewUrl: URL.createObjectURL(blob) };
}

/**
 * onSharedFiles(cb) → unsubscribe. cb([{ blob, filename, previewUrl }])
 * Checks for an intent that launched the app, then listens for later ones.
 */
export function onSharedFiles(cb) {
  if (!isNative() || typeof window === "undefined") return () => {};
  let cancelled = false;
  let SendIntentRef = null;

  const deliver = async () => {
    if (!SendIntentRef) return;
    try {
      const intent = await SendIntentRef.checkSendIntentReceived();
      const file = await intentToFile(intent);
      if (file && !cancelled) cb([file]);
      if (intent?.url) await SendIntentRef.finish?.();
    } catch {
      /* no pending intent */
    }
  };

  import("send-intent")
    .then(({ SendIntent }) => {
      SendIntentRef = SendIntent;
      return deliver();
    })
    .catch(() => {});
  window.addEventListener("sendIntentReceived", deliver);
  return () => {
    cancelled = true;
    window.removeEventListener("sendIntentReceived", deliver);
  };
}
