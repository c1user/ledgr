import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Modal } from "@abaco/ui";
import cx from "@abaco/ui/cx";
import { toast } from "@abaco/ui/feedback";
import i18n from "../../i18n.js";
import {
  uploadReceipt,
  shouldQueue,
  describeUploadError,
  isUploadCancelled,
} from "../../lib/upload.js";
import { newId, OUTBOX_MAX } from "../../lib/outbox.js";
import { queryClient } from "../../lib/queryClient.js";
import { ENTITLEMENTS_QUERY_KEY } from "../../lib/useEntitlements.js";
import useOutboxStore from "../../store/outboxStore.js";
import { isOnline } from "../../native/network.js";
import {
  success as hapticSuccess,
  warning as hapticWarning,
} from "../../native/haptics.js";
import UpsellNotice from "../UpsellNotice.jsx";

// Per-capture states inside a session.
const ROW = Object.freeze({
  WAITING: "waiting",
  UPLOADING: "uploading", // bytes in flight (determinate progress)
  READING: "reading", // bytes delivered, the AI is reading (5–15 s)
  DONE: "done",
  QUEUED: "queued", // saved to the offline outbox
  FAILED: "failed", // 413 / 415 / 429 / unknown — shown with the mapped text
  UPGRADE: "upgrade", // 403 UPGRADE_REQUIRED → UpsellNotice
  SKIPPED: "skipped", // never attempted: the stack stopped on a 403 / 429
});

const makeRows = (captures) =>
  captures.map((capture) => ({
    capture,
    state: ROW.WAITING,
    progress: 0,
    error: null,
    receipt: null,
  }));

const patchRow = (rows, i, patch) =>
  rows.map((r, j) => (j === i ? { ...r, ...patch } : r));

/**
 * Full-height sheet that uploads the captures of one session, sequentially.
 *   session: { id, mode: "single" | "stack", captures: [{ blob, filename,
 *              previewUrl }] }   — mount with key={session.id}
 *   onClose()        the parent releases the captures and clears the session
 *   onScanAnother()  stack summary → capture again
 *
 * single: 201 → /receipts/:id/review with the row in location.state.
 * stack:  a progress list, then a summary with Done / Scan another.
 * Network error → offline outbox (the remaining captures of a stack skip the
 * attempt and go straight there). 4xx → never queued.
 */
