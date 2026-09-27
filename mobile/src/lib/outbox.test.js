import { describe, it, expect } from "vitest";
import {
  OUTBOX_MAX,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  STATUS,
  backoffDelay,
  createItem,
  enqueue,
  isFull,
  remove,
  removeDead,
  markRetrying,
  markFailed,
  isRetryable,
  nextRetryable,
  liveItems,
  deadItems,
  resetInFlight,
  ownedBy,
  foreignItems,
} from "./outbox.js";

const T0 = 1_700_000_000_000;
const item = (n, over = {}) => ({
  ...createItem(
    { id: `id-${n}`, filename: `r-${n}.jpg`, mimeType: "image/jpeg", size: 10 },
    T0 + n,
  ),
  ...over,
});

describe("createItem", () => {
  it("fills defaults and reuses the id as the idempotency key", () => {
    const it0 = createItem({ filename: "a.jpg", size: "123" }, T0);
    expect(it0.id).toBeTruthy();
    expect(it0.idempotencyKey).toBe(it0.id);
    expect(it0.size).toBe(123);
    expect(it0.mimeType).toBe("image/jpeg");
    expect(it0.status).toBe(STATUS.QUEUED);
    expect(it0.attempts).toBe(0);
    expect(it0.nextAttemptAt).toBeNull();
    expect(it0.createdAt).toBe(T0);
    expect(it0.ownerId).toBeNull();
  });

  it("keeps an explicit id / key / owner", () => {
    const it0 = createItem({ id: "x", idempotencyKey: "k", ownerId: "u1" }, T0);
    expect(it0.id).toBe("x");
    expect(it0.idempotencyKey).toBe("k");
    expect(it0.ownerId).toBe("u1");
  });
});

describe("ownership (shared device)", () => {
  const q = [
    item(1, { ownerId: "a" }),
    item(2, { ownerId: "b" }),
    item(3), // legacy item, no stamp
  ];

  it("ownedBy keeps the user's own items plus unstamped ones", () => {
    expect(ownedBy(q, "a").map((x) => x.id)).toEqual(["id-1", "id-3"]);
    expect(ownedBy(q, "b").map((x) => x.id)).toEqual(["id-2", "id-3"]);
    // Unknown user: only unstamped items are eligible.
    expect(ownedBy(q, null).map((x) => x.id)).toEqual(["id-3"]);
  });

  it("foreignItems lists the other accounts' captures", () => {
    expect(foreignItems(q, "a").map((x) => x.id)).toEqual(["id-2"]);
    expect(foreignItems(q, "zzz").map((x) => x.id)).toEqual(["id-1", "id-2"]);
  });

  it("nextRetryable over ownedBy never picks another account's item", () => {
    expect(nextRetryable(ownedBy(q, "b"), T0 + 10).id).toBe("id-2");
    expect(nextRetryable(ownedBy([q[0]], "b"), T0 + 10)).toBeNull();
  });
});

describe("enqueue / remove", () => {
  it("appends and never mutates the input", () => {
    const q0 = [];
    const q1 = enqueue(q0, item(1));
    expect(q0).toEqual([]);
    expect(q1).toHaveLength(1);
  });

  it("ignores duplicate ids", () => {
    const q1 = enqueue([], item(1));
    expect(enqueue(q1, item(1))).toBe(q1);
  });

  it("caps at OUTBOX_MAX and returns the same array when full", () => {
    let q = [];
    for (let i = 0; i < OUTBOX_MAX; i++) q = enqueue(q, item(i));
    expect(q).toHaveLength(OUTBOX_MAX);
    expect(isFull(q)).toBe(true);
    const rejected = enqueue(q, item(999));
    expect(rejected).toBe(q);
    expect(rejected).toHaveLength(OUTBOX_MAX);
  });

  it("remove drops one id; removeDead drops only dead items", () => {
    let q = [item(1), item(2), item(3)];
    q = markFailed(q, "id-2", { status: 415 }, T0);
    expect(remove(q, "id-1").map((x) => x.id)).toEqual(["id-2", "id-3"]);
    expect(removeDead(q).map((x) => x.id)).toEqual(["id-1", "id-3"]);
  });
});

describe("backoff", () => {
  it("doubles from 30 s and caps at 30 min", () => {
    expect(backoffDelay(1)).toBe(BASE_DELAY_MS);
    expect(backoffDelay(2)).toBe(BASE_DELAY_MS * 2);
    expect(backoffDelay(3)).toBe(BASE_DELAY_MS * 4);
    expect(backoffDelay(20)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(0)).toBe(BASE_DELAY_MS);
  });

  it("markFailed on a network error schedules the next attempt", () => {
    let q = markRetrying([item(1)], "id-1", T0);
    expect(q[0].status).toBe(STATUS.RETRYING);
    expect(q[0].lastAttemptAt).toBe(T0);

    q = markFailed(q, "id-1", { status: null }, T0);
    expect(q[0].status).toBe(STATUS.QUEUED);
    expect(q[0].attempts).toBe(1);
    expect(q[0].nextAttemptAt).toBe(T0 + BASE_DELAY_MS);
    expect(q[0].lastError).toEqual({ status: null, messageKey: null });

    q = markFailed(q, "id-1", { status: 503 }, T0 + 60_000);
    expect(q[0].attempts).toBe(2);
    expect(q[0].nextAttemptAt).toBe(T0 + 60_000 + BASE_DELAY_MS * 2);
  });

  it("caps the delay after many failures", () => {
    let q = [item(1)];
    for (let i = 0; i < 15; i++) q = markFailed(q, "id-1", { status: 500 }, T0);
    expect(q[0].nextAttemptAt).toBe(T0 + MAX_DELAY_MS);
  });
});

