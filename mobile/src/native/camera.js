// Receipt capture.
//   Android: @capacitor-mlkit/document-scanner (ML Kit — edge detection,
//            perspective crop, multi-page "scan a stack") when available;
//            @capacitor/camera otherwise.
//   iOS:     @capacitor/camera (takePhoto / pickImages). DECISION: no
//            VisionKit plugin in v1 — the ML Kit plugin is Android-only and
//            the maintained VisionKit wrappers are Capacitor ≤ 7. The plain
//            camera + the backend's AI extraction is good enough for launch;
//            revisit in Phase 3 if a Capacitor 8 VisionKit plugin appears.
//   Web:     a hidden <input type="file"> (capture="environment" for the
//            camera, none for the gallery, multiple for a stack); picked
//            images are re-encoded to JPEG q85 / ≤ 2000 px like the native
//            path (see normalizeWebImage).
//
// Every function resolves to capture objects { blob, filename, previewUrl }
// (previewUrl is an object URL — the caller revokes it when done), or null
// when the user cancelled.
import { isNative, isAndroid, toWebUrl } from "./platform.js";

const JPEG_QUALITY = 85;
const MAX_WIDTH = 2000;

export const isSupported = () => true;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

// What POST /receipts/upload accepts (415 otherwise).
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Web fallback only: re-encode a picked image to JPEG q85 / ≤ 2000 px long
 * edge — the same envelope the native camera produces. Shrinks 4–8 MB phone
 * photos under the 10 MB cap and turns HEIC (iPhone Safari over Wi-Fi,
 * ROADMAP-V6 2.14a) into something the API accepts. Any failure (a codec the
 * browser cannot decode) returns the original file untouched.
 */
async function normalizeWebImage(file) {
  if (!file?.type?.startsWith("image/")) return file;
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap !== "function"
  ) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > MAX_WIDTH ? MAX_WIDTH / longEdge : 1;
    const accepted = ACCEPTED.includes(file.type);
    if (accepted && scale === 1 && file.size <= 2 * 1024 * 1024) {
      bitmap.close?.();
      return file; // already small and accepted — keep the original bytes
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY / 100),
    );
    if (!blob) return file;
    // Only swap when it helps: smaller, or a type the API would reject.
    return !accepted || blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function fromFile(file) {
  const blob = await normalizeWebImage(file);
  const ext = EXT[blob.type];
  const filename =
    blob !== file || !file.name
      ? `receipt-${stamp()}.${ext || "jpg"}`
      : file.name;
  return {
    blob,
    filename,
    previewUrl: URL.createObjectURL(blob),
  };
}

async function fromNativePath(path, index = 0) {
  const url = toWebUrl(path);
  const res = await fetch(url);
  const raw = await res.blob();
  const blob = raw.type ? raw : new Blob([raw], { type: "image/jpeg" });
  return {
    blob,
    filename: `receipt-${stamp()}${index ? `-${index + 1}` : ""}.jpg`,
    previewUrl: URL.createObjectURL(blob),
  };
}

// ── Web fallback ─────────────────────────────────────────────────────────
function pickFiles({ capture = false, multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (capture) input.capture = "environment";
    if (multiple) input.multiple = true;
    input.style.display = "none";
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files)));
    // Modern browsers fire "cancel" when the picker closes without a file.
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

// ── Native ───────────────────────────────────────────────────────────────
async function documentScannerAvailable() {
  if (!isAndroid()) return false;
  try {
    const { DocumentScanner } =
      await import("@capacitor-mlkit/document-scanner");
    const { available } =
      await DocumentScanner.isGoogleDocumentScannerModuleAvailable();
    if (!available) {
      await DocumentScanner.installGoogleDocumentScannerModule();
    }
    return true;
  } catch {
    return false;
  }
}

async function scanWithDocumentScanner(pageLimit) {
  const { DocumentScanner } = await import("@capacitor-mlkit/document-scanner");
  const result = await DocumentScanner.scanDocument({
    pageLimit,
    galleryImportAllowed: true,
    resultFormats: "JPEG",
    scannerMode: "FULL",
  });
  const paths = result?.scannedImages || [];
  return Promise.all(paths.map((p, i) => fromNativePath(p, i)));
}

async function nativeTakePhoto() {
  const { Camera, CameraResultType, CameraSource } =
    await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    quality: JPEG_QUALITY,
    width: MAX_WIDTH,
    correctOrientation: true,
    saveToGallery: false,
  });
  return photo?.webPath ? [await fromNativePath(photo.webPath)] : [];
}

async function nativePickImages(limit) {
  const { Camera } = await import("@capacitor/camera");
  const { photos } = await Camera.pickImages({
    quality: JPEG_QUALITY,
    width: MAX_WIDTH,
    correctOrientation: true,
    limit,
  });
  return Promise.all(
    (photos || []).map((p, i) => fromNativePath(p.webPath, i)),
  );
}

const isCancel = (err) => /cancel/i.test(err?.message || "");

// ── Public API ───────────────────────────────────────────────────────────

/**
 * captureReceipt({ source: "camera" | "gallery" }) → capture | null
 */
export async function captureReceipt({ source = "camera" } = {}) {
  try {
    if (!isNative()) {
      const files = await pickFiles({ capture: source === "camera" });
      return files[0] ? await fromFile(files[0]) : null;
    }
    if (source === "gallery") {
      const [first] = await nativePickImages(1);
      return first || null;
    }
    if (await documentScannerAvailable()) {
      const [first] = await scanWithDocumentScanner(1);
      return first || null;
    }
    const [first] = await nativeTakePhoto();
    return first || null;
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}

/**
 * scanStack({ limit = 20 }) → capture[] — several receipts in one go.
 * Android uses the ML Kit multi-page scanner; iOS falls back to the photo
 * picker (multiple); web uses a multiple file input.
 */
export async function scanStack({ limit = 20 } = {}) {
  try {
    if (!isNative()) {
      const files = await pickFiles({ multiple: true });
      return Promise.all(files.map(fromFile));
    }
    if (await documentScannerAvailable()) {
      return scanWithDocumentScanner(limit);
    }
    return nativePickImages(limit);
  } catch (err) {
    if (isCancel(err)) return [];
    throw err;
  }
}

/** Frees the object URL of a capture once it is uploaded / discarded. */
export function releaseCapture(capture) {
  if (capture?.previewUrl) {
    try {
      URL.revokeObjectURL(capture.previewUrl);
    } catch {
      /* ignore */
    }
  }
}
