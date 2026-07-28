import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import useEntitlements from "../lib/useEntitlements";
import { toast } from "../store/feedbackStore";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

// Header "?" menu: contact support / report a problem / send feedback.
// Submissions persist server-side and are emailed to the support inbox
// with this user's address as reply-to.
export default function HelpMenu() {
  const { t } = useTranslation();
  const location = useLocation();
  const { plan } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null); // preset category or null
  const [form, setForm] = useState({ category: "bug", subject: "", message: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submitMutation = useMutation({
    mutationFn: () =>
      api
        .post("/support", {
          category: form.category,
          subject: form.subject,
          message: form.message,
          context: { page: location.pathname, mode: plan || "" },
        })
        .then((r) => r.data),
    onSuccess: () => {
      setModal(null);
      toast.success(t("support.sent"));
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("support.failed")),
  });

  function openModal(category) {
    setOpen(false);
    setForm({ category, subject: "", message: "" });
    setError("");
    setModal(category);
  }

  const MENU = [
    { key: "question", icon: "ti-lifebuoy", label: "support.contact" },
    { key: "bug", icon: "ti-bug", label: "support.reportProblem" },
    { key: "feedback", icon: "ti-message-2", label: "support.sendFeedback" },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("support.help")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center justify-center w-7 h-7 rounded-md text-secondary hover:text-ink hover:bg-canvas cursor-pointer"
      >
        <i className="ti ti-help text-lg" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 z-[160] w-52 py-1.5 bg-surface border border-line rounded-card shadow-card fade-in"
          >
            {MENU.map((item) => (
              <button
                key={item.key}
                role="menuitem"
                onClick={() => openModal(item.key)}
                className="flex items-center gap-2.5 w-full px-3.5 py-2 text-md text-ink hover:bg-canvas cursor-pointer text-left"
              >
                <i
                  className={`ti ${item.icon} text-secondary`}
                  aria-hidden="true"
                />
                {t(item.label)}
              </button>
            ))}
          </div>
        </>
      )}

      {modal && (
        <Modal
          open
          size="sm"
          title={t("support.modalTitle")}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              submitMutation.mutate();
            }}
            className="flex flex-col gap-3.5"
          >
            <Field label={t("support.category")} className="mb-0">
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="bug">{t("support.cat_bug")}</option>
                <option value="billing">{t("support.cat_billing")}</option>
                <option value="question">{t("support.cat_question")}</option>
                <option value="feedback">{t("support.cat_feedback")}</option>
              </Select>
            </Field>
            <Field label={t("support.subject")} className="mb-0">
              <Input
                required
                maxLength={200}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder={t("support.subjectPlaceholder")}
              />
            </Field>
            <Field label={t("support.message")} className="mb-0">
              <Textarea
                required
                rows={5}
                maxLength={5000}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder={t("support.messagePlaceholder")}
              />
            </Field>
            <div className="text-xs text-muted">{t("support.contextNote")}</div>
            {error && <div className="text-md text-expense">{error}</div>}
            <div className="flex gap-2.5 justify-end mt-1">
              <Button onClick={() => setModal(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={submitMutation.isPending}
              >
                {t("support.send")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
