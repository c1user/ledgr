import { useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Field, Input } from "@abaco/ui";
import api from "../lib/api.js";
import useAuthStore from "../store/authStore.js";
import * as haptics from "../native/haptics.js";
import AuthLayout from "../components/auth/AuthLayout.jsx";
import AuthBanner from "../components/auth/AuthBanner.jsx";
import PasswordInput from "../components/auth/PasswordInput.jsx";
import ForgotPasswordSheet from "../components/auth/ForgotPasswordSheet.jsx";
import {
  describeLoginError,
  nextPathAfterSignIn,
} from "../components/auth/authFlow.js";

/**
 * Sign-in (ROADMAP-V6 2.3). Sign-in ONLY: no registration, no pricing — the
 * "accounts are created on the web" sentence is plain text.
 *
 * POST /auth/login → { token, user, business } → authStore.signIn() (persists
 * the token, sets the Bearer, applies user.language) → /scan (or the location
 * RequireAuth interrupted). { mfaRequired, mfaToken } → /mfa with the step
 * token in router state only — it is never stored.
 *
 * Language before sign-in is the device locale (i18n.js); the 401 from this
 * POST is NOT a dead session (the api interceptor ignores 401s that carried
 * no token), so it is shown inline.
 */
export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const status = useAuthStore((s) => s.status);
  const signIn = useAuthStore((s) => s.signIn);

  // Mfa's "Back to password" hands the email back through router state.
  const [email, setEmail] = useState(() => location.state?.email || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null); // { kind, title, text }
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const passwordRef = useRef(null);

  // Already signed in (back button after sign-in, deep link) → straight in.
  if (status === "authed") {
    return <Navigate to={nextPathAfterSignIn(location.state)} replace />;
  }

  const expired = params.get("expired") === "1";
  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    const cleanEmail = email.trim();
    try {
      const { data } = await api.post("/auth/login", {
        email: cleanEmail,
        password,
      });

      if (data?.mfaRequired) {
        // 5-minute step token: component/router state only, never persisted.
        haptics.tap();
        navigate("/mfa", {
          state: {
            mfaToken: data.mfaToken,
            email: cleanEmail,
            from: location.state?.from,
          },
        });
        return;
      }

      await signIn(data); // also calls setAppLanguage(user.language)
      haptics.success();
      navigate(nextPathAfterSignIn(location.state), { replace: true });
    } catch (err) {
      haptics.error();
      setError(describeLoginError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const onEmailKeyDown = (e) => {
    // Return on the email field moves to the password (enterKeyHint="next")
    // instead of submitting a half-filled form.
    if (e.key === "Enter") {
      e.preventDefault();
      passwordRef.current?.focus();
    }
  };

  return (
    <AuthLayout
      subtitle={t("login.subtitle")}
      footer={<p className="text-xs text-muted">{t("login.noAccountHint")}</p>}
    >
      {expired && !error && (
        <AuthBanner tone="info" icon="ti-clock-exclamation">
          {t("login.expired")}
        </AuthBanner>
      )}

      {error && (
        <AuthBanner
          tone={error.kind === "network" ? "neutral" : "danger"}
          title={error.title}
        >
          {error.text}
        </AuthBanner>
      )}

      <form onSubmit={handleSubmit}>
        <Field label={t("login.email")} htmlFor="login-email">
          <Input
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onEmailKeyDown}
          />
        </Field>

        <Field label={t("login.password")} htmlFor="login-password">
          <PasswordInput
            ref={passwordRef}
            id="login-password"
            name="password"
            autoComplete="current-password"
            enterKeyHint="go"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>

        <div className="mb-6 flex justify-end">
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="inline-flex min-h-[44px] items-center px-1 text-md font-medium text-brand"
          >
            {t("login.forgot")}
          </button>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          full
          icon="ti-login"
          loading={loading}
          disabled={!canSubmit}
        >
          {loading ? t("login.signingIn") : t("login.signIn")}
        </Button>
      </form>

      {forgotOpen && (
        <ForgotPasswordSheet
          email={email}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </AuthLayout>
  );
}
