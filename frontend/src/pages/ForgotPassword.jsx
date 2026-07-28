import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import i18n from "../i18n";
import BRAND from "../config/brand";
import BrandMark from "../components/BrandMark";
import { Button, Card, Field, Input } from "../components/ui";

// Public: request a password-reset link. The response is identical whether
// or not the account exists — the copy reflects that.
export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", {
        email,
        lang: i18n.language === "es" ? "es" : "en",
      });
    } finally {
      // Always show the same confirmation — no account enumeration.
      setSent(true);
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
          <div className="text-muted text-md">{t("resetpw.forgotTitle")}</div>
        </div>

        {sent ? (
          <div className="text-center">
            <i
              className="ti ti-mail-forward text-3xl text-income mb-2 inline-block"
              aria-hidden="true"
            />
            <div className="text-md text-ink mb-6">
              {t("resetpw.sentMessage")}
            </div>
            <Link to="/login" className="text-brand font-medium text-md">
              {t("resetpw.backToLogin")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="text-md text-secondary mb-4">
              {t("resetpw.forgotIntro")}
            </div>
            <Field label={t("team.email")} htmlFor="fp-email" className="mb-6">
              <Input
                id="fp-email"
                type="email"
                required
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              full
              loading={loading}
              icon="ti-mail-forward"
            >
              {t("resetpw.sendLink")}
            </Button>
            <div className="text-center mt-5 text-md text-muted">
              <Link to="/login" className="text-brand font-medium">
                {t("resetpw.backToLogin")}
              </Link>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
