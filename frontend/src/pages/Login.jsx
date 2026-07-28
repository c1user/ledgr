import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card, Field, Input } from "../components/ui";

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [params] = useSearchParams();
  const expired = params.get("expired") === "1";

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
  // 2FA second step: set once the password checks out on a 2FA account.
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState("");

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
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        return;
      }
      setAuth(data.token, data.user, data.business);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/2fa/verify-login", {
        mfaToken,
        code: mfaCode,
      });
      setAuth(data.token, data.user, data.business);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
      // The 5-minute step token may have lapsed — send them back to step 1.
      if (err.response?.status === 400 && /expired/i.test(err.response?.data?.error || "")) {
        setMfaToken(null);
        setMfaCode("");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      {/* Theme toggle */}
      <Button
        size="sm"
        icon={theme === "dark" ? "ti-sun" : "ti-moon"}
        onClick={toggleTheme}
        className="fixed top-4 right-4 bg-surface"
      >
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </Button>

      <Card padding="lg" className="w-full max-w-[400px] fade-in">
        <div className="text-center mb-7">
          <BrandMark size={52} className="mx-auto mb-3" />
          <div className="font-display text-brand text-[22px] font-bold tracking-[4px] uppercase mb-1.5">
            {BRAND.name}
          </div>
          <div className="text-muted text-md">
            {mfaToken ? "Two-factor authentication" : "Sign in to your account"}
          </div>
        </div>

        {expired && !error && !mfaToken && (
          <div className="bg-brand-light text-brand border border-line rounded-lg px-3.5 py-2.5 text-md mb-4">
            <i className="ti ti-clock-exclamation mr-1.5" aria-hidden="true" />
            Your session expired — please sign in again.
          </div>
        )}

        {error && (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
            <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
            {error}
          </div>
        )}

        {mfaToken ? (
          <form onSubmit={handleMfaSubmit}>
            <Field
              label="Authentication code"
              htmlFor="mfaCode"
              hint="From your authenticator app, or a backup code"
              className="mb-6"
            >
              <Input
                id="mfaCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={mfaCode}
                onChange={(e) => {
                  setMfaCode(e.target.value);
                  setError("");
                }}
                required
                autoFocus
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              full
              loading={loading}
              icon="ti-shield-check"
            >
              {loading ? "Verifying..." : "Verify"}
            </Button>
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => {
                  setMfaToken(null);
                  setMfaCode("");
                  setError("");
                }}
                className="text-brand text-xs font-medium cursor-pointer"
              >
                Back to password
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
              autoFocus
            />
          </Field>

          <Field label="Password" htmlFor="password" className="mb-2">
            <Input
              id="password"
              type="password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
            />
          </Field>
          <div className="text-right mb-6">
            <Link
              to="/forgot-password"
              className="text-brand text-xs font-medium"
            >
              Forgot password?
            </Link>
          </div>

          <Button
            type="submit"
            variant="primary"
            full
            loading={loading}
            icon="ti-login"
          >
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        )}

        <div className="text-center mt-5 text-md text-muted">
          Don't have an account?{" "}
          <Link to="/register" className="text-brand font-medium">
            Create one
          </Link>
        </div>

        <div className="text-center mt-4 text-xs text-muted">
          <Link to="/terms" className="text-muted hover:text-brand mx-1.5">
            Terms
          </Link>
          ·
          <Link to="/privacy" className="text-muted hover:text-brand mx-1.5">
            Privacy
          </Link>
        </div>
      </Card>
    </div>
  );
}
