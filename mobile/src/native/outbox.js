// Outbox blob storage — the captured receipt images waiting for upload
// (ROADMAP-V6 2.11). Queue METADATA lives in localStorage via
// store/outboxStore.js; this wrapper only stores the bytes, keyed by item id.
//   Device: @capacitor/filesystem → Directory.Data/outbox/<id>.jpg (private to
//           the app, survives restarts, not backed up to the cloud on Android;
//           iOS Documents/Data are backed up — receipts are the user's own
//           data, acceptable).
//   Web:    IndexedDB "abaco-mobile-outbox" / store "blobs" (a reload does not
//           lose the capture). In-memory Map when IndexedDB is unavailable
//           (private mode quirks, tests) — best effort only.
import { isNative } from "./platform.js";

const DIR = "outbox";
const IDB_NAME = "abaco-mobile-outbox";
const IDB_STORE = "blobs";

export const isSupported = () => true;

const filePath = (id) => `${DIR}/${id}.jpg`;

// ── base64 helpers (the Filesystem plugin speaks base64 for binary data) ──
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result || "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type = "image/jpeg") {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ── Native: Filesystem ────────────────────────────────────────────────────
async function fs() {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  return { Filesystem, dir: Directory.Data };
}

async function nativeSave(id, blob) {
  const { Filesystem, dir } = await fs();
  await Filesystem.writeFile({
    path: filePath(id),
    data: await blobToBase64(blob),
    directory: dir,
    recursive: true,
  });
}

async function nativeLoad(id, type) {
  const { Filesystem, dir } = await fs();
  const { data } = await Filesystem.readFile({
    path: filePath(id),
    directory: dir,
  });
  if (data instanceof Blob)
    return data.type ? data : new Blob([data], { type });
  return base64ToBlob(String(data), type);
}

async function nativeDelete(id) {
  const { Filesystem, dir } = await fs();
  await Filesystem.deleteFile({ path: filePath(id), directory: dir });
}

async function nativeClear() {
  const { Filesystem, dir } = await fs();
  await Filesystem.rmdir({ path: DIR, directory: dir, recursive: true });
}

// ── Web: IndexedDB (tiny inline helper, no dependency) ────────────────────
const memory = new Map();
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(IDB_STORE)) {
            req.result.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function idbRequest(mode, run) {
  return openDb().then((db) => {
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const req = run(store);
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

async function webSave(id, blob) {
  const db = await openDb();
  if (!db) {
    memory.set(id, blob);
    return;
  }
  await idbRequest("readwrite", (s) => s.put(blob, id));
}

async function webLoad(id) {
  const db = await openDb();
  if (!db) return memory.get(id) || null;
  const value = await idbRequest("readonly", (s) => s.get(id));
  return value instanceof Blob ? value : null;
}

async function webDelete(id) {
  memory.delete(id);
  const db = await openDb();
  if (db) await idbRequest("readwrite", (s) => s.delete(id));
}

async function webClear() {
  memory.clear();
  const db = await openDb();
  if (db) await idbRequest("readwrite", (s) => s.clear());
}

// ── Public API ────────────────────────────────────────────────────────────

/** Persists the capture bytes under `id`. Throws when storage fails. */
export function saveBlob(id, blob) {
  return isNative() ? nativeSave(id, blob) : webSave(id, blob);
}

/** Returns the stored Blob (typed with `mimeType`) or null when missing. */
export async function loadBlob(id, mimeType = "image/jpeg") {
  try {
    return isNative() ? await nativeLoad(id, mimeType) : await webLoad(id);
  } catch {
    return null;
  }
}

/** Removes one capture; a missing file is not an error. */
export async function deleteBlob(id) {
  try {
    if (isNative()) await nativeDelete(id);
    else await webDelete(id);
  } catch {
    /* already gone */
  }
}

/** Drops every stored capture (sign-out / reset). */
export async function clearBlobs() {
  try {
    if (isNative()) await nativeClear();
    else await webClear();
  } catch {
    /* nothing to clear */
  }
}
