import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card, Field, Input } from "../components/ui";

// Public: /reset-password?token=… — sets a new password and logs straight in.
export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({ password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      return setError(t("join.errPasswordMatch"));
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/reset-password", {
        token,
        password: form.password,
      });
      setAuth(data.token, data.user, data.business);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || t("resetpw.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <Card padding="lg" className="w-full max-w-[400px] fade-in">
        <div className="text-center mb-7">
          <BrandMark size={52} className="mx-auto mb-3" />
          <div className="font-display text-brand text-[22px] font-bold tracking-[4px] uppercase mb-1.5">
            {BRAND.name}
          </div>
          <div className="text-muted text-md">{t("resetpw.resetTitle")}</div>
        </div>

        {!token ? (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md">
            {t("resetpw.noToken")}{" "}
            <Link to="/forgot-password" className="font-medium underline">
              {t("resetpw.requestNew")}
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
                <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <Field label={t("resetpw.newPassword")} htmlFor="rp-password">
                <Input
                  id="rp-password"
                  type="password"
                  required
                  autoFocus
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </Field>
              <div className="text-[11px] text-muted -mt-2 mb-3">
                {t("join.passwordHint")}
              </div>
              <Field
                label={t("join.confirmPassword")}
                htmlFor="rp-confirm"
                className="mb-6"
              >
                <Input
                  id="rp-confirm"
                  type="password"
                  required
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                full
                loading={loading}
                icon="ti-lock-check"
              >
                {t("resetpw.setPassword")}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
