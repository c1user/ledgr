import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast } from "../store/feedbackStore";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
} from "../components/ui";

// My Account — the personal counterpart to the business /settings page:
// profile summary, email verification, change-password, 2FA, sessions.
export default function Account() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const logout = useAuthStore((s) => s.logout);

  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");

  // 2FA modal: mode "enable" walks password → verify → codes; "disable"
  // is a single password+code form.
  const [twofa, setTwofa] = useState(null); // {mode, stage}
  const [twofaForm, setTwofaForm] = useState({ password: "", code: "" });
  const [twofaError, setTwofaError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);

  const openTwofa = (mode) => {
    setTwofaForm({ password: "", code: "" });
    setTwofaError("");
    setQrDataUrl("");
    setSetupSecret("");
    setBackupCodes([]);
    setTwofa({ mode, stage: "password" });
  };

  const setup2fa = useMutation({
    mutationFn: () =>
      api
        .post("/auth/2fa/setup", { password: twofaForm.password })
        .then((r) => r.data),
    onSuccess: async (data) => {
      setSetupSecret(data.secret);
      setQrDataUrl(await QRCode.toDataURL(data.otpauthUrl, { margin: 1 }));
      setTwofa({ mode: "enable", stage: "verify" });
    },
    onError: (err) =>
      setTwofaError(err.response?.data?.error || t("account.twofaFailed")),
  });

  const enable2fa = useMutation({
    mutationFn: () =>
      api.post("/auth/2fa/enable", { code: twofaForm.code }).then((r) => r.data),
    onSuccess: (data) => {
      setToken(data.token);
      setUser({ totpEnabled: true });
      setBackupCodes(data.backupCodes);
      setTwofa({ mode: "enable", stage: "codes" });
    },
    onError: (err) =>
      setTwofaError(err.response?.data?.error || t("account.twofaFailed")),
  });

  const disable2fa = useMutation({
    mutationFn: () =>
      api
        .post("/auth/2fa/disable", {
          password: twofaForm.password,
          code: twofaForm.code,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setToken(data.token);
      setUser({ totpEnabled: false });
      setTwofa(null);
      toast.success(t("account.twofaDisabled"));
    },
    onError: (err) =>
      setTwofaError(err.response?.data?.error || t("account.twofaFailed")),
  });

  const logoutAll = useMutation({
    mutationFn: () => api.post("/auth/logout-all").then((r) => r.data),
    onSuccess: () => {
      logout();
      navigate("/login");
    },
    onError: () => toast.error(t("account.logoutAllFailed")),
  });

  const resend = useMutation({
    mutationFn: () =>
      api.post("/auth/resend-verification").then((r) => r.data),
    onSuccess: () => toast.success(t("account.verifySent")),
    onError: (err) =>
      toast.error(err.response?.data?.error || t("account.verifyFailed")),
  });

  const changePassword = useMutation({
    mutationFn: (payload) =>
      api.post("/auth/change-password", payload).then((r) => r.data),
    onSuccess: (data) => {
      // The version bump signed out every other device; the fresh token
      // keeps this session alive.
      if (data.token) setToken(data.token);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setError("");
      toast.success(t("account.passwordChanged"));
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("account.passwordFailed")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      return setError(t("account.mismatch"));
    }
    setError("");
    changePassword.mutate({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
  };

  const pwField = (key, label, props = {}) => (
    <Field label={label} htmlFor={key} className="mb-3.5">
      <Input
        id={key}
        type="password"
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setError("");
        }}
        required
        {...props}
      />
    </Field>
  );

  return (
    <div className="fade-in max-w-[620px] mx-auto">
      <PageHeader title={t("account.title")} subtitle={t("account.subtitle")} />

      {/* Profile summary */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-md font-semibold text-ink">{user?.name}</div>
            <div className="text-md text-secondary">{user?.email}</div>
            <div className="text-xs text-muted mt-0.5 capitalize">
              {user?.role}
            </div>
          </div>
          {user?.emailVerified ? (
            <Badge tone="income" icon="ti-circle-check">
              {t("account.verified")}
            </Badge>
          ) : (
            <div className="text-right">
              <Badge tone="expense" icon="ti-alert-triangle">
                {t("account.unverified")}
              </Badge>
              <div className="mt-2">
                <Button
                  size="sm"
                  icon="ti-mail-forward"
                  loading={resend.isPending}
                  onClick={() => resend.mutate()}
                >
                  {t("account.resend")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Change password */}
      <Card>
        <h2 className="text-md font-semibold text-ink mb-1">
          {t("account.changePassword")}
        </h2>
        <p className="text-md text-muted mb-4">{t("account.policyHint")}</p>

        {error && (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
            <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {pwField("currentPassword", t("account.currentPassword"), {
            autoComplete: "current-password",
          })}
          {pwField("newPassword", t("account.newPassword"), {
            autoComplete: "new-password",
          })}
          {pwField("confirmPassword", t("account.confirmPassword"), {
            autoComplete: "new-password",
          })}
          <Button
            type="submit"
            variant="primary"
            icon="ti-lock"
            loading={changePassword.isPending}
          >
            {t("account.setPassword")}
          </Button>
        </form>
      </Card>

      {/* Two-factor authentication */}
      <Card className="mt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-md font-semibold text-ink mb-1">
              {t("account.twofaTitle")}
            </h2>
            <p className="text-md text-muted">
              {user?.totpEnabled
                ? t("account.twofaOnHint")
                : t("account.twofaOffHint")}
            </p>
          </div>
          {user?.totpEnabled ? (
            <div className="text-right">
              <Badge tone="income" icon="ti-shield-check">
                {t("account.twofaOn")}
              </Badge>
              <div className="mt-2">
                <Button size="sm" onClick={() => openTwofa("disable")}>
                  {t("account.twofaDisable")}
                </Button>
              </div>
            </div>
          ) : (
            <Button icon="ti-shield-plus" onClick={() => openTwofa("enable")}>
              {t("account.twofaEnable")}
            </Button>
          )}
        </div>
      </Card>

      {/* Sessions */}
      <Card className="mt-4">
        <h2 className="text-md font-semibold text-ink mb-1">
          {t("account.sessionsTitle")}
        </h2>
        <p className="text-md text-muted mb-3">{t("account.sessionsHint")}</p>
        <Button
          icon="ti-logout-2"
          loading={logoutAll.isPending}
          onClick={() => logoutAll.mutate()}
        >
          {t("account.logoutAll")}
        </Button>
      </Card>

      {/* 2FA modal */}
      <Modal
        open={!!twofa}
        onClose={() => setTwofa(null)}
        title={
          twofa?.mode === "disable"
            ? t("account.twofaDisable")
            : t("account.twofaEnable")
        }
        size="sm"
      >
        {twofaError && (
          <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
            {twofaError}
          </div>
        )}

        {/* Enable step 1 / disable: password */}
        {twofa?.stage === "password" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (twofa.mode === "enable") setup2fa.mutate();
              else disable2fa.mutate();
            }}
          >
            <p className="text-md text-secondary mb-4">
              {twofa.mode === "enable"
                ? t("account.twofaSetupIntro")
                : t("account.twofaDisableIntro")}
            </p>
            <Field
              label={t("account.currentPassword")}
              htmlFor="twofa-password"
              className="mb-3.5"
            >
              <Input
                id="twofa-password"
                type="password"
                autoComplete="current-password"
                value={twofaForm.password}
                onChange={(e) => {
                  setTwofaForm({ ...twofaForm, password: e.target.value });
                  setTwofaError("");
                }}
                required
                autoFocus
              />
            </Field>
            {twofa.mode === "disable" && (
              <Field
                label={t("account.twofaCode")}
                htmlFor="twofa-code"
                hint={t("account.twofaCodeHint")}
                className="mb-3.5"
              >
                <Input
                  id="twofa-code"
                  type="text"
                  inputMode="numeric"
                  value={twofaForm.code}
                  onChange={(e) => {
                    setTwofaForm({ ...twofaForm, code: e.target.value });
                    setTwofaError("");
                  }}
                  required
                />
              </Field>
            )}
            <Button
              type="submit"
              variant={twofa.mode === "disable" ? "danger" : "primary"}
              full
              loading={setup2fa.isPending || disable2fa.isPending}
            >
              {twofa.mode === "enable"
                ? t("account.twofaContinue")
                : t("account.twofaDisable")}
            </Button>
          </form>
        )}

        {/* Enable step 2: scan + verify */}
        {twofa?.stage === "verify" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enable2fa.mutate();
            }}
          >
            <p className="text-md text-secondary mb-3">
              {t("account.twofaScan")}
            </p>
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="TOTP QR code"
                className="w-[180px] h-[180px] mx-auto mb-3 rounded bg-white p-2"
              />
            )}
            <p className="text-xs text-muted text-center mb-4 break-all">
              {t("account.twofaManual")}{" "}
              <code className="text-ink">{setupSecret}</code>
            </p>
            <Field
              label={t("account.twofaCode")}
              htmlFor="twofa-verify-code"
              className="mb-3.5"
            >
              <Input
                id="twofa-verify-code"
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={twofaForm.code}
                onChange={(e) => {
                  setTwofaForm({ ...twofaForm, code: e.target.value });
                  setTwofaError("");
                }}
                required
                autoFocus
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              full
              loading={enable2fa.isPending}
              icon="ti-shield-check"
            >
              {t("account.twofaVerify")}
            </Button>
          </form>
        )}

        {/* Enable step 3: backup codes, shown exactly once */}
        {twofa?.stage === "codes" && (
          <div>
            <p className="text-md text-secondary mb-3">
              {t("account.twofaCodesIntro")}
            </p>
            <div className="grid grid-cols-2 gap-2 bg-canvas border border-line rounded-lg p-3.5 mb-4 font-mono text-md text-ink">
              {backupCodes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                icon="ti-copy"
                onClick={() => {
                  navigator.clipboard?.writeText(backupCodes.join("\n"));
                  toast.success(t("account.twofaCodesCopied"));
                }}
              >
                {t("account.twofaCopy")}
              </Button>
              <Button variant="primary" onClick={() => setTwofa(null)}>
                {t("account.twofaDone")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
