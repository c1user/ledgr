import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Input, Modal } from "@abaco/ui";
import api from "../../lib/api.js";
import { describeError } from "../../lib/apiErrors.js";
import AuthBanner from "./AuthBanner.jsx";

/**
 * "Forgot your password?" bottom sheet. POST /auth/forgot-password always
 * answers 200 (no account enumeration), so any HTTP response means "sent";
 * the reset link itself opens on the web. Mount it only while open — the
 * email is seeded from whatever the user typed on the login form.
 */
export default function ForgotPasswordSheet({ email: initialEmail, onClose }) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState(initialEmail || "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const canSend = email.trim().length > 0 && !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", {
        email: email.trim(),
        lang: i18n.language === "es" ? "es" : "en",
      });
      setSent(true);
    } catch (err) {
      // Offline / 5xx: say so instead of claiming the link is on its way.
      setError(describeError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open size="sm" title={t("login.forgotTitle")} onClose={onClose}>
      {sent ? (
        <div className="text-center">
          <i
            className="ti ti-mail-forward mb-2 inline-block text-3xl text-income"
            aria-hidden="true"
          />
          <p className="mb-5 text-md text-ink">{t("login.forgotSent")}</p>
          <Button variant="primary" size="lg" full onClick={onClose}>
            {t("mobile.common.done")}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <p className="mb-4 text-md text-secondary">{t("login.forgotHint")}</p>

          {error && (
            <AuthBanner tone={error.kind === "network" ? "neutral" : "danger"}>
              {error.text}
            </AuthBanner>
          )}

          <Field label={t("login.email")} htmlFor="forgot-email">
            <Input
              id="forgot-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            full
            icon="ti-mail-forward"
            loading={loading}
            disabled={!canSend}
          >
            {t("resetpw.sendLink")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
