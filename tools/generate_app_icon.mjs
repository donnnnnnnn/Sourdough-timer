/**
 * Renders the app's brand mark — the fold-wheel still life (honey progress
 * arc around a cream dough with rising bubbles) — into every launcher asset:
 *
 *   icon.png                     1024  iOS/app icon (full-bleed espresso)
 *   android-icon-foreground.png  1024  adaptive foreground (transparent, safe zone)
 *   android-icon-background.png  1024  adaptive background (espresso + soft glow)
 *   android-icon-monochrome.png  1024  themed/monochrome (white silhouette)
 *   splash-icon.png              1024  splash mark (transparent bg)
 *   favicon.png                    64  web favicon (disc)
 *
 * Zero npm deps — same SDF + PNG-writer approach as
 * tools/generate_notification_icons.mjs (kept in sync by hand).
 *
 * Usage:  node tools/generate_app_icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');

// ---- palette (mirrors components/theme.ts) --------------------------------
const ESPRESSO = [23, 18, 16]; // C.bg #171210
const HONEY = [232, 163, 61];
const CREAM = [242, 232, 220];
const DOUGH_TOP = [236, 220, 194];
const DOUGH_BOTTOM = [211, 184, 143];
const ARC_FRAC = 0.78; // mid-ferment: the story is "almost there"

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
  ihdr[8] = 8;
  ihdr[9] = 6;
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
function coverage(d, aa = 1.6) {
  const t = Math.min(1, Math.max(0, (aa - d) / (2 * aa)));
  return t * t * (3 - 2 * t);
}
const circleSdf = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

function arcSdf(x, y, cx, cy, r, hw, frac) {
  if (frac <= 0) return 1e9;
  const dx = x - cx;
  const dy = y - cy;
  let theta = Math.atan2(dx, -dy);
  if (theta < 0) theta += Math.PI * 2;
  const sweep = frac * Math.PI * 2;
  if (frac >= 0.999 || theta <= sweep) {
    return Math.abs(Math.hypot(dx, dy) - r) - hw;
  }
  const endpoint = (a) => Math.hypot(x - (cx + r * Math.sin(a)), y - (cy - r * Math.cos(a))) - hw;
  return Math.min(endpoint(0), endpoint(sweep));
}

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

// ---- the mark --------------------------------------------------------------
// All geometry is relative to a mark box of size m centered at (cx, cy):
// honey arc at r=0.40m, dough dome resting low, bubbles rising to fill the
// head-space the arc leaves open.
const BUBBLES = [
  { x: -0.10, y: -0.115, r: 0.045, a: 0.85 },
  { x: 0.045, y: -0.2, r: 0.03, a: 0.65 },
  { x: 0.125, y: -0.085, r: 0.021, a: 0.5 },
];
const CRUMB_HOLES = [
  { x: -0.065, y: 0.1, r: 0.03 },
  { x: 0.065, y: 0.145, r: 0.022 },
  { x: 0.0, y: 0.045, r: 0.016 },
];

/**
 * Draw the mark into px.
 * mono: white silhouette only (for Android themed icons).
 */
