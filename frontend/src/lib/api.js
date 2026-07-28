import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
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
