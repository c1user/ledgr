import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import BRAND from "../config/brand";

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("ledgr-theme");
    return stored ? JSON.parse(stored)?.state?.theme || "light" : "light";
  });

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    // Also update zustand store in localStorage directly
    localStorage.setItem(
      "ledgr-theme",
      JSON.stringify({ state: { theme: next }, version: 0 }),
    );
  };

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", form);
      setAuth(data.token, data.user, data.business);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          background: "var(--bg-primary)",
          border: "0.5px solid var(--border-color)",
          borderRadius: 8,
          padding: "8px 14px",
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <i className={`ti ${theme === "dark" ? "ti-sun" : "ti-moon"}`} />
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>

      <div
        className="card fade-in"
        style={{ width: "100%", maxWidth: 400, padding: 32 }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              color: "var(--brand)",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              marginBottom: 6,
              textTransform: "uppercase",
            }}
          >
            {BRAND.name}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Sign in to your account
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "0.5px solid var(--danger)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "10px 14px",
            }}
          >
            {loading ? (
              <>
                <i
                  className="ti ti-loader-2"
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Signing in...
              </>
            ) : (
              <>
                <i className="ti ti-login" />
                Sign in
              </>
            )}
          </button>
        </form>

        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          Don't have an account?{" "}
          <Link
            to="/register"
            style={{
              color: "var(--brand)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Create one
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
