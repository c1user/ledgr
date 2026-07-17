import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "../lib/api";
import useAuthStore from "../store/authStore";
import { confirmDialog, toast } from "../store/feedbackStore";
import cx from "../lib/cx";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../components/ui";

const ROLE_TONES = { owner: "brand", admin: "payroll", viewer: "neutral" };

function copyLink(link, t) {
  navigator.clipboard
    .writeText(link)
    .then(() => toast.success(t("team.linkCopied")))
    .catch(() => toast.error(t("team.copyFailed")));
}

// ── Invite modal ──────────────────────────────────────────────
function InviteModal({ onClose, t, lang }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: "", role: "viewer" });
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { inviteLink, email }

  const inviteMutation = useMutation({
    mutationFn: () =>
      api
        .post("/team/invites", { ...form, lang })
        .then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["team"] });
      setResult(data);
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("team.inviteFailed")),
  });

  return (
    <Modal open onClose={onClose} title={t("team.inviteTitle")} size="sm">
      {result ? (
        <div className="flex flex-col gap-3.5">
          <div className="text-md text-ink">
            {result.email?.delivered && !result.email?.fallback
              ? t("team.inviteSent", { email: form.email })
              : t("team.inviteCreated", { email: form.email })}
          </div>
          <div className="flex items-center gap-2 bg-canvas rounded-lg px-3 py-2.5">
            <span className="flex-1 min-w-0 truncate text-xs text-secondary font-mono">
              {result.inviteLink}
            </span>
            <Button
              size="sm"
              icon="ti-copy"
              onClick={() => copyLink(result.inviteLink, t)}
            >
              {t("team.copyLink")}
            </Button>
          </div>
          <div className="text-xs text-muted">{t("team.linkExpiry")}</div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            inviteMutation.mutate();
          }}
          className="flex flex-col gap-3.5"
        >
          <Field label={t("team.email")} className="mb-0">
            <Input
              type="email"
              required
              placeholder="colleague@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t("team.role")} className="mb-0">
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="viewer">{t("team.role_viewer")}</option>
              <option value="admin">{t("team.role_admin")}</option>
            </Select>
          </Field>
          <div className="text-xs text-muted">{t("team.roleHint")}</div>
          {error && <div className="text-md text-expense">{error}</div>}
          <div className="flex gap-2.5 justify-end mt-1">
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={inviteMutation.isPending}
            >
              {t("team.sendInvite")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Team() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);

  const isOwner = user?.role === "owner";
  const canInvite = isOwner || user?.role === "admin";

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.get("/team").then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["team"] });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) =>
      api.put(`/team/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(err.response?.data?.error || t("team.updateFailed")),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => api.delete(`/team/${id}`).then((r) => r.data),
    onSuccess: invalidate,
    onError: (err) =>
      toast.error(err.response?.data?.error || t("team.updateFailed")),
  });

  const resendMutation = useMutation({
    mutationFn: (id) =>
      api
        .post(`/team/${id}/resend`, { lang: i18n.language })
        .then((r) => r.data),
    onSuccess: (data) => {
      copyLink(data.inviteLink, t);
      invalidate();
    },
    onError: (err) =>
      toast.error(err.response?.data?.error || t("team.updateFailed")),
  });

  const statusBadge = (m) => {
    if (m.pending) return <Badge tone="payroll">{t("team.pending")}</Badge>;
    if (!m.is_active)
      return <Badge tone="danger">{t("team.deactivated")}</Badge>;
    return <Badge tone="income">{t("team.active")}</Badge>;
  };

  return (
    <div className="max-w-[760px] mx-auto">
      <PageHeader
        title={t("team.title")}
        subtitle={t("team.subtitle")}
        actions={
          canInvite && (
            <Button
              variant="primary"
              icon="ti-user-plus"
              onClick={() => setShowInvite(true)}
            >
              {t("team.invite")}
            </Button>
          )
        }
      />

      {isLoading && (
        <div className="text-muted text-sm py-10 text-center">
          {t("common.loading")}
        </div>
      )}

      {!isLoading && (
        <Card padding="none" className="overflow-hidden">
          {members.map((m) => {
            const isSelf = m.id === user?.id;
            return (
              <div
                key={m.id}
                className={cx(
                  "flex items-center gap-3 px-4 py-[var(--row-y)] border-b border-line last:border-b-0 flex-wrap",
                  !m.is_active && "opacity-60",
                )}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-light text-brand text-xs font-semibold shrink-0">
                  {(m.name || m.email)[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-md font-medium text-ink truncate">
                    {m.name}
                    {isSelf && (
                      <span className="text-[11px] text-muted ml-1.5 font-normal">
                        ({t("team.you")})
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted truncate">
                    {m.email}
                    {m.last_login &&
                      ` · ${t("team.lastLogin")} ${dayjs(m.last_login).format("MMM D, YYYY")}`}
                  </div>
                </div>

                {statusBadge(m)}

                {isOwner && !isSelf && !m.pending ? (
                  <Select
                    value={m.role}
                    disabled={updateMutation.isPending}
                    onChange={(e) =>
                      updateMutation.mutate({
                        id: m.id,
                        body: { role: e.target.value },
                      })
                    }
                    className="w-auto px-2 py-1 text-xs"
                    aria-label={t("team.role")}
                  >
                    <option value="owner">{t("team.role_owner")}</option>
                    <option value="admin">{t("team.role_admin")}</option>
                    <option value="viewer">{t("team.role_viewer")}</option>
                  </Select>
                ) : (
                  <Badge tone={ROLE_TONES[m.role] || "neutral"}>
                    {t(`team.role_${m.role}`, m.role)}
                  </Badge>
                )}

                {canInvite && m.pending && (
                  <Button
                    size="sm"
                    icon="ti-copy"
                    disabled={resendMutation.isPending}
                    onClick={() => resendMutation.mutate(m.id)}
                    title={t("team.resendHint")}
                  >
                    {t("team.copyLink")}
                  </Button>
                )}

                {isOwner && !isSelf && (
                  m.is_active ? (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={m.pending ? "ti-trash" : "ti-user-off"}
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            message: m.pending
                              ? t("team.confirmRemoveInvite", { email: m.email })
                              : t("team.confirmDeactivate", { name: m.name }),
                            confirmLabel: m.pending
                              ? t("common.delete")
                              : t("team.deactivate"),
                            danger: true,
                          })
                        )
                          removeMutation.mutate(m.id);
                      }}
                    />
                  ) : (
                    <Button
                      size="sm"
                      icon="ti-user-check"
                      onClick={() =>
                        updateMutation.mutate({
                          id: m.id,
                          body: { isActive: true },
                        })
                      }
                    >
                      {t("team.reactivate")}
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </Card>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          t={t}
          lang={i18n.language}
        />
      )}
    </div>
  );
}
