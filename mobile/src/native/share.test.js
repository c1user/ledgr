import { describe, it, expect, beforeEach, vi } from "vitest";

// Platform is mocked so the same module can be exercised as "device" and
// "web"; the plugin imports are mocked so no Capacitor code runs in node.
const platform = { native: false, ios: false };
vi.mock("./platform.js", () => ({
  isNative: () => platform.native,
  isIOS: () => platform.ios,
  toWebUrl: (p) => p,
}));

const writeMock = vi.fn(async () => ({ uri: "file:///cache/exports/x.csv" }));
const deleteMock = vi.fn(async () => {});
const rmdirMock = vi.fn(async () => {});
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    writeFile: (...args) => writeMock(...args),
    deleteFile: (...args) => deleteMock(...args),
    rmdir: (...args) => rmdirMock(...args),
  },
  Directory: { Cache: "CACHE", Data: "DATA" },
  Encoding: { UTF8: "utf8" },
}));

const shareMock = vi.fn(async () => ({ activityType: "com.google.drive" }));
const canShareMock = vi.fn(async () => ({ value: true }));
vi.mock("@capacitor/share", () => ({
  Share: {
    share: (...args) => shareMock(...args),
    canShare: (...args) => canShareMock(...args),
  },
}));

const { shareTextFile, purgeExports, isNativePlatform, EXPORTS_DIR } =
  await import("./share.js");

const TEXT = "Date,Merchant\r\n2026-10-01,Cafe\r\n";

function clipboardStub() {
  return { writeText: vi.fn(async () => {}) };
}

function webDeps() {
  const anchor = { click: vi.fn(), style: {} };
  const doc = {
    createElement: vi.fn(() => anchor),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  };
  const win = {
    URL: {
      createObjectURL: vi.fn(() => "blob:abaco/1"),
      revokeObjectURL: vi.fn(),
    },
  };
  return { deps: { doc, win, clipboard: clipboardStub() }, anchor, doc, win };
}

beforeEach(() => {
  platform.native = false;
  platform.ios = false;
  writeMock.mockClear();
  writeMock.mockImplementation(async () => ({
    uri: "file:///cache/exports/x.csv",
  }));
  deleteMock.mockClear();
  deleteMock.mockImplementation(async () => {});
  rmdirMock.mockClear();
  rmdirMock.mockImplementation(async () => {});
  shareMock.mockClear();
  shareMock.mockImplementation(async () => ({ activityType: "com.x" }));
  canShareMock.mockClear();
  canShareMock.mockImplementation(async () => ({ value: true }));
});

describe("native/share isNativePlatform()", () => {
  it("mirrors platform.isNative()", () => {
    platform.native = false;
    expect(isNativePlatform()).toBe(false);
    platform.native = true;
    expect(isNativePlatform()).toBe(true);
  });
});

