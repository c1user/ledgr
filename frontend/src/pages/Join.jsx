import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card, Field, Input } from "../components/ui";

// Public invite-acceptance page: /join?token=<invite token>.
export default function Join() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({ name: "", password: "", confirm: "" });
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
      const { data } = await api.post("/auth/accept-invite", {
        token,
        name: form.name,
        password: form.password,
      });
      setAuth(data.token, data.user, data.business);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || t("join.failed"));
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
          <div className="text-muted text-md">{t("join.subtitle")}</div>
        </div>

        {!token ? (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md">
            {t("join.noToken")}
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
              <Field label={t("join.yourName")} htmlFor="join-name">
                <Input
                  id="join-name"
                  type="text"
                  required
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label={t("join.password")} htmlFor="join-password">
                <Input
                  id="join-password"
                  type="password"
                  required
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
                htmlFor="join-confirm"
                className="mb-6"
              >
                <Input
                  id="join-confirm"
                  type="password"
                  required
                  value={form.confirm}
                  onChange={(e) =>
                    setForm({ ...form, confirm: e.target.value })
                  }
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                full
                loading={loading}
                icon="ti-login"
              >
                {t("join.accept")}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
