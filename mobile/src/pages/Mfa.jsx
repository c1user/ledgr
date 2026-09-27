import { useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Field, Input } from "@abaco/ui";
import { toast } from "@abaco/ui/feedback";
import api from "../lib/api.js";
import useAuthStore from "../store/authStore.js";
import * as haptics from "../native/haptics.js";
import AuthLayout from "../components/auth/AuthLayout.jsx";
import AuthBanner from "../components/auth/AuthBanner.jsx";
import {
  describeMfaError,
  isCompleteCode,
  nextPathAfterSignIn,
  normalizeBackupCode,
  normalizeTotpCode,
  TOTP_LENGTH,
  BACKUP_HEX_LENGTH,
} from "../components/auth/authFlow.js";

/**
 * Second sign-in step (ROADMAP-V6 2.3): the 6-digit authenticator code, or a
 * single-use backup code ("xxxxx-xxxxx"). The 5-minute mfaToken arrives in
 * router state from Login and never leaves memory; with no token (reload,
 * deep link) we bounce to /login.
 *
 * POST /auth/2fa/verify-login { mfaToken, code } → authStore.signIn() →
 * /scan. A 400 matching /expired/i means the step token lapsed → toast and
 * back to the password step.
 */
export default function Mfa() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const signIn = useAuthStore((s) => s.signIn);

  const mfaToken = location.state?.mfaToken || null;
  const email = location.state?.email || "";

  const [mode, setMode] = useState("totp"); // "totp" | "backup"
  const [code, setCode] = useState("");
  const [error, setError] = useState(null); // { kind, title, text }
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  if (status === "authed") {
    return <Navigate to={nextPathAfterSignIn(location.state)} replace />;
  }
  if (!mfaToken) return <Navigate to="/login" replace />;

  const backup = mode === "backup";
  const complete = isCompleteCode(code, mode);

  const backToPassword = () =>
    navigate("/login", { replace: true, state: { email } });

  const verify = async (value) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/2fa/verify-login", {
        mfaToken,
        code: value,
      });
      await signIn(data); // persists the token + applies user.language
      haptics.success();
      navigate(nextPathAfterSignIn(location.state), { replace: true });
    } catch (err) {
      haptics.error();
      const described = describeMfaError(err, t);
      if (described.kind === "expired") {
        toast.error(described.text);
        backToPassword();
        return;
      }
      setError(described);
      setCode("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (complete && !loading) verify(code);
  };

  const handleChange = (e) => {
    const next = backup
      ? normalizeBackupCode(e.target.value)
      : normalizeTotpCode(e.target.value);
    setCode(next);
    if (error) setError(null);
    // Authenticator codes submit themselves on the 6th digit (typed or
    // filled by one-time-code autofill); backup codes wait for the button.
    if (!backup && isCompleteCode(next, "totp") && !loading) verify(next);
  };

  const toggleMode = () => {
    setMode(backup ? "totp" : "backup");
    setCode("");
    setError(null);
  };

  const backupHint = i18n.exists("login.backupCodeHint")
    ? t("login.backupCodeHint")
    : null;

  return (
    <AuthLayout subtitle={t("login.mfaTitle")}>
      {error && (
        <AuthBanner
          tone={error.kind === "network" ? "neutral" : "danger"}
          title={error.title}
        >
          {error.text}
        </AuthBanner>
      )}

      <p className="mb-1 text-md text-secondary">
        {backup ? backupHint : t("login.mfaHint")}
      </p>
      {email && <p className="mb-4 truncate text-xs text-muted">{email}</p>}

      <form onSubmit={handleSubmit}>
        <Field
          label={
            backup
              ? t("login.backupCode", { defaultValue: t("login.code") })
              : t("login.code")
          }
          htmlFor="mfa-code"
        >
          {backup ? (
            <Input
              key="backup"
              ref={inputRef}
              id="mfa-code"
              name="code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={BACKUP_HEX_LENGTH + 1}
              enterKeyHint="go"
              placeholder="xxxxx-xxxxx"
              autoFocus
              required
              value={code}
              onChange={handleChange}
              className="text-center font-mono text-xl tracking-wider"
            />
          ) : (
            <Input
              key="totp"
              ref={inputRef}
              id="mfa-code"
              name="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={TOTP_LENGTH}
              enterKeyHint="go"
              autoFocus
              required
              value={code}
              onChange={handleChange}
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          )}
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          full
          icon="ti-shield-check"
          loading={loading}
          disabled={!complete || loading}
        >
          {loading ? t("login.verifying") : t("login.verify")}
        </Button>
      </form>

      <div className="mt-4 flex flex-col items-stretch gap-1">
        <Button
          variant="ghost"
          size="md"
          full
          icon={backup ? "ti-device-mobile" : "ti-key"}
          onClick={toggleMode}
          className="min-h-[44px]"
        >
          {backup ? t("login.useAuthenticatorCode") : t("login.useBackupCode")}
        </Button>
        <Button
          variant="ghost"
          size="md"
          full
          icon="ti-arrow-left"
          onClick={backToPassword}
          className="min-h-[44px]"
        >
          {t("login.backToPassword")}
        </Button>
      </div>
    </AuthLayout>
  );
}