describe("native/share shareTextFile() on a device", () => {
  beforeEach(() => {
    platform.native = true;
  });

  it("writes to exports/ in the cache, shares the uri, then deletes the file", async () => {
    const deps = { clipboard: clipboardStub() };
    const result = await shareTextFile(
      { filename: "x.csv", text: TEXT, title: "Export transactions" },
      deps,
    );
    expect(result).toBe("shared");
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith({
      path: `${EXPORTS_DIR}/x.csv`,
      data: TEXT,
      directory: "CACHE",
      encoding: "utf8",
      recursive: true,
    });
    expect(shareMock).toHaveBeenCalledWith({
      title: "x.csv",
      files: ["file:///cache/exports/x.csv"],
      dialogTitle: "Export transactions",
    });
    expect(deleteMock).toHaveBeenCalledWith({
      path: "exports/x.csv",
      directory: "CACHE",
    });
    expect(deps.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("uses the file name as the dialog title when none is given", async () => {
    await shareTextFile({ filename: "y.csv", text: TEXT });
    expect(shareMock.mock.calls[0][0].dialogTitle).toBe("y.csv");
  });

  it("reports a dismissed share sheet as cancelled and still cleans up", async () => {
    shareMock.mockImplementation(async () => {
      throw new Error("Share canceled");
    });
    const deps = { clipboard: clipboardStub() };
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, deps),
    ).resolves.toBe("cancelled");
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deps.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("treats any resolved share as shared, even without an activityType (the plugin rejects on cancel)", async () => {
    platform.ios = true;
    shareMock.mockImplementation(async () => ({}));
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, {}),
    ).resolves.toBe("shared");
    shareMock.mockImplementation(async () => ({ activityType: "" }));
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, {}),
    ).resolves.toBe("shared");
    platform.ios = false;
    shareMock.mockImplementation(async () => undefined);
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, {}),
    ).resolves.toBe("shared");
  });

  it("reports the iOS cancel rejection as cancelled too", async () => {
    platform.ios = true;
    shareMock.mockImplementation(async () => {
      throw new Error("Share canceled");
    });
    const deps = { clipboard: clipboardStub() };
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, deps),
    ).resolves.toBe("cancelled");
    expect(deps.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the share call fails for another reason", async () => {
    shareMock.mockImplementation(async () => {
      throw new Error("not implemented on android");
    });
    const deps = { clipboard: clipboardStub() };
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, deps),
    ).resolves.toBe("copied");
    expect(deps.clipboard.writeText).toHaveBeenCalledWith(TEXT);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the clipboard when canShare() says no", async () => {
    canShareMock.mockImplementation(async () => ({ value: false }));
    const deps = { clipboard: clipboardStub() };
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, deps),
    ).resolves.toBe("copied");
    expect(shareMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the clipboard when the file cannot be written", async () => {
    writeMock.mockImplementation(async () => {
      throw new Error("Directory.Data not allowed");
    });
    const deps = { clipboard: clipboardStub() };
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, deps),
    ).resolves.toBe("copied");
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("rethrows the share failure when the clipboard is unavailable too", async () => {
    const boom = new Error("share exploded");
    shareMock.mockImplementation(async () => {
      throw boom;
    });
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, { clipboard: null }),
    ).rejects.toBe(boom);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("never writes or shares on the web branch", async () => {
    platform.native = false;
    const { deps } = webDeps();
    await shareTextFile({ filename: "x.csv", text: TEXT }, deps);
    expect(writeMock).not.toHaveBeenCalled();
    expect(shareMock).not.toHaveBeenCalled();
  });
});

describe("native/share shareTextFile() on the web", () => {
  it("downloads through a hidden anchor and revokes the object URL", async () => {
    const { deps, anchor, doc, win } = webDeps();
    const result = await shareTextFile(
      { filename: "abaco-main-2026-10.csv", text: TEXT },
      deps,
    );
    expect(result).toBe("downloaded");
    expect(doc.createElement).toHaveBeenCalledWith("a");
    expect(anchor.download).toBe("abaco-main-2026-10.csv");
    expect(anchor.href).toBe("blob:abaco/1");
    expect(anchor.style.display).toBe("none");
    expect(doc.body.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(doc.body.removeChild).toHaveBeenCalledWith(anchor);
    expect(win.URL.revokeObjectURL).toHaveBeenCalledWith("blob:abaco/1");
    expect(deps.clipboard.writeText).not.toHaveBeenCalled();
    const blob = win.URL.createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe(TEXT);
  });

  it("falls back to the clipboard without a DOM", async () => {
    const clipboard = clipboardStub();
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, { clipboard }),
    ).resolves.toBe("copied");
    expect(clipboard.writeText).toHaveBeenCalledWith(TEXT);
  });

  it("rejects when neither a DOM nor a clipboard is available", async () => {
    await expect(
      shareTextFile({ filename: "x.csv", text: TEXT }, {}),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("native/share purgeExports()", () => {
  it("is a no-op on the web", async () => {
    platform.native = false;
    await expect(purgeExports()).resolves.toBe(false);
    expect(rmdirMock).not.toHaveBeenCalled();
  });

  it("removes exports/ from the cache on a device", async () => {
    platform.native = true;
    await expect(purgeExports()).resolves.toBe(true);
    expect(rmdirMock).toHaveBeenCalledWith({
      path: "exports",
      directory: "CACHE",
      recursive: true,
    });
  });

  it("never throws when the folder is missing", async () => {
    platform.native = true;
    rmdirMock.mockImplementation(async () => {
      throw new Error("Folder does not exist.");
    });
    await expect(purgeExports()).resolves.toBe(false);
  });
});
