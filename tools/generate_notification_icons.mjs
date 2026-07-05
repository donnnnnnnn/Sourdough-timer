/**
 * Renders the notification-panel "fold wheel" artwork:
 * a honey progress ring around a small cream dough with rising bubbles —
 * a still-life version of the app's fermentation animation, sized for the
 * Android notification largeIcon slot.
 *
 * Android notifications can't run our Skia animation, so we pre-render one
 * PNG per fold-progress step (0/12 … 12/12) and the panel picks the closest
 * one. Zero npm deps — draws with signed-distance functions and writes PNGs
 * with node's built-in zlib.
 *
 * Usage:  node tools/generate_notification_icons.mjs
 * Output: assets/images/fold-wheel/wheel-{0..12}.png (384×384)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 384;
const STEPS = 12; // ring resolution: progress rendered in 12ths
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images', 'fold-wheel');

// ---- palette (mirrors components/theme.ts) --------------------------------
const ESPRESSO = [26, 20, 17]; // disc background, a touch lighter than app bg
const HONEY = [232, 163, 61]; // C.accent
const CREAM = [242, 232, 220]; // C.text
const DOUGH_TOP = [236, 220, 194];
const DOUGH_BOTTOM = [211, 184, 143];

// ---- tiny PNG writer -------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // filter byte 0 at the start of each scanline
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- SDF drawing helpers ---------------------------------------------------
/** 0→1 edge coverage: fully inside when d ≤ -aa, fully outside when d ≥ aa. */
function coverage(d, aa = 1.4) {
  const t = Math.min(1, Math.max(0, (aa - d) / (2 * aa)));
  return t * t * (3 - 2 * t);
}
const circleSdf = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

/** Progress arc: ring of radius `r`, half-width `hw`, sweeping clockwise from 12 o'clock through `frac` of a turn, rounded caps. */
function arcSdf(x, y, cx, cy, r, hw, frac) {
  if (frac <= 0) return 1e9;
  const dx = x - cx;
  const dy = y - cy;
  // angle from the top, clockwise, in [0, 2π)
  let theta = Math.atan2(dx, -dy);
  if (theta < 0) theta += Math.PI * 2;
  const sweep = frac * Math.PI * 2;
  if (frac >= 0.999 || theta <= sweep) {
    return Math.abs(Math.hypot(dx, dy) - r) - hw;
  }
  // outside the sweep: distance to the nearer rounded endpoint
  const endpoint = (a) =>
    Math.hypot(x - (cx + r * Math.sin(a)), y - (cy - r * Math.cos(a))) - hw;
  return Math.min(endpoint(0), endpoint(sweep));
}

/** src-over composite of a premultiplied-ish flat color at `alpha` onto px. */
function blend(px, i, rgb, alpha) {
  if (alpha <= 0) return;
  const a0 = px[i + 3] / 255;
  const outA = alpha + a0 * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    px[i + c] = Math.round((rgb[c] * alpha + px[i + c] * a0 * (1 - alpha)) / outA);
  }
  px[i + 3] = Math.round(outA * 255);
}

// ---- the scene ------------------------------------------------------------
const CX = SIZE / 2;
const CY = SIZE / 2;
const DISC_R = SIZE * 0.47;
const RING_R = SIZE * 0.405;
const RING_HW = SIZE * 0.028;
const DOUGH_CY = SIZE * 0.66; // dome center sits low
const DOUGH_R = SIZE * 0.27;
const DOUGH_FLOOR = SIZE * 0.70; // flat resting line of the dough

// Rising CO₂ bubbles above the dough — echoes the Skia scene.
const BUBBLES = [
  { x: 0.40, y: 0.385, r: 0.045, a: 0.85 },
  { x: 0.545, y: 0.30, r: 0.030, a: 0.65 },
  { x: 0.625, y: 0.415, r: 0.021, a: 0.5 },
];
// Gas cells caught inside the dough itself.
const CRUMB_HOLES = [
  { x: 0.435, y: 0.60, r: 0.030 },
  { x: 0.565, y: 0.645, r: 0.022 },
  { x: 0.50, y: 0.545, r: 0.016 },
];

function render(frac) {
  const px = Buffer.alloc(SIZE * SIZE * 4); // transparent
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;

      // espresso disc
      blend(px, i, ESPRESSO, coverage(circleSdf(x, y, CX, CY, DISC_R)));

      // ring track (faint cream) + honey progress arc
      blend(px, i, CREAM, 0.13 * coverage(Math.abs(circleSdf(x, y, CX, CY, RING_R)) - RING_HW));
      blend(px, i, HONEY, coverage(arcSdf(x, y, CX, CY, RING_R, RING_HW, frac)));

      // dough dome: circle cut by its resting line, gentle top-lit gradient
      const dome = Math.max(circleSdf(x, y, CX, DOUGH_CY, DOUGH_R), y - DOUGH_FLOOR);
      const domeCov = coverage(dome);
      if (domeCov > 0) {
        const t = Math.min(1, Math.max(0, (y - (DOUGH_CY - DOUGH_R)) / (DOUGH_FLOOR - (DOUGH_CY - DOUGH_R))));
        const doughCol = DOUGH_TOP.map((v, c) => v + (DOUGH_BOTTOM[c] - v) * t);
        blend(px, i, doughCol, domeCov);
      }

      // crumb holes: slightly darker wells inside the dome
      for (const h of CRUMB_HOLES) {
        const d = circleSdf(x, y, h.x * SIZE, h.y * SIZE, h.r * SIZE);
        blend(px, i, DOUGH_BOTTOM.map((v) => v * 0.78), coverage(d) * domeCov * 0.9);
      }

      // luminous rising bubbles: soft honey fill, brighter rim, specular dot
      for (const b of BUBBLES) {
        const bx = b.x * SIZE;
        const by = b.y * SIZE;
        const br = b.r * SIZE;
        const d = circleSdf(x, y, bx, by, br);
        blend(px, i, HONEY, 0.28 * b.a * coverage(d));
        blend(px, i, HONEY, b.a * coverage(Math.abs(d) - br * 0.16));
        blend(px, i, [255, 250, 240], 0.7 * b.a * coverage(circleSdf(x, y, bx - br * 0.35, by - br * 0.35, br * 0.22)));
      }
    }
  }
  return encodePng(px, SIZE, SIZE);
}

mkdirSync(OUT_DIR, { recursive: true });
for (let step = 0; step <= STEPS; step++) {
  const file = join(OUT_DIR, `wheel-${step}.png`);
  writeFileSync(file, render(step / STEPS));
  console.log(`wrote ${file}`);
}
console.log(`\n${STEPS + 1} icons → ${OUT_DIR}`);
