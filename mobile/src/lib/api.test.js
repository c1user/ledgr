import { describe, it, expect, beforeEach, vi } from "vitest";
import { AxiosError } from "axios";
import api, {
  setAuthToken,
  getAuthToken,
  registerSessionExpiredHandler,
} from "./api.js";

// Adapter stub: resolves 2xx, rejects like axios' own adapters do for 4xx.
function stubAdapter(status, data = {}) {
  return async (config) => {
    const response = { status, data, headers: {}, config, statusText: "" };
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        {},
        response,
      );
    }
    return response;
  };
}

describe("api.js", () => {
  let expired;
  beforeEach(() => {
    expired = vi.fn();
    registerSessionExpiredHandler(expired);
    setAuthToken(null);
  });

  it("uses /api as the default base URL", () => {
    expect(api.defaults.baseURL).toBe("/api");
  });

  it("adds the Bearer header only when a token is set", async () => {
    let seen;
    api.defaults.adapter = async (config) => {
      seen = config.headers.Authorization;
      return { status: 200, data: {}, headers: {}, config };
    };
    await api.get("/meta");
    expect(seen).toBeUndefined();

    setAuthToken("abc");
    expect(getAuthToken()).toBe("abc");
    await api.get("/auth/me");
    expect(seen).toBe("Bearer abc");
  });

  it("calls the session-expired handler once on a 401 that carried a token", async () => {
    setAuthToken("dead-token");
    api.defaults.adapter = stubAdapter(401, { error: "Unauthorized" });
    await expect(api.get("/auth/me")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the handler on a 401 without a token (failed login)", async () => {
    api.defaults.adapter = stubAdapter(401, { error: "Invalid credentials" });
    await expect(
      api.post("/auth/login", { email: "a", password: "b" }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).not.toHaveBeenCalled();
  });

  it("does not call the handler for other statuses", async () => {
    setAuthToken("tok");
    api.defaults.adapter = stubAdapter(403, { code: "UPGRADE_REQUIRED" });
    await expect(api.get("/ai/conversations")).rejects.toBeTruthy();
    expect(expired).not.toHaveBeenCalled();
  });
});
