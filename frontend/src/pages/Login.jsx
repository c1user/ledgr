import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import BRAND from "../config/brand";
import { Button, Card, Field, Input } from "../components/ui";

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
          <div className="text-brand text-[22px] font-bold tracking-[4px] uppercase mb-1.5">
            {BRAND.name}
          </div>
          <div className="text-muted text-md">Sign in to your account</div>
        </div>

        {error && (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
            <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
            {error}
          </div>
        )}

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

          <Field label="Password" htmlFor="password" className="mb-6">
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

        <div className="text-center mt-5 text-md text-muted">
          Don't have an account?{" "}
          <Link to="/register" className="text-brand font-medium">
            Create one
          </Link>
        </div>
      </Card>
    </div>
  );
}
