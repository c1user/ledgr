// Share-sheet intake (ROADMAP-V6 2.6): images/PDFs shared from other apps
// enter the upload pipeline.
//   Android: the in-house "ShareIntake" plugin (android/app/src/main/java/
//            com/abacopr/lite/ShareIntakePlugin.java). MainActivity is the
//            share target; the plugin copies the files, pokes the window
//            event EVENT and hands them over once through consume().
//   iOS:     same contract, implemented with the share extension in 3.4.
//            Until then consume() rejects (UNIMPLEMENTED) → nothing happens.
//   Web:     no-op.
import { registerPlugin } from "@capacitor/core";
import { isNative, toWebUrl } from "./platform.js";

/** Window event the native side fires when a share has been copied. */
export const EVENT = "abacoShareReceived";

export const isSupported = () => isNative();

const ShareIntake = registerPlugin("ShareIntake", {
  web: () => ({ consume: async () => ({ items: [] }) }),
});

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** { url, name, type } → { blob, filename, previewUrl } (the camera's shape). */
async function toFile(item) {
  if (!item?.url) return null;
  const res = await fetch(toWebUrl(item.url));
  if (!res.ok) return null;
  let blob = await res.blob();
  if (!blob.type && item.type) blob = new Blob([blob], { type: item.type });
  const filename =
    item.name ||
    `shared-${stamp()}.${blob.type.includes("pdf") ? "pdf" : "jpg"}`;
  return { blob, filename, previewUrl: URL.createObjectURL(blob) };
}

/**
 * onShareEvent(cb) → unsubscribe. Fires when a share arrives, WITHOUT taking
 * the files — the Shell uses it to switch to the Scan tab, whose
 * onSharedFiles() subscription then pulls them.
 */
export function onShareEvent(cb) {
  if (!isNative() || typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/**
 * onSharedFiles(cb) → unsubscribe. cb([{ blob, filename, previewUrl }])
 * Pulls whatever is waiting (a share that launched the app, or one that
 * arrived while another screen was up), then listens for later ones.
 */
export function onSharedFiles(cb) {
  if (!isNative() || typeof window === "undefined") return () => {};
  let cancelled = false;

  const drain = async () => {
    try {
      const { items } = await ShareIntake.consume();
      if (!items?.length || cancelled) return;
      const files = (await Promise.all(items.map(toFile))).filter(Boolean);
      if (files.length && !cancelled) cb(files);
    } catch {
      /* not implemented on this platform (iOS until 3.4) */
    }
  };

  // Subscribe first so a copy finishing during the initial pull is not lost.
  const handler = () => {
    drain();
  };
  window.addEventListener(EVENT, handler);
  drain();
  return () => {
    cancelled = true;
    window.removeEventListener(EVENT, handler);
  };
}
