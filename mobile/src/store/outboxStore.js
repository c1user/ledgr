import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "@abaco/ui/feedback";
import i18n from "../i18n.js";
import * as Q from "../lib/outbox.js";
import {
  uploadReceipt,
  shouldQueue,
  describeUploadError,
} from "../lib/upload.js";
import { queryClient } from "../lib/queryClient.js";
import { ENTITLEMENTS_QUERY_KEY } from "../lib/useEntitlements.js";
import { getAuthToken } from "../lib/api.js";
import { decodeJwtUserId } from "../lib/jwt.js";
import useAuthStore from "./authStore.js";
import {
  saveBlob,
  loadBlob,
  deleteBlob,
  clearBlobs,
} from "../native/outbox.js";
import { isOnline, onChange as onNetworkChange } from "../native/network.js";
import { onResume } from "../native/appLifecycle.js";
import {
  success as hapticSuccess,
  warning as hapticWarning,
} from "../native/haptics.js";

// Offline outbox (ROADMAP-V6 2.11). Queue METADATA persists here under
// "abaco-mobile-outbox" (localStorage — never the token, never the image);
// the captured bytes live in native/outbox.js (Filesystem on device,
// IndexedDB in the browser). lib/outbox.js holds the pure rules: cap 50,
// exponential backoff, 4xx (except 401) is final.
//
// Ownership (shared device): every item is stamped with the user id that
// captured it and flush() only ever uploads the signed-in user's items —
// another account's captures are never sent under this token. An explicit
// sign-out clears the outbox (Settings); a session expiry keeps it so the
// same person's re-login resumes the uploads.
//
// Triggers: start() (call once from the shell) flushes on launch, whenever
// the network comes back and whenever the app returns to the foreground;
// "Retry now" calls retryNow(). Uploads run one at a time, oldest first.
export const OUTBOX_STORAGE_KEY = "abaco-mobile-outbox";
export const OUTBOX_MAX = Q.OUTBOX_MAX;

/**
 * The signed-in account's id, as a string. Falls back to the JWT's userId
 * claim so a stale/offline boot (user === null) still owns its captures.
 */
export function currentOwnerId() {
  const id = useAuthStore.getState().user?.id;
  if (id !== undefined && id !== null) return String(id);
  return decodeJwtUserId(getAuthToken());
}

/** Live (queued + in-flight) count — the Scan tab badge and OutboxRow. */
export const selectOutboxCount = (s) => Q.liveItems(s.queue).length;
/** Items that hit a 4xx and wait for the user to discard them. */
export const selectDeadCount = (s) => Q.deadItems(s.queue).length;
export const selectDeadItems = (s) => Q.deadItems(s.queue);

let stopTriggers = null;

