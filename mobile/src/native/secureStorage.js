// Secure key/value storage (the session token).
//   Device: @aparajita/capacitor-secure-storage → iOS Keychain / Android
//           KeyStore, key prefix "abaco.", no iCloud Keychain sync.
//   Web:    localStorage under "abaco-mobile-<key>" — DEV ONLY. Warned once.
import { isNative } from "./platform.js";

const KEY_PREFIX = "abaco.";
const WEB_PREFIX = "abaco-mobile-";

let pluginPromise = null;
async function plugin() {
  if (!pluginPromise) {
    pluginPromise = import("@aparajita/capacitor-secure-storage").then(
      async ({ SecureStorage }) => {
        await SecureStorage.setKeyPrefix(KEY_PREFIX);
        await SecureStorage.setSynchronize(false);
        return SecureStorage;
      },
    );
  }
  return pluginPromise;
}

let warned = false;
function webStorage() {
  if (!warned) {
    warned = true;
    console.warn(
      "[abaco] dev-only token storage: using localStorage on the web build. " +
        "On device the token lives in the Keychain / KeyStore.",
    );
  }
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export const isSupported = () => isNative();

export async function get(key) {
  if (isNative()) {
    const value = await (await plugin()).get(key);
    return value === undefined ? null : value;
  }
  const ls = webStorage();
  return ls ? ls.getItem(WEB_PREFIX + key) : null;
}

export async function set(key, value) {
  if (isNative()) {
    await (await plugin()).set(key, value);
    return;
  }
  const ls = webStorage();
  if (ls) ls.setItem(WEB_PREFIX + key, String(value));
}

export async function remove(key) {
  if (isNative()) {
    await (await plugin()).remove(key);
    return;
  }
  const ls = webStorage();
  if (ls) ls.removeItem(WEB_PREFIX + key);
}
