import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { HEX } from "@abaco/tokens/brand.js";
import {
  ANDROID_ADAPTIVE_FILES,
  ANDROID_ADAPTIVE_PX,
  COLORS,
  render,
  renderForeground,
  renderBackground,
  renderSplash,
} from "./generate-icons.mjs";

// Minimal decoder for the PNGs this script writes (8-bit RGBA, filter 0).
function decode(png) {
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  let off = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const px = (x, y) => {
    expect(raw[y * stride]).toBe(0); // filter byte
    const i = y * stride + 1 + x * 4;
    return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
  };
  return { width, height, px };
}

const hex = (rgb) =>
  "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

describe("generate-icons colours", () => {
  it("come from @abaco/tokens/brand.js", () => {
    expect(hex(COLORS.BG)).toBe(HEX.brand);
    expect(hex(COLORS.ROD)).toBe(HEX.brandHover);
    expect(hex(COLORS.ACCENT)).toBe(HEX.accent);
    expect(hex(COLORS.CANVAS_LIGHT)).toBe(HEX.canvasLight);
    expect(hex(COLORS.CANVAS_DARK)).toBe(HEX.canvasDark);
  });
});

describe("mobile sources (ROADMAP-V6 1.9)", () => {
  it("icon-only: 1024, full-bleed plum with the mark inside", () => {
    const { width, height, px } = decode(render(1024, { maskable: true }));
    expect([width, height]).toEqual([1024, 1024]);
    expect(px(2, 2)).toEqual([...COLORS.BG, 255]); // corner is plum, opaque
    expect(px(512, 512)).toEqual([...COLORS.BEAD, 255]); // centre bead
  });

  it("icon-foreground: transparent outside the mark, mark inside the safe circle", () => {
    const { width, px } = decode(renderForeground(1024));
    expect(width).toBe(1024);
    expect(px(2, 2)[3]).toBe(0);
    expect(px(512, 20)[3]).toBe(0); // top edge clear
    expect(px(512, 512)).toEqual([...COLORS.BEAD, 255]);
    expect(px(Math.round(0.2 * 1024), 512)[3]).toBe(255); // rod reaches 0.17
    // The PNG is the 72 dp viewport; launcher masks keep a 66 dp circle, i.e.
    // radius 0.458 of the width. Nothing may sit on or beyond that ring.
    const r = 0.46 * 1024;
    for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const x = Math.round(512 + r * Math.cos((a * Math.PI) / 180));
      const y = Math.round(512 + r * Math.sin((a * Math.PI) / 180));
      expect(px(x, y)[3], `ring at ${a}°`).toBe(0);
    }
  });

  it("android adaptive layers: 108 dp per density, same viewport geometry", () => {
    expect(ANDROID_ADAPTIVE_PX).toEqual({
      ldpi: 81,
      mdpi: 108,
      hdpi: 162,
      xhdpi: 216,
      xxhdpi: 324,
      xxxhdpi: 432,
    });
    const files = ANDROID_ADAPTIVE_FILES();
    expect(files.map(([name]) => name)).toContain(
      "mipmap-xxxhdpi/ic_launcher_foreground.png",
    );
    const fg = decode(
      files.find(([n]) => n === "mipmap-xxxhdpi/ic_launcher_foreground.png")[1],
    );
    expect(fg.width).toBe(432);
    expect(fg.px(216, 216)).toEqual([...COLORS.BEAD, 255]);
    const bg = decode(
      files.find(([n]) => n === "mipmap-mdpi/ic_launcher_background.png")[1],
    );
    expect(bg.width).toBe(108);
    expect(bg.px(5, 5)).toEqual([...COLORS.BG, 255]);
  });

  it("icon-background: solid plum", () => {
    const { px } = decode(renderBackground(1024));
    expect(px(0, 0)).toEqual([...COLORS.BG, 255]);
    expect(px(1023, 1023)).toEqual([...COLORS.BG, 255]);
  });

  it("splash: 2732, canvas colour outside the centred mark, light and dark", () => {
    const light = decode(renderSplash(2732));
    expect([light.width, light.height]).toEqual([2732, 2732]);
    expect(light.px(10, 10)).toEqual([...COLORS.CANVAS_LIGHT, 255]);
    expect(light.px(1366, 1366)).toEqual([...COLORS.BEAD, 255]);
    // mark stays inside the 1200 px centre square the tool keeps everywhere
    expect(light.px(1366 - 620, 1366)).toEqual([...COLORS.CANVAS_LIGHT, 255]);
    const dark = decode(renderSplash(2732, { dark: true }));
    expect(dark.px(10, 10)).toEqual([...COLORS.CANVAS_DARK, 255]);
    expect(dark.px(1366, 1366)).toEqual([...COLORS.BEAD, 255]);
  });
});
