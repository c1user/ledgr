import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import useThemeStore from "../store/themeStore";
import BRAND from "../config/brand";

export default function Register() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { theme, toggleTheme } = useThemeStore();

  const [form, setForm] = useState({
    businessName: "",
    email: "",
    password: "",
    confirmPassword: "",
    taxId: "",
    currency: "USD",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      return setError("Passwords do not match");
    }

    if (form.password.length < 8) {
      return setError("Password must be at least 8 characters");
    }

    setLoading(true);

    try {
      const { data } = await api.post("/auth/register", {
        businessName: form.businessName,
        email: form.email,
        password: form.password,
        taxId: form.taxId || undefined,
        currency: form.currency,
      });

      setAuth(data.token, data.user, data.business);
      navigate("/dashboard");
    } catch (err) {
      setError(
        err.response?.data?.error || "Registration failed. Please try again.",
      );
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
        style={{ width: "100%", maxWidth: 440, padding: 32 }}
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
              textTransform: "uppercase",
            }}
          >
            {BRAND.name}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Create your business account
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

        <form onSubmit={handleSubmit}>
          {/* Business name */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="businessName">
              Business Name
            </label>
            <input
              id="businessName"
              className="input"
              type="text"
              name="businessName"
              placeholder="My Business LLC"
              value={form.businessName}
              onChange={handleChange}
              required
              autoFocus
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: 14 }}>
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
            />
          </div>

          {/* Tax ID */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="taxId">
              Tax ID / EIN
              <span
                style={{
                  color: "var(--text-muted)",
                  fontWeight: 400,
                  marginLeft: 4,
                }}
              >
                (optional)
              </span>
            </label>
            <input
              id="taxId"
              className="input"
              type="text"
              name="taxId"
              placeholder="XX-XXXXXXX"
              value={form.taxId}
              onChange={handleChange}
            />
          </div>

          {/* Currency */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="currency">
              Currency
            </label>
            <select
              id="currency"
              className="input"
              name="currency"
              value={form.currency}
              onChange={handleChange}
            >
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
            </select>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              name="password"
              placeholder="At least 8 characters"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>

          {/* Confirm password */}
          <div style={{ marginBottom: 24 }}>
            <label className="label" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              className="input"
              type="password"
              name="confirmPassword"
              placeholder="••••••••"
              value={form.confirmPassword}
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
                Creating account...
              </>
            ) : (
              <>
                <i className="ti ti-building-store" aria-hidden="true" />
                Create account
              </>
            )}
          </button>
        </form>

        {/* Login link */}
        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          Already have an account?{" "}
          <Link
            to="/login"
            style={{
              color: "var(--brand)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Sign in
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
