// Offline outbox — PURE queue logic (ROADMAP-V6 2.11). No I/O, no React, no
// storage: every function takes a queue (array of items) and returns a new
// one. store/outboxStore.js owns persistence, the captured blobs and the
// actual uploads; this module decides WHAT is retried and WHEN.
//
// Item shape (metadata only — the blob lives in native/outbox.js storage):
//   {
//     id:            string   uuid; also the blob's storage key
//     filename:      string   "receipt-<iso>.jpg"
//     mimeType:      string   "image/jpeg" | …
//     size:          number   bytes (informational)
//     idempotencyKey:string   sent as a multipart text field on every attempt
//     ownerId:       string | null   user id that captured it (never uploaded
//                             under another account's token)
//     createdAt:     number   epoch ms
//     status:        "queued" | "retrying" | "dead"
//     attempts:      number   failed attempts so far
//     lastAttemptAt: number | null
//     nextAttemptAt: number | null   epoch ms; null = as soon as possible
//     lastError:     { status: number|null, messageKey: string|null } | null
//   }
//
// Rules (owner decisions):
//   - cap 50 items (enqueue on a full queue returns the SAME array);
//   - exponential backoff on network / 5xx failures: 30 s, 1 min, 2 min, …
//     capped at 30 min;
//   - a 4xx is final ("dead"): it will never be retried automatically nor by
//     "Retry now" — the user discards it. EXCEPT 401: that means the session
//     ended (exp passed, "Sign out everywhere"), not that the capture is bad —
//     the item stays queued (with backoff) and goes out after the next login.
//   - items are stamped with the account that captured them (ownerId); the
//     store never uploads an item under a different user's token.

export const OUTBOX_MAX = 50;
export const BASE_DELAY_MS = 30 * 1000;
export const MAX_DELAY_MS = 30 * 60 * 1000;

export const STATUS = Object.freeze({
  QUEUED: "queued",
  RETRYING: "retrying",
  DEAD: "dead",
});

const isClientError = (status) =>
  Number.isInteger(status) && status >= 400 && status < 500 && status !== 401;

/** Backoff delay (ms) after `attempts` failures: 30 s · 2^(attempts-1), capped. */
export function backoffDelay(attempts) {
  const n = Math.max(1, attempts | 0);
  return Math.min(BASE_DELAY_MS * 2 ** (n - 1), MAX_DELAY_MS);
}

export const isFull = (queue) => queue.length >= OUTBOX_MAX;

/**
 * createItem(meta, now) → item. `id` and `idempotencyKey` default to the
 * same uuid so a retried upload can be de-duplicated server-side later.
 */
export function createItem(
  { id, filename, mimeType, size, idempotencyKey, ownerId },
  now = Date.now(),
) {
  const key = id || randomId();
  return {
    id: key,
    filename: filename || `receipt-${new Date(now).toISOString()}.jpg`,
    mimeType: mimeType || "image/jpeg",
    size: Number(size) || 0,
    idempotencyKey: idempotencyKey || key,
    ownerId: ownerId ?? null,
    createdAt: now,
    status: STATUS.QUEUED,
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
  };
}

/** Appends `item`; returns the SAME array when the queue is full. */
export function enqueue(queue, item) {
  if (isFull(queue)) return queue;
  if (queue.some((q) => q.id === item.id)) return queue;
  return [...queue, item];
}

export const remove = (queue, id) => queue.filter((q) => q.id !== id);

export const removeDead = (queue) =>
  queue.filter((q) => q.status !== STATUS.DEAD);

const patch = (queue, id, fn) =>
  queue.map((q) => (q.id === id ? { ...q, ...fn(q) } : q));

/** An upload attempt has started. */
export function markRetrying(queue, id, now = Date.now()) {
  return patch(queue, id, () => ({
    status: STATUS.RETRYING,
    lastAttemptAt: now,
  }));
}

/**
 * The attempt failed. `status` is the HTTP status (null for a network error).
 *   4xx (not 401) → dead (never retried)
 *   401 / others  → queued again with exponential backoff
 */
export function markFailed(
  queue,
  id,
  { status = null, messageKey = null } = {},
  now = Date.now(),
) {
  return patch(queue, id, (q) => {
    const attempts = q.attempts + 1;
    const lastError = { status, messageKey };
    if (isClientError(status)) {
      return {
        status: STATUS.DEAD,
        attempts,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastError,
      };
    }
    return {
      status: STATUS.QUEUED,
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: now + backoffDelay(attempts),
      lastError,
    };
  });
}

/**
 * An item is retryable when it is not dead and not already in flight.
 * With force=false it must also have reached its nextAttemptAt.
 */
export function isRetryable(item, now = Date.now(), { force = false } = {}) {
  if (!item || item.status !== STATUS.QUEUED) return false;
  if (force) return true;
  return item.nextAttemptAt == null || item.nextAttemptAt <= now;
}

/** Oldest retryable item, or null. */
export function nextRetryable(queue, now = Date.now(), opts) {
  const due = queue
    .filter((q) => isRetryable(q, now, opts))
    .sort((a, b) => a.createdAt - b.createdAt);
  return due[0] || null;
}

/**
 * Items the signed-in user `userId` may upload: their own plus legacy items
 * with no owner stamp. Another account's captures are never sent.
 */
export const ownedBy = (queue, userId) =>
  queue.filter((q) => !q.ownerId || q.ownerId === userId);

/** Items captured by a different account than `userId` (shared device). */
export const foreignItems = (queue, userId) =>
  queue.filter((q) => !!q.ownerId && q.ownerId !== userId);

/** Items that still want to upload (queued or in flight) — the badge count. */
export const liveItems = (queue) =>
  queue.filter((q) => q.status !== STATUS.DEAD);

export const deadItems = (queue) =>
  queue.filter((q) => q.status === STATUS.DEAD);

/** Anything left "retrying" by a crash/reload goes back to queued. */
export function resetInFlight(queue) {
  return queue.map((q) =>
    q.status === STATUS.RETRYING ? { ...q, status: STATUS.QUEUED } : q,
  );
}

/** A fresh id (uuid when available) — item ids and idempotency keys. */
export function newId() {
  return randomId();
}

function randomId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for very old WebViews: time + random, still unique enough for a
  // per-device queue of ≤ 50 items.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
