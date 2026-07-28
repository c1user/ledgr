import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { toast } from "../store/feedbackStore";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";

// My Account — the personal counterpart to the business /settings page:
// profile summary, email verification status, and change-password.
export default function Account() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");

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
    onSuccess: () => {
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
    </div>
  );
}
