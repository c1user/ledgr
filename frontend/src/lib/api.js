import axios from "axios";

// API base (PENDIENTES §4.1 config hygiene): VITE_API_URL wins when set;
// dev falls back to the local backend; production builds default to the
// relative /api (same-origin reverse proxy — the standard deploy shape).
const baseURL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:5000/api" : "/api");

const api = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const auth = JSON.parse(localStorage.getItem("ledgr-auth") || "{}");
  const token = auth?.state?.token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401s globally — but only when an AUTHENTICATED session died
// (request carried a token). A failed login attempt is also a 401 and must
// stay on the page to show its error, not trigger a redirect loop.
// ?expired=1 lets the login page explain what happened.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const sentToken = !!error.config?.headers?.Authorization;
    if (error.response?.status === 401 && sentToken) {
      localStorage.removeItem("ledgr-auth");
      window.location.href = "/login?expired=1";
    }
    return Promise.reject(error);
  },
);

export default api;
