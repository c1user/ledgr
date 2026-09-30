import { describe, it, expect, beforeEach, vi } from "vitest";

// Platform is mocked so the same module can be exercised as "device" and
// "web"; the plugin import is mocked so no Capacitor code runs in node.
const platform = { native: false };
vi.mock("./platform.js", () => ({
  isNative: () => platform.native,
  toWebUrl: (p) => p,
}));

const hideMock = vi.fn(async () => {});
vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: { hide: (...args) => hideMock(...args) },
}));

const { hide, _reset, FADE_OUT_MS } = await import("./splash.js");

describe("native/splash hide()", () => {
  beforeEach(() => {
    _reset();
    hideMock.mockClear();
    hideMock.mockImplementation(async () => {});
  });

  it("is a no-op on the web", async () => {
    platform.native = false;
    expect(await hide()).toBe(false);
    expect(hideMock).not.toHaveBeenCalled();
  });

  it("hides the native splash once with a fade, then ignores repeats", async () => {
    platform.native = true;
    expect(await hide()).toBe(true);
    expect(await hide()).toBe(false);
    expect(await hide()).toBe(false);
    expect(hideMock).toHaveBeenCalledTimes(1);
    expect(hideMock).toHaveBeenCalledWith({ fadeOutDuration: FADE_OUT_MS });
  });

  it("never throws when the plugin rejects", async () => {
    platform.native = true;
    hideMock.mockImplementation(async () => {
      throw new Error("not implemented");
    });
    await expect(hide()).resolves.toBe(false);
  });
});
