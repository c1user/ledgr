// Hand a generated text file (the CSV export, ROADMAP-V6 2.15) to the user.
//   Device: @capacitor/filesystem writes it under exports/ in Directory.Cache
//           (the ONLY FileProvider root — res/xml/file_paths.xml exposes
//           <cache-path>; Directory.Data throws) and @capacitor/share opens
//           the system share sheet (Drive / Gmail / Save to Files / AirDrop).
//           The file is deleted again afterwards, and purgeExports() sweeps
//           the folder at boot in case the app died mid-share.
//   Web:    a Blob + hidden <a download> (frontend/src/lib/download.js).
//   Both degrade to the clipboard when sharing is impossible, so the user
//   never loses the data they just asked for.
//
// Every DOM / clipboard touch goes through an injectable `deps` object so the
// node-env vitest suite can exercise both branches.
import { isNative } from "./platform.js";

export const isSupported = () => true;

/** For components that pick share vs download copy without touching platform.js. */
export const isNativePlatform = () => isNative();

/** Cache sub-folder every export is written to (and purged from). */
export const EXPORTS_DIR = "exports";

const isCancel = (err) => /cancel/i.test(err?.message || "");

function defaultDeps() {
  return {
    doc: typeof document === "undefined" ? null : document,
    win: typeof window === "undefined" ? null : window,
    clipboard:
      typeof navigator === "undefined" ? null : navigator.clipboard || null,
  };
}

/** Last resort: the CSV lands on the clipboard. Rethrows `cause` when even that fails. */
async function copyToClipboard(text, deps, cause) {
  const clipboard = deps?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") {
    throw cause || new Error("Clipboard unavailable");
  }
  try {
    await clipboard.writeText(text);
  } catch (err) {
    throw cause || err;
  }
  return "copied";
}

async function shareOnDevice({ filename, text, title }, deps) {
  // Destructure inside: never hand a plugin proxy to `await` (its .then()
  // would be called natively — see secureStorage.js).
  let fs;
  let path;
  try {
    const { Filesystem, Directory, Encoding } =
      await import("@capacitor/filesystem");
    fs = { Filesystem, Directory };
    path = `${EXPORTS_DIR}/${filename}`;
    const { uri } = await Filesystem.writeFile({
      path,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    try {
      const { Share } = await import("@capacitor/share");
      const can = await Share.canShare().catch(() => ({ value: true }));
      if (can?.value === false) return await copyToClipboard(text, deps);
      // Both platforms REJECT a dismissed sheet ("Share canceled": iOS from
      // completionWithItemsHandler when `completed` is false, Android from
      // the chooser result), so a resolved call is a completed share — even
      // when iOS reports an empty activityType for the chosen activity.
      await Share.share({
        title: filename,
        files: [uri],
        dialogTitle: title || filename,
      });
      return "shared";
    } catch (err) {
      if (isCancel(err)) return "cancelled";
      return await copyToClipboard(text, deps, err);
    }
  } catch (err) {
    if (isCancel(err)) return "cancelled";
    // The Filesystem plugin itself failed (import or write): degrade too.
    return copyToClipboard(text, deps, err);
  } finally {
    if (fs && path) {
      await fs.Filesystem.deleteFile({
        path,
        directory: fs.Directory.Cache,
      }).catch(() => {});
    }
  }
}

async function downloadOnWeb({ filename, text, mimeType }, deps) {
  const { doc, win } = deps || {};
  let cause;
  try {
    if (doc && win?.URL?.createObjectURL) {
      const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
      const url = win.URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      win.URL.revokeObjectURL(url);
      return "downloaded";
    }
  } catch (err) {
    cause = err;
  }
  return copyToClipboard(text, deps, cause);
}

/**
 * shareTextFile({ filename, text, mimeType = "text/csv", title }, deps?)
 *   → "shared" | "downloaded" | "copied" | "cancelled"
 * `title` is the share sheet's dialog title (the file name when omitted).
 * `deps = { doc, win, clipboard }` — injectable for tests; defaults to the
 * real document / window / navigator.clipboard.
 */
export async function shareTextFile(
  { filename, text, mimeType = "text/csv", title } = {},
  deps = defaultDeps(),
) {
  const name = String(filename || "export.csv");
  const body = String(text ?? "");
  if (isNative()) {
    return shareOnDevice({ filename: name, text: body, title }, deps);
  }
  return downloadOnWeb({ filename: name, text: body, mimeType }, deps);
}

/**
 * purgeExports() → best-effort removal of exports/ in Directory.Cache on a
 * device (leftovers from a share interrupted by a kill); no-op on the web.
 * Never throws. → true when the folder was removed.
 */
export async function purgeExports() {
  if (!isNative()) return false;
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.rmdir({
      path: EXPORTS_DIR,
      directory: Directory.Cache,
      recursive: true,
    });
    return true;
  } catch {
    return false;
  }
}