const useOutboxStore = create(
  persist(
    (set, get) => ({
      queue: [],
      flushing: false, // not persisted

      /**
       * add({ blob, filename, mimeType?, idempotencyKey? })
       *   → { ok: true, item } | { ok: false, reason: "full" | "storage" }
       * Stores the bytes first, then the metadata, so a crash in between
       * leaves at worst an orphan file (never a queue entry without bytes).
       */
      add: async ({ blob, filename, mimeType, idempotencyKey }) => {
        if (Q.isFull(get().queue)) {
          toast.error(i18n.t("mobile.scan.outboxFull", { max: Q.OUTBOX_MAX }));
          return { ok: false, reason: "full" };
        }
        const item = Q.createItem({
          filename,
          mimeType: mimeType || blob?.type || "image/jpeg",
          size: blob?.size,
          idempotencyKey,
          ownerId: currentOwnerId(),
        });
        try {
          await saveBlob(item.id, blob);
        } catch {
          return { ok: false, reason: "storage" };
        }
        const next = Q.enqueue(get().queue, item);
        if (next === get().queue) {
          // Filled up while we were writing the bytes.
          await deleteBlob(item.id);
          toast.error(i18n.t("mobile.scan.outboxFull", { max: Q.OUTBOX_MAX }));
          return { ok: false, reason: "full" };
        }
        set({ queue: next });
        return { ok: true, item };
      },

      /** Drops one item and its bytes. */
      discard: async (id) => {
        set({ queue: Q.remove(get().queue, id) });
        await deleteBlob(id);
      },

      /** Drops every item that ended in a 4xx. */
      discardDead: async () => {
        const dead = Q.deadItems(get().queue);
        set({ queue: Q.removeDead(get().queue) });
        await Promise.all(dead.map((d) => deleteBlob(d.id)));
      },

      /**
       * Everything gone. Settings calls it on an explicit sign-out (a
       * different person may use the device next); expire() does not.
       */
      clear: async () => {
        set({ queue: [] });
        await clearBlobs();
      },

      /** "Retry now": ignores backoff timers, still never retries 4xx. */
      retryNow: () => get().flush({ force: true }),

      /**
       * Uploads every due item OF THE SIGNED-IN USER, oldest first, one at a
       * time. Stops early when the network drops again, on a 401 (session
       * ended — the item stays queued for the next login) or a 429 (do not
       * hammer the limiter — the rest wait for the next trigger).
       */
      flush: async ({ force = false } = {}) => {
        if (get().flushing) return;
        if (useAuthStore.getState().status !== "authed") return;
        if (!(await isOnline())) return;

        set({ flushing: true });
        let uploaded = 0;
        try {
          for (;;) {
            const now = Date.now();
            const me = currentOwnerId();
            const item = Q.nextRetryable(Q.ownedBy(get().queue, me), now, {
              force,
            });
            if (!item) break;
            set({ queue: Q.markRetrying(get().queue, item.id, now) });

            const blob = await loadBlob(item.id, item.mimeType);
            if (!blob) {
              // Bytes are gone (storage cleared) — nothing left to upload.
              set({ queue: Q.remove(get().queue, item.id) });
              continue;
            }

            try {
              await uploadReceipt({
                blob,
                filename: item.filename,
                idempotencyKey: item.idempotencyKey,
              });
              set({ queue: Q.remove(get().queue, item.id) });
              await deleteBlob(item.id);
              uploaded += 1;
              hapticSuccess();
              toast.success(i18n.t("mobile.scan.outboxUploaded"));
            } catch (err) {
              if (shouldQueue(err)) {
                // Offline again: back off and stop this round.
                set({
                  queue: Q.markFailed(get().queue, item.id, { status: null }),
                });
                break;
              }
              const d = describeUploadError(err);
              set({
                queue: Q.markFailed(get().queue, item.id, {
                  status: d.status,
                  // OutboxRow renders t(messageKey) with no variables, so the
                  // upsell copy (which needs {{limit}}) is swapped for the
                  // variable-free "limit reached" key.
                  messageKey:
                    d.kind === "upgrade"
                      ? "mobile.scan.limitReached"
                      : d.messageKey,
                }),
              });
              hapticWarning();
              // 401: the api interceptor ended the session; the item was
              // re-queued (not dead) and waits for the next signed-in trigger.
              if (d.status === 401 || d.status === 429) break;
            }
          }
        } finally {
          set({ flushing: false });
        }

        if (uploaded > 0) {
          queryClient.invalidateQueries({ queryKey: ["receipts"] });
          queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
        }
      },

      /**
       * Wires the automatic triggers (idempotent; returns stop()). Items left
       * "retrying" by a crash or reload go back to the queue first.
       */
      start: () => {
        if (stopTriggers) return stopTriggers;
        set({ queue: Q.resetInFlight(get().queue), flushing: false });

        const unsubNet = onNetworkChange((online) => {
          if (online) get().flush();
        });
        const unsubResume = onResume(() => get().flush());
        stopTriggers = () => {
          unsubNet();
          unsubResume();
          stopTriggers = null;
        };
        // Launch: anything due goes out right away.
        get().flush();
        return stopTriggers;
      },
    }),
    {
      name: OUTBOX_STORAGE_KEY,
      partialize: (s) => ({ queue: s.queue }),
    },
  ),
);

export default useOutboxStore;
