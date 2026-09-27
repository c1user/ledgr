import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Modal, Textarea } from "@abaco/ui";
import { toast } from "@abaco/ui/feedback";
import api from "../../lib/api.js";
import { describeError } from "../../lib/apiErrors.js";
import { buildReportMessage, SUPPORT_CATEGORY } from "./utils.js";

const NOTE_MAX = 1000;

function ReportForm({ target, onClose }) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      await api.post("/support", {
        category: SUPPORT_CATEGORY,
        subject: t("mobile.assistant.report.subject"),
        message: buildReportMessage({
          answer: target.text,
          note,
          conversationId: target.conversationId,
          messageIndex: target.index,
        }),
        // The backend keeps context.page / context.mode only; the rest is
        // sent for when it learns to store it (and repeated in the message).
        context: {
          conversationId: target.conversationId ?? null,
          messageIndex: target.index,
          platform: "mobile",
          page: "mobile/assistant",
          mode: "mobile",
        },
      });
      toast.success(t("mobile.assistant.report.sent"));
      onClose();
    } catch (err) {
      const d = describeError(err, t);
      const serverSaid =
        d.kind === "validation" ||
        d.kind === "rateLimited" ||
        d.kind === "network";
      toast.error(serverSaid ? d.text : t("mobile.assistant.report.failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("mobile.assistant.report.title")}
      size="md"
      footer={
        <>
          <Button
            size="lg"
            variant="ghost"
            onClick={onClose}
            disabled={sending}
          >
            {t("mobile.common.cancel")}
          </Button>
          <Button
            size="lg"
            variant="primary"
            icon="ti-send"
            loading={sending}
            onClick={submit}
          >
            {t("mobile.assistant.send")}
          </Button>
        </>
      }
    >
      <p className="text-md text-secondary">
        {t("mobile.assistant.report.hint")}
      </p>
      <blockquote className="mb-4 mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas px-3 py-2 text-md text-secondary">
        {target.text}
      </blockquote>
      <Field label={t("common.notes")} htmlFor="assistant-report-note">
        <Textarea
          id="assistant-report-note"
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          placeholder={t("mobile.assistant.report.notePlaceholder")}
        />
      </Field>
    </Modal>
  );
}

/**
 * "Report this answer" → POST /api/support. Props:
 *   target   { text, index, conversationId } | null (null = closed)
 *   onClose()
 * The form is keyed by the target so each report starts with a blank note.
 */
export default function ReportSheet({ target, onClose }) {
  if (!target) return null;
  return (
    <ReportForm
      key={`${target.conversationId ?? "new"}:${target.index}`}
      target={target}
      onClose={onClose}
    />
  );
}
