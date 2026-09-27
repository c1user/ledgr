// The one place the session token is persisted.
//   Device: iOS Keychain / Android KeyStore through native/secureStorage.js
//           (@aparajita/capacitor-secure-storage, key "abaco.token").
//   Web (dev only): localStorage "abaco-mobile-token" with a one-time
//           console.warn — the browser build exists to develop the screens,
//           it is not a supported production target.
import * as storage from "../native/secureStorage.js";

const TOKEN_KEY = "token"; // → "abaco.token" on device, "abaco-mobile-token" on web

export async function getToken() {
  const value = await storage.get(TOKEN_KEY);
  return typeof value === "string" && value ? value : null;
}

export async function setToken(token) {
  if (!token) return clearToken();
  await storage.set(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.remove(TOKEN_KEY);
}
