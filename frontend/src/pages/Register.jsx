import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import i18n from "../i18n";
import useAuthStore from "../store/authStore";
import useThemeStore from "../store/themeStore";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card, Field, Input, Select } from "../components/ui";

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
        // Welcome email language
        lang: i18n.language === "es" ? "es" : "en",
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
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      {/* Theme toggle */}
      <Button
        size="sm"
        icon={theme === "dark" ? "ti-sun" : "ti-moon"}
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="fixed top-4 right-4 bg-surface"
      />

      <Card padding="lg" className="w-full max-w-[440px] fade-in">
        {/* Logo */}
        <div className="text-center mb-7">
          <BrandMark size={52} className="mx-auto mb-3" />
          <div className="font-display text-brand text-[22px] font-bold tracking-[4px] uppercase mb-1.5">
            {BRAND.name}
          </div>
          <div className="text-muted text-md">
            Create your business account
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
            <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <Field label="Business Name" htmlFor="businessName" className="mb-3.5">
            <Input
              id="businessName"
              type="text"
              name="businessName"
              placeholder="My Business LLC"
              value={form.businessName}
              onChange={handleChange}
              required
              autoFocus
            />
          </Field>

          <Field label="Email" htmlFor="email" className="mb-3.5">
            <Input
              id="email"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
            />
          </Field>

          <Field
            label="Tax ID / EIN"
            htmlFor="taxId"
            hint="Optional"
            className="mb-3.5"
          >
            <Input
              id="taxId"
              type="text"
              name="taxId"
              placeholder="XX-XXXXXXX"
              value={form.taxId}
              onChange={handleChange}
            />
          </Field>

          <Field label="Currency" htmlFor="currency" className="mb-3.5">
            <Select
              id="currency"
              name="currency"
              value={form.currency}
              onChange={handleChange}
            >
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
            </Select>
          </Field>

          <Field label="Password" htmlFor="password" className="mb-3.5">
            <Input
              id="password"
              type="password"
              name="password"
              placeholder="At least 8 characters"
              value={form.password}
              onChange={handleChange}
              required
            />
          </Field>

          <Field label="Confirm Password" htmlFor="confirmPassword" className="mb-6">
            <Input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={handleChange}
              required
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            full
            loading={loading}
            icon="ti-building-store"
          >
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        {/* Login link */}
        <div className="text-center mt-5 text-md text-muted">
          Already have an account?{" "}
          <Link to="/login" className="text-brand font-medium">
            Sign in
          </Link>
        </div>
      </Card>
    </div>
  );
}