describe("4xx is final", () => {
  it.each([400, 403, 413, 415, 429])(
    "%s → dead, never retryable (even forced)",
    (status) => {
      const q = markFailed([item(1)], "id-1", { status }, T0);
      expect(q[0].status).toBe(STATUS.DEAD);
      expect(q[0].nextAttemptAt).toBeNull();
      expect(q[0].lastError.status).toBe(status);
      expect(isRetryable(q[0], T0 + 1e9)).toBe(false);
      expect(isRetryable(q[0], T0 + 1e9, { force: true })).toBe(false);
      expect(nextRetryable(q, T0 + 1e9, { force: true })).toBeNull();
    },
  );

  it.each([500, 502, 503, null])("%s → still queued", (status) => {
    const q = markFailed([item(1)], "id-1", { status }, T0);
    expect(q[0].status).toBe(STATUS.QUEUED);
    expect(isRetryable(q[0], T0 + MAX_DELAY_MS)).toBe(true);
  });

  it("401 means the session ended, not a bad capture → stays queued", () => {
    const q = markFailed(
      [item(1)],
      "id-1",
      { status: 401, messageKey: "login.genericError" },
      T0,
    );
    expect(q[0].status).toBe(STATUS.QUEUED);
    expect(q[0].attempts).toBe(1);
    expect(q[0].nextAttemptAt).toBe(T0 + BASE_DELAY_MS);
    expect(q[0].lastError.status).toBe(401);
    expect(deadItems(q)).toEqual([]);
    // Not due yet, but "Retry now" (after re-login) may send it.
    expect(isRetryable(q[0], T0 + 1)).toBe(false);
    expect(isRetryable(q[0], T0 + 1, { force: true })).toBe(true);
    expect(isRetryable(q[0], T0 + BASE_DELAY_MS)).toBe(true);
  });

  it("keeps the messageKey for the UI", () => {
    const q = markFailed(
      [item(1)],
      "id-1",
      { status: 413, messageKey: "mobile.scan.tooLarge" },
      T0,
    );
    expect(q[0].lastError.messageKey).toBe("mobile.scan.tooLarge");
  });
});

describe("nextRetryable", () => {
  it("returns the oldest due item and skips waiting / in-flight / dead ones", () => {
    let q = [item(3), item(1), item(2), item(4), item(5)];
    q = markFailed(q, "id-1", { status: null }, T0); // waits 30 s
    q = markRetrying(q, "id-2", T0); // in flight
    q = markFailed(q, "id-4", { status: 415 }, T0); // dead

    // id-3 (createdAt T0+3) is older than id-5 → picked first.
    expect(nextRetryable(q, T0 + 1).id).toBe("id-3");
    // id-1 becomes due once its backoff elapsed.
    q = remove(remove(q, "id-3"), "id-5");
    expect(nextRetryable(q, T0 + 1)).toBeNull();
    expect(nextRetryable(q, T0 + BASE_DELAY_MS).id).toBe("id-1");
  });

  it("force ignores backoff but not dead / in-flight state", () => {
    let q = [item(1), item(2), item(3)];
    q = markFailed(q, "id-1", { status: null }, T0);
    q = markRetrying(q, "id-2", T0);
    q = markFailed(q, "id-3", { status: 403 }, T0);
    expect(nextRetryable(q, T0 + 1)).toBeNull();
    expect(nextRetryable(q, T0 + 1, { force: true }).id).toBe("id-1");
  });

  it("an empty queue yields null", () => {
    expect(nextRetryable([], T0)).toBeNull();
  });
});

describe("live / dead / resetInFlight", () => {
  it("counts live items (queued + retrying) for the badge", () => {
    let q = [item(1), item(2), item(3)];
    q = markRetrying(q, "id-2", T0);
    q = markFailed(q, "id-3", { status: 400 }, T0);
    expect(liveItems(q).map((x) => x.id)).toEqual(["id-1", "id-2"]);
    expect(deadItems(q).map((x) => x.id)).toEqual(["id-3"]);
  });

  it("resetInFlight re-queues items left retrying by a reload", () => {
    let q = markRetrying([item(1), item(2)], "id-1", T0);
    q = resetInFlight(q);
    expect(q.every((x) => x.status === STATUS.QUEUED)).toBe(true);
    expect(nextRetryable(q, T0).id).toBe("id-1");
  });
});
