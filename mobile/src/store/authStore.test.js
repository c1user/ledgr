import { describe, it, expect, beforeEach, vi } from "vitest";
import { AxiosError } from "axios";

// Secure storage is mocked with an in-memory map so the test never touches
// localStorage (absent in node) or the native plugin.
const mem = new Map();
vi.mock("../lib/secureStore.js", () => ({
  getToken: vi.fn(async () => mem.get("token") ?? null),
  setToken: vi.fn(async (t) => void mem.set("token", t)),
  clearToken: vi.fn(async () => void mem.delete("token")),
}));
vi.mock("../i18n.js", () => ({ setAppLanguage: vi.fn(), default: {} }));

const api = (await import("../lib/api.js")).default;
const { getAuthToken } = await import("../lib/api.js");
const useAuthStore = (await import("./authStore.js")).default;
const { clearToken } = await import("../lib/secureStore.js");

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const token = (exp) => `h.${b64url({ id: 1, exp })}.s`;
const now = () => Math.floor(Date.now() / 1000);

// Route-based adapter: { "GET /meta": [status, data], ... }
function routes(table) {
  return async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url}`;
    const entry = table[key];
    if (!entry) throw new Error(`unexpected request ${key}`);
    if (entry === "network") {
      throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
    }
    const [status, data] = entry;
    const response = { status, data, headers: {}, config };
    if (status >= 400) {
      throw new AxiosError(
        "fail",
        AxiosError.ERR_BAD_REQUEST,
        config,
        {},
        response,
      );
    }
    return response;
  };
}

const ME = {
  user: { id: 1, name: "Ana", email: "ana@x.test", language: "es" },
  business: { id: 7, name: "El Fogón", plan: "premium" },
};

describe("authStore.hydrate", () => {
  beforeEach(() => {
    mem.clear();
    vi.clearAllMocks();
    useAuthStore.setState({
      status: "booting",
      user: null,
      business: null,
      stale: false,
      expiredReason: null,
      updateRequired: false,
    });
  });

  it("no token → anon", async () => {
    api.defaults.adapter = routes({
      "GET /meta": [200, { minMobileBuild: 0 }],
    });
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe("anon");
    expect(getAuthToken()).toBeNull();
  });

  it("expired token → expired and the token is cleared", async () => {
    mem.set("token", token(now() - 100));
    api.defaults.adapter = routes({
      "GET /meta": [200, { minMobileBuild: 0 }],
    });
    await useAuthStore.getState().hydrate();
    const s = useAuthStore.getState();
    expect(s.status).toBe("expired");
    expect(s.expiredReason).toBe("expired");
    expect(clearToken).toHaveBeenCalled();
    expect(mem.has("token")).toBe(false);
    expect(getAuthToken()).toBeNull();
  });

  it("valid token + /auth/me → authed with user and business", async () => {
    mem.set("token", token(now() + 6 * 86400));
    api.defaults.adapter = routes({
      "GET /meta": [200, { minMobileBuild: 0 }],
      "GET /auth/me": [200, ME],
    });
    await useAuthStore.getState().hydrate();
    const s = useAuthStore.getState();
    expect(s.status).toBe("authed");
    expect(s.stale).toBe(false);
    expect(s.user.email).toBe("ana@x.test");
    expect(s.business.plan).toBe("premium");
    expect(s.expiresSoon).toBe(false);
    expect(getAuthToken()).toBe(mem.get("token"));
  });

  it("valid token but /auth/me 401 → expired (token_version bumped)", async () => {
    mem.set("token", token(now() + 86400));
    api.defaults.adapter = routes({
      "GET /meta": [200, { minMobileBuild: 0 }],
      "GET /auth/me": [401, { error: "Unauthorized" }],
    });
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe("expired");
    expect(mem.has("token")).toBe(false);
    expect(getAuthToken()).toBeNull();
  });

  it("valid token, network down → authed + stale, token kept", async () => {
    const t = token(now() + 3600); // also inside the 24 h warning window
    mem.set("token", t);
    api.defaults.adapter = routes({
      "GET /meta": "network",
      "GET /auth/me": "network",
    });
    await useAuthStore.getState().hydrate();
    const s = useAuthStore.getState();
    expect(s.status).toBe("authed");
    expect(s.stale).toBe(true);
    expect(s.expiresSoon).toBe(true);
    expect(getAuthToken()).toBe(t);
    expect(mem.get("token")).toBe(t);
  });

  it("is idempotent while in flight (StrictMode double effect)", async () => {
    mem.set("token", token(now() + 86400));
    const me = vi.fn(async () => ME);
    api.defaults.adapter = async (config) => {
      if (config.url === "/auth/me") {
        return { status: 200, data: await me(), headers: {}, config };
      }
      return { status: 200, data: { minMobileBuild: 0 }, headers: {}, config };
    };
    const a = useAuthStore.getState().hydrate();
    const b = useAuthStore.getState().hydrate();
    expect(a).toBe(b);
    await a;
    expect(me).toHaveBeenCalledTimes(1);
  });
});

describe("authStore session methods", () => {
  beforeEach(() => {
    mem.clear();
    api.defaults.adapter = routes({ "POST /auth/logout-all": [200, {}] });
  });

  it("signIn stores the token and flips to authed", async () => {
    const t = token(now() + 86400 * 7);
    await useAuthStore.getState().signIn({ token: t, ...ME });
    expect(useAuthStore.getState().status).toBe("authed");
    expect(mem.get("token")).toBe(t);
    expect(getAuthToken()).toBe(t);
  });

  it("a 401 on any authenticated request expires the session", async () => {
    await useAuthStore
      .getState()
      .signIn({ token: token(now() + 86400), ...ME });
    api.defaults.adapter = routes({ "GET /receipts": [401, {}] });
    await expect(api.get("/receipts")).rejects.toBeTruthy();
    expect(useAuthStore.getState().status).toBe("expired");
    expect(getAuthToken()).toBeNull();
  });

  it("signOutEverywhere posts logout-all then clears", async () => {
    await useAuthStore
      .getState()
      .signIn({ token: token(now() + 86400), ...ME });
    await useAuthStore.getState().signOutEverywhere();
    expect(useAuthStore.getState().status).toBe("anon");
    expect(mem.has("token")).toBe(false);
  });
});
