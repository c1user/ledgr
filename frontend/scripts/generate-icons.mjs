/**
 * scripts/generate-icons.mjs — regenerate the icon sets from one geometry.
 *
 *   node scripts/generate-icons.mjs            # PWA set → public/icons/
 *   node scripts/generate-icons.mjs --mobile   # + mobile/resources/ sources
 *                                              #   for `npx capacitor-assets generate`
 *   node scripts/generate-icons.mjs --android-adaptive
 *       # AFTER capacitor-assets: full-resolution adaptive launcher layers
 *       # into mobile/android/…/res/mipmap-<density> (the tool writes 48 dp)
 *
 * Dependency-free: draws the abacus mark (plum rounded square, three rods of
 * beads — the same geometry as packages/ui BrandMark.jsx and public/favicon.svg)
 * into raw RGBA and encodes the PNGs by hand. Every colour comes from
 * @abaco/tokens/brand.js, whose drift test ties it to tokens.css.
 *
 * Mobile sources (ROADMAP-V6 1.9), the names @capacitor/assets expects:
 *   icon-only.png        1024  full-bleed plum, mark in the 80 % safe zone
 *                              (iOS / stores apply their own corner mask)
 *   icon-foreground.png  1024  rods + beads on transparency = the launcher's
 *                              visible 72 dp viewport (see renderForeground)
 *   icon-background.png  1024  solid plum
 *   splash.png           2732  light canvas, mark centred (safe centre 1200)
 *   splash-dark.png      2732  dark canvas, same mark
 */

import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { HEX } from "@abaco/tokens/brand.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PWA_OUT_DIR = path.resolve(HERE, "../public/icons");
export const MOBILE_OUT_DIR = path.resolve(HERE, "../../mobile/resources");