export default function CaptureSheet({ session, onClose, onScanAnother }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const captures = session.captures;
  const single = session.mode !== "stack";

  // One idempotency key per capture, stable across a Retry of the session.
  const keys = useMemo(() => captures.map(() => newId()), [captures]);

  const [rows, setRows] = useState(() => makeRows(captures));
  const [phase, setPhase] = useState("running"); // "running" | "done"
  const [upgrade, setUpgrade] = useState(null); // { limit, used } | null
  const [attempt, setAttempt] = useState(0);
  const runRef = useRef(null);

  // ── The runner ─────────────────────────────────────────────────────────
  useEffect(() => {
    // A run starting right after a teardown (React StrictMode remount in dev,
    // or Retry) is not a real unmount: drop the previous run's pending salvage.
    if (runRef.current?.salvageTimer) clearTimeout(runRef.current.salvageTimer);

    const run = {
      captures,
      keys,
      controller: new AbortController(),
      cancelled: false, // effect torn down (unmount / retry)
      userCancelled: false, // explicit Cancel — never salvage
      stop: false, // 403 / 429 → the rest of the stack waits
      offline: false, // first network error → the rest go to the outbox
      states: captures.map(() => ROW.WAITING),
    };
    runRef.current = run;

    const set = (i, patch) => {
      if (run.cancelled) return;
      if (patch.state) run.states[i] = patch.state;
      setRows((rs) => patchRow(rs, i, patch));
    };

    const queueOne = async (i) => {
      const capture = run.captures[i];
      const res = await useOutboxStore.getState().add({
        blob: capture.blob,
        filename: capture.filename,
        mimeType: capture.blob?.type,
        idempotencyKey: run.keys[i],
      });
      if (run.cancelled) return;
      if (res.ok) {
        set(i, { state: ROW.QUEUED, progress: 0 });
        return;
      }
      // Outbox full (already toasted by the store) or storage failure.
      set(i, {
        state: ROW.FAILED,
        error: {
          messageKey:
            res.reason === "full"
              ? "mobile.scan.outboxFull"
              : "mobile.scan.uploadFailed",
          details: { max: OUTBOX_MAX },
          text: "",
        },
      });
    };

    const uploadOne = async (i) => {
      const capture = run.captures[i];
      set(i, { state: ROW.UPLOADING, progress: 0 });
      if (run.offline || !(await isOnline())) {
        run.offline = true;
        return queueOne(i);
      }
      if (run.cancelled) return;
      try {
        const row = await uploadReceipt({
          blob: capture.blob,
          filename: capture.filename,
          idempotencyKey: run.keys[i],
          signal: run.controller.signal,
          onProgress: (ratio) => {
            if (ratio == null) return;
            set(i, {
              progress: ratio,
              state: ratio >= 1 ? ROW.READING : ROW.UPLOADING,
            });
          },
        });
        if (run.cancelled) return;
        set(i, { state: ROW.DONE, progress: 1, receipt: row });
        hapticSuccess();
      } catch (err) {
        if (run.cancelled || isUploadCancelled(err)) return;
        if (shouldQueue(err)) {
          run.offline = true;
          return queueOne(i);
        }
        const d = describeUploadError(err);
        hapticWarning();
        if (d.kind === "upgrade") {
          run.stop = true;
          set(i, { state: ROW.UPGRADE, error: d });
          setUpgrade({ limit: d.details.limit, used: d.details.used });
          return;
        }
        set(i, { state: ROW.FAILED, error: d });
        toast.error(d.messageKey ? i18n.t(d.messageKey) : d.text);
        if (d.kind === "rateLimited") run.stop = true;
      }
    };

    (async () => {
      for (let i = 0; i < run.captures.length; i++) {
        if (run.cancelled) return;
        if (run.stop) {
          // 403 / 429: the rest would fail the same way — leave them
          // untouched (not queued, not salvaged); the user scans again later.
          set(i, { state: ROW.SKIPPED });
          continue;
        }
        await uploadOne(i);
      }
      if (run.cancelled) return;
      const uploaded = run.states.filter((s) => s === ROW.DONE).length;
      const queued = run.states.filter((s) => s === ROW.QUEUED).length;
      if (uploaded > 0) {
        queryClient.invalidateQueries({ queryKey: ["receipts"] });
        queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
      }
      if (queued > 0) toast.info(i18n.t("mobile.scan.savedToOutbox"));
      setPhase("done");
    })();

    return () => {
      run.cancelled = true;
      run.controller.abort();
      // Torn down mid-upload without an explicit Cancel (tab switch, app
      // killed the route): keep the captures instead of losing them. Only the
      // ones whose bytes never fully left the device — a request that was
      // already "reading" has landed server-side and will show up in
      // Receipts. Deferred one tick so a StrictMode remount (dev) cancels it.
      if (run.userCancelled) return;
      const salvage = run.captures.filter(
        (_, i) =>
          run.states[i] === ROW.WAITING || run.states[i] === ROW.UPLOADING,
      );
      if (!salvage.length) return;
      run.salvageTimer = setTimeout(async () => {
        const store = useOutboxStore.getState();
        let saved = 0;
        for (const capture of salvage) {
          const res = await store.add({
            blob: capture.blob,
            filename: capture.filename,
            mimeType: capture.blob?.type,
            idempotencyKey: run.keys[run.captures.indexOf(capture)],
          });
          if (res.ok) saved += 1;
        }
        if (saved > 0) toast.info(i18n.t("mobile.scan.savedToOutbox"));
      }, 0);
    };
  }, [captures, keys, attempt]);

  // ── Single mode: straight to Review once the row is back ──────────────
  const firstRow = rows[0];
  useEffect(() => {
    if (!single || phase !== "done") return;
    if (firstRow?.state !== ROW.DONE || !firstRow.receipt) return;
    const receipt = firstRow.receipt;
    onClose?.();
    navigate(`/receipts/${receipt.id}/review`, { state: { receipt } });
  }, [single, phase, firstRow, onClose, navigate]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const running = phase === "running";

  const handleCancel = () => {
    const run = runRef.current;
    if (run) {
      run.userCancelled = true;
      run.controller.abort();
    }
    onClose?.();
  };

  const handleRetry = () => {
    setRows(makeRows(captures));
    setUpgrade(null);
    setPhase("running");
    setAttempt((a) => a + 1);
  };

  const uploadedCount = rows.filter((r) => r.state === ROW.DONE).length;
  const queuedCount = rows.filter((r) => r.state === ROW.QUEUED).length;

  const handleDone = () => {
    onClose?.();
    if (uploadedCount > 0) navigate("/receipts?status=pending");
  };

  const errorText = (error) => {
    if (!error) return t("mobile.scan.uploadFailed");
    if (error.messageKey) return t(error.messageKey, error.details || {});
    return error.text || t("mobile.scan.uploadFailed");
  };

  // ── Footer ─────────────────────────────────────────────────────────────
  let footer;
  if (running) {
    footer = (
      <Button size="lg" variant="secondary" onClick={handleCancel}>
        {t("mobile.common.cancel")}
      </Button>
    );
  } else if (single) {
    const state = firstRow?.state;
    const canRetry =
      state === ROW.FAILED &&
      (firstRow.error?.kind === "rateLimited" ||
        firstRow.error?.kind === "unknown" ||
        firstRow.error?.kind === "validation");
    footer = (
      <>
        {canRetry && (
          <Button size="lg" variant="primary" onClick={handleRetry}>
            {t("mobile.common.retry")}
          </Button>
        )}
        <Button size="lg" variant="secondary" onClick={handleCancel}>
          {state === ROW.DONE ? t("mobile.common.done") : t("common.close")}
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        {!upgrade && (
          <Button size="lg" variant="secondary" onClick={onScanAnother}>
            {t("mobile.common.scanAnother")}
          </Button>
        )}
        <Button size="lg" variant="primary" onClick={handleDone}>
          {t("mobile.common.done")}
        </Button>
      </>
    );
  }

  const title = single
    ? t("mobile.scan.scanReceipt")
    : t("mobile.scan.scanStack");

  return (
    <Modal
      open
      size="full"
      title={title}
      onClose={handleCancel}
      footer={footer}
    >
      {single ? (
        <SingleView row={firstRow} upgrade={upgrade} errorText={errorText} />
      ) : (
        <StackView
          rows={rows}
          upgrade={upgrade}
          running={running}
          uploadedCount={uploadedCount}
          queuedCount={queuedCount}
          errorText={errorText}
        />
      )}
    </Modal>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function ProgressBar({ ratio, tone = "brand" }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100);
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-sunken"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-200",
          tone === "danger" ? "bg-danger" : "bg-brand",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatusLine({ icon, spin, tone, children }) {
  return (
    <div className="flex items-start gap-3">
      <i
        className={cx(
          "ti text-xl shrink-0 leading-none mt-0.5",
          icon,
          spin && "animate-spin",
          tone === "danger" && "text-danger",
          tone === "income" && "text-income",
          tone === "muted" && "text-muted",
          !tone && "text-brand",
        )}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function SingleView({ row, upgrade, errorText }) {
  const { t } = useTranslation();
  if (!row) return null;
  const { capture, state, progress } = row;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center rounded-card bg-sunken p-2">
        <img
          src={capture.previewUrl}
          alt={t("receipts.capturedAlt")}
          className="max-h-[42dvh] w-auto max-w-full rounded-lg object-contain"
        />
      </div>

      {state === ROW.WAITING || state === ROW.UPLOADING ? (
        <StatusLine icon="ti-cloud-upload">
          <div className="text-md font-medium text-ink mb-2">
            {t("mobile.scan.uploading")}
          </div>
          <ProgressBar ratio={progress} />
        </StatusLine>
      ) : null}

      {state === ROW.READING && (
        <StatusLine icon="ti-sparkles" spin={false}>
          <div className="flex items-center gap-2 text-md font-medium text-ink">
            <i
              className="ti ti-loader-2 animate-spin text-brand"
              aria-hidden="true"
            />
            {t("mobile.scan.reading")}
          </div>
          <div className="text-md text-muted">
            {t("mobile.scan.readingHint")}
          </div>
        </StatusLine>
      )}

      {state === ROW.DONE && (
        <StatusLine icon="ti-circle-check" tone="income">
          <div className="text-md font-medium text-ink">
            {t("mobile.common.done")}
          </div>
        </StatusLine>
      )}

      {state === ROW.QUEUED && (
        <StatusLine icon="ti-cloud-off" tone="muted">
          <div className="text-md font-medium text-ink">
            {t("mobile.common.offline")}
          </div>
          <div className="text-md text-muted">
            {t("mobile.scan.savedToOutbox")}
          </div>
        </StatusLine>
      )}

      {state === ROW.FAILED && (
        <StatusLine icon="ti-alert-circle" tone="danger">
          <div className="text-md font-medium text-ink">
            {t("mobile.scan.uploadFailed")}
          </div>
          <div className="text-md text-muted">{errorText(row.error)}</div>
        </StatusLine>
      )}

      {state === ROW.UPGRADE && (
        <UpsellNotice
          feature="ai_receipts"
          used={upgrade?.used}
          limit={upgrade?.limit}
        />
      )}
    </div>
  );
}

function StackRow({ index, row, errorText }) {
  const { t } = useTranslation();
  const { capture, state, progress } = row;
  let body;
  switch (state) {
    case ROW.UPLOADING:
      body = (
        <>
          <div className="text-xs text-muted mb-1">
            {t("mobile.scan.uploading")}
          </div>
          <ProgressBar ratio={progress} />
        </>
      );
      break;
    case ROW.READING:
      body = (
        <div className="flex items-center gap-1.5 text-xs text-secondary">
          <i
            className="ti ti-loader-2 animate-spin text-brand"
            aria-hidden="true"
          />
          {t("mobile.scan.reading")}
        </div>
      );
      break;
    case ROW.DONE:
      body = (
        <div className="flex items-center gap-1.5 text-xs text-income">
          <i className="ti ti-circle-check" aria-hidden="true" />
          {t("mobile.common.done")}
        </div>
      );
      break;
    case ROW.QUEUED:
      body = (
        <div className="flex items-center gap-1.5 text-xs text-secondary">
          <i className="ti ti-cloud-off" aria-hidden="true" />
          {t("mobile.common.offline")}
        </div>
      );
      break;
    case ROW.FAILED:
      body = (
        <div className="flex items-center gap-1.5 text-xs text-danger">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span className="truncate">{errorText(row.error)}</span>
        </div>
      );
      break;
    case ROW.UPGRADE:
      body = (
        <div className="flex items-center gap-1.5 text-xs text-danger">
          <i className="ti ti-lock" aria-hidden="true" />
          <span className="truncate">{t("mobile.scan.limitReached")}</span>
        </div>
      );
      break;
    default:
      body = <div className="text-xs text-muted">—</div>;
  }
  return (
    <li className="flex items-center gap-3 py-2.5 border-b border-line last:border-b-0">
      <img
        src={capture.previewUrl}
        alt=""
        className="h-12 w-12 shrink-0 rounded-lg bg-sunken object-cover"
      />
      <div className="flex-1 min-w-0">
        <div className="text-md font-medium text-ink font-mono">
          #{index + 1}
        </div>
        {body}
      </div>
    </li>
  );
}

function StackView({
  rows,
  upgrade,
  running,
  uploadedCount,
  queuedCount,
  errorText,
}) {
  const { t } = useTranslation();
  const total = rows.length;
  const ratio = total ? (uploadedCount + queuedCount) / total : 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between text-md text-ink mb-2">
          <span className="font-medium">
            {t("mobile.scan.stackProgress", { done: uploadedCount, total })}
          </span>
          {running && (
            <i
              className="ti ti-loader-2 animate-spin text-brand"
              aria-hidden="true"
            />
          )}
        </div>
        <ProgressBar ratio={ratio} />
        {queuedCount > 0 && !running && (
          <div className="mt-2 text-md text-muted">
            {t("mobile.scan.outboxQueued", { count: queuedCount })}
          </div>
        )}
      </div>

      {upgrade && (
        <UpsellNotice
          feature="ai_receipts"
          used={upgrade.used}
          limit={upgrade.limit}
        />
      )}

      <ul className="flex flex-col">
        {rows.map((row, i) => (
          <StackRow key={i} index={i} row={row} errorText={errorText} />
        ))}
      </ul>
    </div>
  );
}
