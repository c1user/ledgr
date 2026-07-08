/**
 * scripts/generate-icons.mjs — regenerate the PWA icon set.
 *
 *   node scripts/generate-icons.mjs
 *
 * Dependency-free: draws an abacus mark (brand-green rounded square,
 * three rods of beads) into raw RGBA and encodes the PNGs by hand.
 * Outputs to public/icons/.
 */

import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/icons",
);

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

function encodePng(size, rgba) {
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

// ── scene (unit coordinates 0..1) ────────────────────────────
const BG = [0x0f, 0x6e, 0x56]; // --brand (light theme)
const BEAD = [0xff, 0xff, 0xff];
const ACCENT = [0x00, 0xc8, 0x96]; // --brand (dark theme)
const ROD = [0x0a, 0x52, 0x40];

const RODS = [
  { y: 0.32, beads: [{ x: 0.28 }, { x: 0.45 }, { x: 0.72, accent: true }] },
  { y: 0.5, beads: [{ x: 0.28, accent: true }, { x: 0.55 }, { x: 0.72 }] },
  { y: 0.68, beads: [{ x: 0.28 }, { x: 0.45, accent: true }, { x: 0.62 }] },
];
const BEAD_R = 0.075;
const ROD_HALF = 0.011;
const ROD_X0 = 0.17;
const ROD_X1 = 0.83;

// Color of the mark at unit point (x, y), or null for background.
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
 * Render one icon.
 * maskable: full-bleed square background, mark scaled into the 80% safe zone.
 * otherwise: rounded-square background on transparency.
 */
function render(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 2; // 2x2 supersampling
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        aSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const inBg = maskable ? true : insideRoundedSquare(x, y, 0.22);
          if (!inBg) continue;
          // safe-zone scaling for maskable icons
          const mx = maskable ? (x - 0.5) / 0.8 + 0.5 : x;
          const my = maskable ? (y - 0.5) / 0.8 + 0.5 : y;
          const c = markColor(mx, my) || BG;
          rSum += c[0];
          gSum += c[1];
          bSum += c[2];
          aSum += 255;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const a = aSum / n;
      // premultiplied-ish blend against transparency: scale color by coverage
      const cov = a / 255 || 0;
      rgba[i] = cov ? Math.round(rSum / (n * cov)) : 0;
      rgba[i + 1] = cov ? Math.round(gSum / (n * cov)) : 0;
      rgba[i + 2] = cov ? Math.round(bSum / (n * cov)) : 0;
      rgba[i + 3] = Math.round(a);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ["icon-192.png", render(192)],
  ["icon-512.png", render(512)],
  ["icon-maskable-512.png", render(512, { maskable: true })],
  ["apple-touch-icon.png", render(180, { maskable: true })],
];
for (const [name, buf] of files) {
  writeFileSync(path.join(OUT_DIR, name), buf);
  console.log(`${name}  ${buf.length} bytes`);
}