// ── PNG encoding ─────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── colours — @abaco/tokens/brand.js is the single source ────
const rgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`generate-icons: not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

export const COLORS = {
  BG: rgb(HEX.brand), // plum rounded square / adaptive background
  BEAD: rgb(HEX.surfaceLight), // white beads
  ACCENT: rgb(HEX.accent), // burnt-orange beads
  ROD: rgb(HEX.brandHover), // deep plum rods
  CANVAS_LIGHT: rgb(HEX.canvasLight), // splash background (light)
  CANVAS_DARK: rgb(HEX.canvasDark), // splash background (dark)
};
const { BG, BEAD, ACCENT, ROD, CANVAS_LIGHT, CANVAS_DARK } = COLORS;

// ── scene (unit coordinates 0..1) — "Ink & plum" identity ────
const RODS = [
  { y: 0.32, beads: [{ x: 0.28 }, { x: 0.45 }, { x: 0.72, accent: true }] },
  { y: 0.5, beads: [{ x: 0.28, accent: true }, { x: 0.55 }, { x: 0.72 }] },
  { y: 0.68, beads: [{ x: 0.28 }, { x: 0.45, accent: true }, { x: 0.62 }] },
];
const BEAD_R = 0.075;
const ROD_HALF = 0.011;
const ROD_X0 = 0.17;
const ROD_X1 = 0.83;

// Colour of the mark at unit point (x, y), or null for background.
function markColor(x, y) {
  for (const rod of RODS) {
    for (const bead of rod.beads) {
      const dx = x - bead.x;
      const dy = y - rod.y;
      if (dx * dx + dy * dy <= BEAD_R * BEAD_R) {
        return bead.accent ? ACCENT : BEAD;
      }
    }
  }
  for (const rod of RODS) {
    if (x >= ROD_X0 && x <= ROD_X1 && Math.abs(y - rod.y) <= ROD_HALF) {
      return ROD;
    }
  }
  return null;
}

// Rounded-square coverage test (unit coords), corner radius r.
function insideRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Generic supersampled rasteriser. `sample(x, y)` receives unit coordinates
 * and returns an [r, g, b] colour or null for transparent.
 */
function raster(size, sample) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 2; // 2x2 supersampling
  const n = SS * SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        aSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(
            (px + (sx + 0.5) / SS) / size,
            (py + (sy + 0.5) / SS) / size,
          );
          if (!c) continue;
          rSum += c[0];
          gSum += c[1];
          bSum += c[2];
          aSum += 255;
        }
      }
      const i = (py * size + px) * 4;
      const a = aSum / n;
      // scale colour by coverage (straight alpha)
      const cov = a / 255 || 0;
      rgba[i] = cov ? Math.round(rSum / (n * cov)) : 0;
      rgba[i + 1] = cov ? Math.round(gSum / (n * cov)) : 0;
      rgba[i + 2] = cov ? Math.round(bSum / (n * cov)) : 0;
      rgba[i + 3] = Math.round(a);
    }
  }
  return rgba;
}

/**
 * Render one icon.
 * maskable: full-bleed square background, mark scaled into the 80% safe zone.
 * otherwise: rounded-square background on transparency.
 */
export function render(size, { maskable = false } = {}) {
  return encodePng(
    size,
    raster(size, (x, y) => {
      if (!maskable && !insideRoundedSquare(x, y, 0.22)) return null;
      const mx = maskable ? (x - 0.5) / 0.8 + 0.5 : x;
      const my = maskable ? (y - 0.5) / 0.8 + 0.5 : y;
      return markColor(mx, my) || BG;
    }),
  );
}

/**
 * Adaptive-icon foreground: rods + beads only, on transparency. The PNG is
 * the launcher's VISIBLE 72 dp viewport, not the 108 dp layer:
 * @capacitor/assets wraps both layers in `<inset android:inset="16.7%">`, so
 * the image is already shrunk onto the inner 72 dp. Drawn edge to edge, the
 * mark's farthest point is 0.381 of the width from the centre = 27 dp, inside
 * the 33 dp radius of the 66 dp safe circle every launcher mask keeps.
 */
export function renderForeground(size) {
  return encodePng(
    size,
    raster(size, (x, y) => markColor(x, y)),
  );
}

/**
 * The adaptive layers @capacitor/assets writes are 48 dp bitmaps (192 px at
 * xxxhdpi) that Android then stretches 1.5× in launchers and ~4× on the
 * Android 12 system splash. --android-adaptive overwrites them with 108 dp
 * renders (432 px at xxxhdpi) of the same viewport — the inset XML stays.
 */
export const ANDROID_RES_DIR = path.resolve(
  HERE,
  "../../mobile/android/app/src/main/res",
);
export const ANDROID_ADAPTIVE_PX = {
  ldpi: 81,
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};
export const ANDROID_ADAPTIVE_FILES = () =>
  Object.entries(ANDROID_ADAPTIVE_PX).flatMap(([density, px]) => [
    [`mipmap-${density}/ic_launcher_foreground.png`, renderForeground(px)],
    [`mipmap-${density}/ic_launcher_background.png`, renderBackground(px)],
  ]);

/** Adaptive-icon background: solid plum. */
export function renderBackground(size) {
  return encodePng(
    size,
    raster(size, () => BG),
  );
}

/**
 * Splash source: canvas colour with the rounded plum mark centred, 20 % of
 * the canvas wide — well inside the 1200 px centre that @capacitor/assets
 * keeps on every device size.
 */
export function renderSplash(size, { dark = false } = {}) {
  const canvas = dark ? CANVAS_DARK : CANVAS_LIGHT;
  const MARK = 0.2;
  const lo = 0.5 - MARK / 2;
  const hi = 0.5 + MARK / 2;
  return encodePng(
    size,
    raster(size, (x, y) => {
      if (x < lo || x > hi || y < lo || y > hi) return canvas;
      const mx = (x - lo) / MARK;
      const my = (y - lo) / MARK;
      if (!insideRoundedSquare(mx, my, 0.22)) return canvas;
      return markColor(mx, my) || BG;
    }),
  );
}

export const PWA_FILES = () => [
  ["icon-192.png", render(192)],
  ["icon-512.png", render(512)],
  ["icon-maskable-512.png", render(512, { maskable: true })],
  ["apple-touch-icon.png", render(180, { maskable: true })],
];

export const MOBILE_FILES = () => [
  ["icon-only.png", render(1024, { maskable: true })],
  ["icon-foreground.png", renderForeground(1024)],
  ["icon-background.png", renderBackground(1024)],
  ["splash.png", renderSplash(2732)],
  ["splash-dark.png", renderSplash(2732, { dark: true })],
];

function writeAll(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, buf] of files) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), buf);
    console.log(
      `${path.relative(process.cwd(), path.join(dir, name))}  ${buf.length} bytes`,
    );
  }
}

// Run only as a script (the test imports the renderers without writing).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  writeAll(PWA_OUT_DIR, PWA_FILES());
  if (process.argv.includes("--mobile"))
    writeAll(MOBILE_OUT_DIR, MOBILE_FILES());
  if (process.argv.includes("--android-adaptive"))
    writeAll(ANDROID_RES_DIR, ANDROID_ADAPTIVE_FILES());
}
