import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import useThemeStore from "../store/themeStore";

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { theme, toggleTheme } = useThemeStore();

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
      {/* Theme toggle top right */}
      <button
        onClick={toggleTheme}
        aria-label="Toggle theme"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          background: "var(--bg-primary)",
          border: "0.5px solid var(--border-color)",
          borderRadius: 8,
          padding: "6px 10px",
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontSize: 14,
        }}
      >
        <i
          className={`ti ${theme === "dark" ? "ti-sun" : "ti-moon"}`}
          aria-hidden="true"
        />
      </button>

      <div
        className="card fade-in"
        style={{ width: "100%", maxWidth: 400, padding: 32 }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              color: "var(--brand)",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              marginBottom: 6,
            }}
          >
            LEDGR
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Sign in to your account
          </div>
        </div>

        {/* Error */}
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
            <i
              className="ti ti-alert-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {error}
          </div>
        )}

        {/* Form */}
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
                  aria-hidden="true"
                />
                Signing in...
              </>
            ) : (
              <>
                <i className="ti ti-login" aria-hidden="true" />
                Sign in
              </>
            )}
          </button>
        </form>

        {/* Register link */}
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
