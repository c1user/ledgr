import axios from "axios";

// Axios instance for the phone. Dev: "/api" (Vite proxies it to the local
// backend). Production: VITE_API_URL, an absolute URL (vite.config enforces
// it — a WebView origin cannot resolve a relative path against the server).
//
// The JWT lives ONLY in this module's memory. It is never written to
// localStorage or a persisted store here; secure persistence is
// lib/secureStore.js (Keychain / KeyStore on device) and authStore feeds the
// token in through setAuthToken().
let authToken = null;
let onSessionExpired = null;

export const setAuthToken = (token) => {
  authToken = token || null;
};
export const getAuthToken = () => authToken;

/**
 * authStore registers the handler that runs when an AUTHENTICATED request
 * gets a 401 (token expired or token_version bumped by "sign out everywhere").
 * No window.location redirects live here — the store flips to "expired" and
 * App.jsx navigates.
 */
export const registerSessionExpiredHandler = (fn) => {
  onSessionExpired = typeof fn === "function" ? fn : null;
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 30000,
});

// Attach the Bearer token to every request automatically.
api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

// A 401 only means "session is dead" when the request carried a token. A
// failed login POST is also a 401 and must stay on the page to show its error.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const sentToken = !!error.config?.headers?.Authorization;
    if (error.response?.status === 401 && sentToken && onSessionExpired) {
      onSessionExpired(error);
    }
    return Promise.reject(error);
  },
);

export default api;
