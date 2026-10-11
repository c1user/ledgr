import { describe, it, expect, vi } from "vitest";

vi.mock("../native/appLifecycle.js", () => ({ minimize: vi.fn() }));

const { handleBackButton, ROOT_PATHS, sectionRoot } =
  await import("./backButton.js");

/** Account ids are UUIDs; the router treats them as opaque segments. */
const ACCOUNT_ID = "8f0c2b1e-5d7a-4c3b-9e2f-1a6b7c8d9e0f";

/** Minimal window/document doubles for the node test environment. */
function fakeEnv({ pathname = "/scan", dialog = false, histLen = 4 } = {}) {
  const dispatched = [];
  const backs = [];
  class KeyboardEvent {
    constructor(type, init) {
      this.type = type;
      this.key = init?.key;
      this.bubbles = !!init?.bubbles;
    }
  }
  const doc = {
    querySelector: (sel) =>
      dialog && sel.includes('role="dialog"') ? { tagName: "DIV" } : null,
    dispatchEvent: (e) => dispatched.push(e),
  };
  const win = {
    KeyboardEvent,
    location: { pathname },
    history: { length: histLen, back: () => backs.push(1) },
  };
  return { doc, win, dispatched, backs };
}

describe("handleBackButton", () => {
  it("closes an open sheet with Escape and touches nothing else", () => {
    const env = fakeEnv({ pathname: "/scan", dialog: true });
    const minimize = vi.fn();
    const r = handleBackButton({ ...env, minimize });
    expect(r).toBe("dialog");
    expect(env.dispatched.map((e) => e.key)).toEqual(["Escape"]);
    expect(env.backs).toHaveLength(0);
    expect(minimize).not.toHaveBeenCalled();
  });

  it("minimises on every tab root, the login and update screens", () => {
    for (const path of ROOT_PATHS) {
      const env = fakeEnv({ pathname: path });
      const minimize = vi.fn();
      expect(handleBackButton({ ...env, minimize })).toBe("minimize");
      expect(minimize).toHaveBeenCalledTimes(1);
      expect(env.backs).toHaveLength(0);
    }
  });

  it("goes one step back from a nested screen, ignoring the WebView's canGoBack", () => {
    const env = fakeEnv({ pathname: "/receipts/abc/review" });
    const minimize = vi.fn();
    expect(handleBackButton({ ...env, minimize })).toBe("back");
    expect(env.backs).toHaveLength(1);
    expect(minimize).not.toHaveBeenCalled();
  });

  it("routes to the section root when there is no history (cold start into a nested route)", () => {
    const env = fakeEnv({ pathname: "/receipts/abc", histLen: 1 });
    const minimize = vi.fn();
    const navigate = vi.fn();
    expect(handleBackButton({ ...env, minimize, navigate })).toBe("root");
    expect(navigate).toHaveBeenCalledWith("/receipts", { replace: true });
    expect(env.backs).toHaveLength(0);
    expect(minimize).not.toHaveBeenCalled();
  });

  it("minimises instead when no router is available and there is no history", () => {
    const env = fakeEnv({ pathname: "/receipts/abc", histLen: 1 });
    const minimize = vi.fn();
    expect(handleBackButton({ ...env, minimize })).toBe("minimize");
  });

  it("tolerates a trailing slash", () => {
    const env = fakeEnv({ pathname: "/settings/" });
    const minimize = vi.fn();
    expect(handleBackButton({ ...env, minimize })).toBe("minimize");
  });

  it("derives section roots", () => {
    expect(sectionRoot("/receipts/abc/review")).toBe("/receipts");
    expect(sectionRoot("/settings")).toBe("/settings");
    expect(sectionRoot("/")).toBe("/scan");
    expect(sectionRoot(`/accounts/${ACCOUNT_ID}/import`)).toBe("/accounts");
  });

  describe("Accounts tab (ROADMAP-V6 2.15)", () => {
    it("minimises on the Accounts tab root", () => {
      expect(ROOT_PATHS.has("/accounts")).toBe(true);
      const env = fakeEnv({ pathname: "/accounts" });
      const minimize = vi.fn();
      expect(handleBackButton({ ...env, minimize })).toBe("minimize");
      expect(minimize).toHaveBeenCalledTimes(1);
      expect(env.backs).toHaveLength(0);
    });

    it("goes one step back from an account detail that has history", () => {
      const env = fakeEnv({ pathname: `/accounts/${ACCOUNT_ID}` });
      const minimize = vi.fn();
      const navigate = vi.fn();
      expect(handleBackButton({ ...env, minimize, navigate })).toBe("back");
      expect(env.backs).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(minimize).not.toHaveBeenCalled();
    });

    it("routes a cold start into the CSV import to the Accounts tab", () => {
      const env = fakeEnv({
        pathname: `/accounts/${ACCOUNT_ID}/import`,
        histLen: 1,
      });
      const minimize = vi.fn();
      const navigate = vi.fn();
      expect(handleBackButton({ ...env, minimize, navigate })).toBe("root");
      expect(navigate).toHaveBeenCalledWith("/accounts", { replace: true });
      expect(env.backs).toHaveLength(0);
      expect(minimize).not.toHaveBeenCalled();
    });
  });

  it("is a no-op without a DOM", () => {
    expect(handleBackButton({ doc: null, win: null })).toBe("none");
  });
});
