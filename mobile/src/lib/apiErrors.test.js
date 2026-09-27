import { describe, it, expect } from "vitest";
import { describeError, isNetworkError } from "./apiErrors.js";

const httpError = (status, data) => ({
  response: { status, data },
  config: {},
});
const t = (key, opts) =>
  opts && Object.keys(opts).length ? `${key}:${JSON.stringify(opts)}` : key;

describe("isNetworkError", () => {
  it("is true when no response came back", () => {
    expect(
      isNetworkError({ code: "ERR_NETWORK", message: "Network Error" }),
    ).toBe(true);
    expect(isNetworkError({ code: "ECONNABORTED" })).toBe(true);
    expect(isNetworkError({ request: {} })).toBe(true);
  });
  it("is false for HTTP errors", () => {
    expect(isNetworkError(httpError(500, {}))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe("describeError → kind", () => {
  it("network", () => {
    const d = describeError(
      { code: "ERR_NETWORK", message: "Network Error" },
      t,
    );
    expect(d.kind).toBe("network");
    expect(d.messageKey).toBe("mobile.common.offlineHint");
  });

  it("upgrade (403 UPGRADE_REQUIRED, ai_chat)", () => {
    const d = describeError(
      httpError(403, {
        code: "UPGRADE_REQUIRED",
        feature: "ai_chat",
        plan: "starter",
        requiredPlan: "premium",
      }),
      t,
    );
    expect(d.kind).toBe("upgrade");
    expect(d.messageKey).toBe("mobile.upsell.assistantPremium");
    expect(d.details).toMatchObject({
      feature: "ai_chat",
      plan: "starter",
      requiredPlan: "premium",
    });
  });

  it("upgrade (403 UPGRADE_REQUIRED, ai_receipts meter) carries used/limit", () => {
    const d = describeError(
      httpError(403, {
        code: "UPGRADE_REQUIRED",
        feature: "ai_receipts",
        plan: "starter",
        requiredPlan: "professional",
        limit: 10,
        used: 10,
      }),
      t,
    );
    expect(d.kind).toBe("upgrade");
    expect(d.messageKey).toBe("mobile.upsell.scansLimit");
    expect(d.details.limit).toBe(10);
    expect(d.details.used).toBe(10);
    expect(d.text).toContain('"limit":10');
  });

  it("tooLarge (413 FILE_TOO_LARGE)", () => {
    const d = describeError(
      httpError(413, { code: "FILE_TOO_LARGE", limitBytes: 10485760 }),
      t,
    );
    expect(d.kind).toBe("tooLarge");
    expect(d.details.limitBytes).toBe(10485760);
  });

  it("unsupported (415 UNSUPPORTED_TYPE)", () => {
    const d = describeError(
      httpError(415, { code: "UNSUPPORTED_TYPE", allowed: ["image/jpeg"] }),
      t,
    );
    expect(d.kind).toBe("unsupported");
    expect(d.details.allowed).toEqual(["image/jpeg"]);
  });

  it("rateLimited (429) prefers the backend text", () => {
    const d = describeError(httpError(429, { error: "Too many requests" }), t);
    expect(d.kind).toBe("rateLimited");
    expect(d.text).toBe("Too many requests");
  });

  it("conflict (409 RECEIPT_LINKED)", () => {
    const d = describeError(httpError(409, { code: "RECEIPT_LINKED" }), t);
    expect(d.kind).toBe("conflict");
    expect(d.messageKey).toBe("mobile.review.errors.alreadyLinked");
  });

  it("notFound (404)", () => {
    const d = describeError(httpError(404, { error: "Receipt not found" }), t);
    expect(d.kind).toBe("notFound");
    expect(d.text).toBe("Receipt not found");
  });

  it("validation (400) shows the backend message verbatim", () => {
    const d = describeError(
      httpError(400, { error: "A categoryId or splits[] is required" }),
      t,
    );
    expect(d.kind).toBe("validation");
    expect(d.text).toBe("A categoryId or splits[] is required");
  });

  it("unknown (500 / no data)", () => {
    expect(describeError(httpError(500, {}), t).kind).toBe("unknown");
    expect(describeError(httpError(500, {}), t).text).toBe(
      "login.genericError",
    );
    expect(describeError(httpError(401, { error: "Nope" }), t)).toMatchObject({
      kind: "unknown",
      text: "Nope",
    });
  });

  it("works without a t() function", () => {
    const d = describeError(httpError(413, { code: "FILE_TOO_LARGE" }));
    expect(d.text).toBe("mobile.scan.tooLarge");
  });
});
