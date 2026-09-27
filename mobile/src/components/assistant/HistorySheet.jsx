import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { confirmDialog, toast } from "@abaco/ui/feedback";
import api from "../../lib/api.js";
import useLongPress from "./useLongPress.js";
import { CONVERSATIONS_QUERY_KEY, formatHistoryDate } from "./utils.js";

const NO_CALLOUT = { WebkitTouchCallout: "none" };

// Tap loads the conversation; the trash icon or a long-press deletes it.
function HistoryRow({ conv, active, busy, onSelect, onDelete }) {
  const { t } = useTranslation();
  const longPress = useLongPress(() => onDelete(conv));
  return (
    <li className="flex items-center border-b border-line last:border-b-0">
      <button
        type="button"
        {...longPress}
        onClick={() => onSelect(conv)}
        style={NO_CALLOUT}
        aria-current={active ? "true" : undefined}
        className="min-h-[44px] min-w-0 flex-1 select-none py-3 pr-2 text-left"
      >
        <div
          className={cx(
            "truncate text-md font-medium",
            active ? "text-brand" : "text-ink",
          )}
        >
          {conv.first_message || t("aichat.newConversation")}
        </div>
        <div className="text-[11px] text-muted">
          {formatHistoryDate(conv.updated_at)}
        </div>
      </button>
      <button
        type="button"
        onClick={() => onDelete(conv)}
        disabled={busy}
        aria-label={t("mobile.common.delete")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-danger transition-colors active:bg-danger-bg disabled:opacity-60"
      >
        <i
          className={cx(
            "ti text-base",
            busy ? "ti-loader-2 animate-spin" : "ti-trash",
          )}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

/**
 * Past conversations (GET /api/ai/conversations) as a bottom sheet. Props:
 *   open / onClose
 *   currentId            highlights the loaded conversation
 *   onSelect(conv)       parent fetches /ai/conversations/:id and loads it
 *   onDeleted(id)        after a successful DELETE (parent resets if current)
 */
export default function HistorySheet({
  open,
  onClose,
  currentId,
  onSelect,
  onDeleted,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: () =>
      api
        .get("/ai/conversations")
        .then((r) => (Array.isArray(r.data) ? r.data : [])),
    enabled: open,
  });

  const remove = async (conv) => {
    if (busyId) return;
    const ok = await confirmDialog({
      message: t("mobile.assistant.deleteConfirm"),
      danger: true,
    });
    if (!ok) return;
    setBusyId(conv.id);
    try {
      await api.delete(`/ai/conversations/${conv.id}`);
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      onDeleted?.(conv.id);
    } catch {
      toast.error(t("aichat.deleteError"));
    } finally {
      setBusyId(null);
    }
  };

  let body;
  if (isPending) {
    body = (
      <p className="py-6 text-center text-md text-muted" role="status">
        {t("mobile.common.loading")}
      </p>
    );
  } else if (isError) {
    body = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-md text-muted">{t("aichat.loadError")}</p>
        <Button size="lg" icon="ti-refresh" onClick={() => refetch()}>
          {t("mobile.common.retry")}
        </Button>
      </div>
    );
  } else if (!data?.length) {
    body = (
      <p className="py-6 text-center text-md text-muted">
        {t("mobile.assistant.noHistory")}
      </p>
    );
  } else {
    body = (
      <ul className="-my-2">
        {data.map((conv) => (
          <HistoryRow
            key={conv.id}
            conv={conv}
            active={conv.id === currentId}
            busy={busyId === conv.id}
            onSelect={onSelect}
            onDelete={remove}
          />
        ))}
      </ul>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("mobile.assistant.history")}
      size="md"
    >
      {body}
    </Modal>
  );
}