function drawMark(px, size, cx, cy, m, { mono = false, ringTrack = true } = {}) {
  const ringR = 0.4 * m;
  const ringHW = 0.028 * m;
  const doughCY = cy + 0.16 * m;
  const doughR = 0.27 * m;
  const doughFloor = cy + 0.2 * m;
  const white = [255, 255, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (ringTrack && !mono) {
        blend(px, i, CREAM, 0.13 * coverage(Math.abs(circleSdf(x, y, cx, cy, ringR)) - ringHW));
      }
      blend(px, i, mono ? white : HONEY, coverage(arcSdf(x, y, cx, cy, ringR, ringHW, mono ? 1 : ARC_FRAC)));

      const dome = Math.max(circleSdf(x, y, cx, doughCY, doughR), y - doughFloor);
      const domeCov = coverage(dome);
      if (domeCov > 0) {
        if (mono) {
          blend(px, i, white, domeCov);
        } else {
          const t = Math.min(1, Math.max(0, (y - (doughCY - doughR)) / (doughFloor - (doughCY - doughR))));
          const doughCol = DOUGH_TOP.map((v, c) => v + (DOUGH_BOTTOM[c] - v) * t);
          blend(px, i, doughCol, domeCov);
        }
      }

      if (!mono) {
        for (const h of CRUMB_HOLES) {
          const d = circleSdf(x, y, cx + h.x * m, cy + h.y * m, h.r * m);
          blend(px, i, DOUGH_BOTTOM.map((v) => v * 0.78), coverage(d) * domeCov * 0.9);
        }
        for (const b of BUBBLES) {
          const bx = cx + b.x * m;
          const by = cy + b.y * m;
          const br = b.r * m;
          const d = circleSdf(x, y, bx, by, br);
          blend(px, i, HONEY, 0.28 * b.a * coverage(d));
          blend(px, i, HONEY, b.a * coverage(Math.abs(d) - br * 0.16));
          blend(px, i, [255, 250, 240], 0.7 * b.a * coverage(circleSdf(x, y, bx - br * 0.35, by - br * 0.35, br * 0.22)));
        }
      } else {
        // monochrome keeps one bubble so the silhouette still reads "alive"
        const b = BUBBLES[0];
        const br = b.r * m;
        blend(px, i, white, coverage(Math.abs(circleSdf(x, y, cx + b.x * m, cy + b.y * m, br)) - br * 0.16));
      }
    }
  }
}

function solid(size, rgb, glow = false) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
      if (glow) {
        // faint warm center so the adaptive background has depth, not banding
        const d = Math.hypot(x - cx, y - cy) / (size * 0.75);
        blend(px, i, HONEY, Math.max(0, 0.05 * (1 - d)));
      }
    }
  }
  return px;
}

function transparent(size) {
  return Buffer.alloc(size * size * 4);
}

function write(name, buf) {
  const file = join(OUT_DIR, name);
  writeFileSync(file, buf);
  console.log(`wrote ${file}`);
}

// icon.png — full-bleed espresso; iOS masks its own corners.
{
  const S = 1024;
  const px = solid(S, ESPRESSO, true);
  drawMark(px, S, S / 2, S / 2, S * 0.74);
  write('icon.png', encodePng(px, S, S));
}

// android-icon-foreground.png — content inside the ~66% adaptive safe zone.
{
  const S = 1024;
  const px = transparent(S);
  drawMark(px, S, S / 2, S / 2, S * 0.52);
  write('android-icon-foreground.png', encodePng(px, S, S));
}

// android-icon-background.png — espresso with the soft glow.
{
  const S = 1024;
  write('android-icon-background.png', encodePng(solid(S, ESPRESSO, true), S, S));
}

// android-icon-monochrome.png — white silhouette, safe zone.
{
  const S = 1024;
  const px = transparent(S);
  drawMark(px, S, S / 2, S / 2, S * 0.52, { mono: true });
  write('android-icon-monochrome.png', encodePng(px, S, S));
}

// splash-icon.png — transparent mark; app.json paints the espresso behind it.
{
  const S = 1024;
  const px = transparent(S);
  drawMark(px, S, S / 2, S / 2, S * 0.6);
  write('splash-icon.png', encodePng(px, S, S));
}

// favicon.png — tiny disc version.
{
  const S = 64;
  const px = transparent(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      blend(px, (y * S + x) * 4, ESPRESSO, coverage(circleSdf(x, y, S / 2, S / 2, S * 0.48), 1.2));
    }
  }
  drawMark(px, S, S / 2, S / 2, S * 0.78);
  write('favicon.png', encodePng(px, S, S));
}

console.log('\nAll launcher assets regenerated.');
