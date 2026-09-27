import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { toast } from "@abaco/ui/feedback";
import useOutboxStore from "../../store/outboxStore.js";
import { liveItems, deadItems } from "../../lib/outbox.js";
import { isOnline } from "../../native/network.js";

/**
 * Shown on the Scan home while the offline queue is non-empty:
 *   - "N receipts will upload when you're back online" + Retry now;
 *   - items that ended in a 4xx (never retried) with the reason + Dismiss.
 */
export default function OutboxRow({ className }) {
  const { t } = useTranslation();
  const queue = useOutboxStore((s) => s.queue);
  const flushing = useOutboxStore((s) => s.flushing);
  const retryNow = useOutboxStore((s) => s.retryNow);
  const discardDead = useOutboxStore((s) => s.discardDead);

  const live = useMemo(() => liveItems(queue), [queue]);
  const dead = useMemo(() => deadItems(queue), [queue]);

  if (live.length === 0 && dead.length === 0) return null;

  const onRetry = async () => {
    if (!(await isOnline())) {
      toast.info(t("mobile.common.offline"));
      return;
    }
    retryNow();
  };

  const deadReason =
    dead[0]?.lastError?.messageKey || "mobile.scan.uploadFailed";

  return (
    <Card padding="sm" className={cx("flex flex-col gap-3", className)}>
      {live.length > 0 && (
        <div className="flex items-center gap-3" role="status">
          <i
            className={cx(
              "ti text-lg shrink-0 text-brand",
              flushing ? "ti-loader-2 animate-spin" : "ti-cloud-upload",
            )}
            aria-hidden="true"
          />
          <span className="flex-1 text-md text-ink">
            {t("mobile.scan.outboxQueued", { count: live.length })}
          </span>
          <Button
            variant="secondary"
            size="md"
            className="min-h-[44px] shrink-0"
            loading={flushing}
            onClick={onRetry}
          >
            {t("mobile.scan.outboxRetry")}
          </Button>
        </div>
      )}

      {dead.length > 0 && (
        <div className="flex items-center gap-3" role="status">
          <i
            className="ti ti-alert-circle text-danger text-lg shrink-0"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <div className="text-md text-ink">
              {t("mobile.scan.outboxFailed", { count: dead.length })}
            </div>
            <div className="text-xs text-muted truncate">{t(deadReason)}</div>
          </div>
          <Button
            variant="ghost"
            size="md"
            className="min-h-[44px] shrink-0"
            onClick={discardDead}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}
    </Card>
  );
}
