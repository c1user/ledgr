import { useTranslation } from "react-i18next";
import useFeedbackStore from "../store/feedbackStore";
import { Button, Modal } from "./ui";

const TOAST_ICONS = {
  success: "ti-circle-check text-income",
  error: "ti-alert-circle text-danger",
  info: "ti-info-circle text-brand",
};

/**
 * Renders the feedbackStore state: the toast stack and the confirm dialog.
 * Mounted once in App so it overlays every route, including login.
 */
export default function FeedbackHost() {
  const { t } = useTranslation();
  const toasts = useFeedbackStore((s) => s.toasts);
  const confirm = useFeedbackStore((s) => s.confirm);
  const dismissToast = useFeedbackStore((s) => s.dismissToast);
  const closeConfirm = useFeedbackStore((s) => s.closeConfirm);

  return (
    <>
      {/* Toast stack */}
      {toasts.length > 0 && (
        <div
          className="fixed top-4 right-4 left-4 sm:left-auto sm:w-[360px] z-[300] flex flex-col gap-2"
          role="status"
          aria-live="polite"
        >
          {toasts.map(({ id, tone, message }) => (
            <div
              key={id}
              className="flex items-start gap-2.5 bg-surface border border-line shadow-card rounded-card px-3.5 py-3 fade-in"
            >
              <i
                className={`ti ${TOAST_ICONS[tone] || TOAST_ICONS.info} text-lg shrink-0`}
                aria-hidden="true"
              />
              <div className="flex-1 text-md text-ink break-words">{message}</div>
              <Button
                variant="ghost"
                size="sm"
                icon="ti-x"
                onClick={() => dismissToast(id)}
                aria-label={t("common.close")}
              />
            </div>
          ))}
        </div>
      )}

      {/* Confirm dialog */}
      {confirm && (
        <Modal
          open
          size="sm"
          title={confirm.title || t("common.confirmTitle")}
          onClose={() => closeConfirm(false)}
          footer={
            <>
              <Button onClick={() => closeConfirm(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant={confirm.danger ? "danger" : "primary"}
                autoFocus
                onClick={() => closeConfirm(true)}
              >
                {confirm.confirmLabel ||
                  (confirm.danger ? t("common.delete") : t("common.confirm"))}
              </Button>
            </>
          }
        >
          <div className="text-md text-ink">{confirm.message}</div>
        </Modal>
      )}
    </>
  );
}
