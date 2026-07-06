/**
 * Renders candidate MAIN APP ICON concepts as 1024×1024 PNGs, plus a small
 * legibility contact-sheet (each concept downscaled to 96px, the size it
 * actually renders on a home screen).
 *
 * These are the "storyboard fermentation" concepts from the design handoff
 * (docs/design-handoff-app-icon.md): the app's live fluorescence-microscopy
 * scene (amber budding yeast, violet LAB rod-chains, glowing gluten mesh,
 * rising CO₂) frozen into a single luminous still, rendered the same way the
 * in-app scene is — additive light on espresso-black.
 *
 * Zero npm dependencies (node-canvas won't build everywhere): light is
 * accumulated into a float framebuffer and tone-mapped, which is exactly the
 * additive-glow model the Skia scene uses (BlendMode.Plus). PNGs are written
 * with node's built-in zlib.
 *
 * Usage:  node tools/generate_app_icon_concepts.mjs
 * Output: assets/images/app-icon-concepts/{concept}.png  (+ contact-sheet.png)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 1024;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images', 'app-icon-concepts');

// ── palette (mirrors components/SkiaFermentationScene.tsx + theme.ts) ────────
const AMBER = [232, 163, 61];
const AMBER_CORE = [246, 208, 138];
const WHITE_HOT = [255, 251, 240];
const HONEY = [232, 163, 61];
const CREAM = [242, 232, 220];
const LAB = [201, 168, 214];
const LAB_HOT = [236, 214, 255];
const ESPRESSO_HI = [34, 26, 21];
const ESPRESSO_LO = [14, 10, 9];

// ── float framebuffer: accumulate light, then tone-map ───────────────────────
function Frame() {
  return { r: new Float64Array(S * S), g: new Float64Array(S * S), b: new Float64Array(S * S) };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

/** Seed the background: a warm espresso radial so the icon is never flat black
 *  (iOS forbids transparency; a subtle glow reads richer than pure #000). */
function background(f, cx = S / 2, cy = S * 0.46, spread = S * 0.62) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const d = Math.hypot(x - cx, y - cy) / spread;
      const t = clamp(d, 0, 1);
      f.r[i] = lerp(ESPRESSO_HI[0], ESPRESSO_LO[0], t);
      f.g[i] = lerp(ESPRESSO_HI[1], ESPRESSO_LO[1], t);
      f.b[i] = lerp(ESPRESSO_HI[2], ESPRESSO_LO[2], t);
    }
  }
}

/** Additive radial glow with smooth falloff, bounded to a box for speed. */
function glow(f, cx, cy, r, rgb, intensity, falloff = 2.2) {
  const x0 = Math.max(0, Math.floor(cx - r * 3));
  const x1 = Math.min(S - 1, Math.ceil(cx + r * 3));
  const y0 = Math.max(0, Math.floor(cy - r * 3));
  const y1 = Math.min(S - 1, Math.ceil(cy + r * 3));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 3) continue;
      const a = Math.exp(-d * d * falloff) * intensity;
      if (a <= 0.001) continue;
      const i = y * S + x;
      f.r[i] += rgb[0] * a;
      f.g[i] += rgb[1] * a;
      f.b[i] += rgb[2] * a;
    }
  }
}

/** A soft glowing line segment (marched dots) — gluten strands, tub walls. */
function glowLine(f, x0, y0, x1, y1, r, rgb, intensity) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(len / (r * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    glow(f, lerp(x0, x1, t), lerp(y0, y1, t), r, rgb, intensity, 2.6);
  }
}

/** A glowing ring (bubble rim / tub) — marched around the circumference. */
function glowRing(f, cx, cy, radius, r, rgb, intensity, a0 = 0, a1 = Math.PI * 2) {
  const steps = Math.max(8, Math.ceil((Math.abs(a1 - a0) * radius) / (r * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const a = lerp(a0, a1, s / steps);
    glow(f, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, r, rgb, intensity, 2.6);
  }
}

// ── organisms ────────────────────────────────────────────────────────────────

/** Budding yeast: a defined ovoid cell — soft cytoplasm, a bright membrane
 *  rim so it reads as a *cell* (not a blob) at any size, white-hot nucleus,
 *  and a daughter bud with its own membrane. */
function cell(f, x, y, r, halo) {
  glow(f, x, y, r * 0.92, AMBER, 0.24 * halo, 2.4);          // contained cytoplasm
  glow(f, x, y, r * 0.5, AMBER_CORE, 0.5 * halo, 2.4);       // brighter centre
  glowRing(f, x, y, r * 0.86, Math.max(2, r * 0.07), AMBER_CORE, 0.5 * halo); // membrane
  glow(f, x - r * 0.26, y - r * 0.28, r * 0.3, WHITE_HOT, 0.85 * halo, 2.6);  // nucleus
}
function yeast(f, x, y, r, ang = -0.6, budScale = 0.5, halo = 1) {
  cell(f, x, y, r, halo);
  const bx = x + Math.cos(ang) * r * 1.02;
  const by = y + Math.sin(ang) * r * 1.02;
  cell(f, bx, by, r * budScale, halo * 0.95);
  // faint ring bud-scar on the opposite pole
  glowRing(f, x - Math.cos(ang) * r * 0.78, y - Math.sin(ang) * r * 0.78, r * 0.2, Math.max(1.5, r * 0.05), AMBER_CORE, 0.28 * halo);
}

/** LAB rod-chain: bead-like violet rods end-to-end, bright poles. */
function labChain(f, x, y, ang, n, rl) {
  for (let i = 0; i < n; i++) {
    const cx = x + Math.cos(ang) * i * rl * 1.7;
    const cy = y + Math.sin(ang) * i * rl * 1.7;
    glow(f, cx, cy, rl * 1.15, LAB, 0.36, 1.8);
    glow(f, cx, cy, rl * 0.6, LAB_HOT, 0.55, 2.3);
    // brighter poles along the chain axis
    glow(f, cx + Math.cos(ang) * rl * 0.7, cy + Math.sin(ang) * rl * 0.7, rl * 0.3, LAB_HOT, 0.5, 2.5);
  }
}

/** Rising CO₂ bubble: faint fill, bright amber rim, specular dot. */
function bubble(f, x, y, r) {
  glow(f, x, y, r * 0.9, AMBER, 0.12, 1.4);
  glowRing(f, x, y, r, r * 0.14, AMBER_CORE, 0.5);
  glow(f, x - r * 0.34, y - r * 0.34, r * 0.18, WHITE_HOT, 0.7, 2.6);
}

/** A gently curved glowing filament through (x0,y0)→(x1,y1), bowed by `bow`. */
function curvedStrand(f, x0, y0, x1, y1, bow, r, rgb, intensity) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const nx = -(y1 - y0), ny = x1 - x0;
  const nl = Math.hypot(nx, ny) || 1;
  const cxp = mx + (nx / nl) * bow, cyp = my + (ny / nl) * bow;
  const steps = 20;
  let px = x0, py = y0;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cxp + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cyp + t * t * y1;
    glowLine(f, px, py, x, y, r, rgb, intensity);
    px = x; py = y;
  }
}

/** Organic gluten: short-to-medium curved filaments wandering within an
 *  elliptical region (endpoints are independent, so they don't converge into
 *  a starburst), plus a few glowing junction nodes. Filamentous, not a net. */
function glutenStrands(f, cx, cy, rx, ry, count, r, intensity, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pt = () => {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
    return [cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d];
  };
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const [x0, y0] = pt();
    // second endpoint a bounded step away, so strands stay short + local
    const ang = rnd() * Math.PI * 2, len = lerp(rx * 0.4, rx * 0.9, rnd());
    const x1 = clamp(x0 + Math.cos(ang) * len, cx - rx, cx + rx);
    const y1 = clamp(y0 + Math.sin(ang) * len, cy - ry, cy + ry);
    curvedStrand(f, x0, y0, x1, y1, (rnd() - 0.5) * len * 0.6, r, HONEY, intensity);
    if (rnd() > 0.35) nodes.push([lerp(x0, x1, rnd()), lerp(y0, y1, rnd())]);
  }
  for (const n of nodes) glow(f, n[0], n[1], r * 2.0, AMBER_CORE, intensity * 1.5, 2.2);
}

// ── tone-map + PNG out ───────────────────────────────────────────────────────
/** Filmic-ish exposure so additive light blooms softly instead of clipping. */
function toneMap(f, exposure = 1.0) {
  const px = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const map = (v) => Math.round(255 * (1 - Math.exp((-v / 255) * exposure)));
    px[i * 4] = clamp(map(f.r[i]), 0, 255);
    px[i * 4 + 1] = clamp(map(f.g[i]), 0, 255);
    px[i * 4 + 2] = clamp(map(f.b[i]), 0, 255);
    px[i * 4 + 3] = 255; // opaque — iOS icons forbid alpha
  }
  return px;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
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
function encodePng(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) px.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Box-filter downscale an RGBA buffer S×S → n×n (legibility preview). */
function downscale(px, n) {
  const out = Buffer.alloc(n * n * 4);
  const f = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let sy = Math.floor(y * f); sy < (y + 1) * f; sy++) {
        for (let sx = Math.floor(x * f); sx < (x + 1) * f; sx++) {
          const i = (sy * S + sx) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; cnt++;
        }
      }
      const o = (y * n + x) * 4;
      out[o] = r / cnt; out[o + 1] = g / cnt; out[o + 2] = b / cnt; out[o + 3] = 255;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONCEPTS
// ═══════════════════════════════════════════════════════════════════════════

/** A — "The Specimen": peak-ferment under the microscope. One hero budding
 *  yeast, a supporting cast of LAB chains + CO₂ bubbles, gluten mesh behind. */
function conceptSpecimen() {
  const f = Frame();
  background(f);
  // very soft warm ambient so the field isn't dead black at the edges
  glow(f, S / 2, S * 0.5, S * 0.4, AMBER, 0.05, 0.7);
  // organic gluten filaments, warm + sparse, kept to the mid-field (behind)
  glutenStrands(f, S / 2, S * 0.52, S * 0.34, S * 0.30, 14, 4, 0.05, 11);
  // rising CO₂
  bubble(f, S * 0.30, S * 0.24, 34);
  bubble(f, S * 0.74, S * 0.22, 24);
  bubble(f, S * 0.68, S * 0.36, 17);
  // violet LAB rod-chains, lower field
  labChain(f, S * 0.22, S * 0.74, 0.30, 4, 24);
  labChain(f, S * 0.60, S * 0.78, -0.18, 3, 26);
  // supporting yeast (smaller, dimmer — clearly secondary)
  yeast(f, S * 0.76, S * 0.62, 52, -2.4, 0.46);
  yeast(f, S * 0.26, S * 0.40, 44, 0.5, 0.42);
  // hero budding yeast — large, central, crisp: a readable mother + daughter
  yeast(f, S * 0.5, S * 0.51, 132, -0.7, 0.55);
  return toneMap(f, 1.1);
}

/** B — "The Culture Jar": the Cambro tub (ties to the notification panel) with
 *  the glowing microbe colony living inside the domed dough. */
function conceptCultureJar() {
  const f = Frame();
  background(f, S / 2, S * 0.5, S * 0.6);
  const xl = S * 0.30, xr = S * 0.70, top = S * 0.24, bot = S * 0.80, rc = 42;
  // tub walls (cream, translucent) — rounded-bottom vessel
  glowLine(f, xl, top, xl, bot - rc, 7, CREAM, 0.16);
  glowRing(f, xl + rc, bot - rc, rc, 7, CREAM, 0.16, Math.PI, Math.PI * 0.5);
  glowLine(f, xl + rc, bot, xr - rc, bot, 7, CREAM, 0.16);
  glowRing(f, xr - rc, bot - rc, rc, 7, CREAM, 0.16, Math.PI * 0.5, 0);
  glowLine(f, xr, top, xr, bot - rc, 7, CREAM, 0.16);
  // lid bar
  glowLine(f, xl - 16, top - 20, xr + 16, top - 20, 9, CREAM, 0.18);
  // dough fill: a domed top that IS the crown of the dough, filling downward.
  // top boundary is a shallow parabola peaking at the centre.
  const crown = S * 0.46, edge = S * 0.52; // dome centre y / where it meets walls
  const halfW = (xr - xl) / 2 - 8;
  const innerL = xl + 8, innerR = xr - 8;
  for (let x = Math.ceil(innerL); x < innerR; x++) {
    const nx = (x - S / 2) / halfW; // -1..1
    const topY = lerp(crown, edge, Math.min(1, nx * nx)); // parabola
    for (let y = Math.floor(topY); y < bot - 6; y++) {
      const i = y * S + x;
      const t = (y - topY) / (bot - topY);
      const c = lerp(0.92, 0.42, t);
      f.r[i] += CREAM[0] * c * 0.32;
      f.g[i] += CREAM[1] * c * 0.32;
      f.b[i] += CREAM[2] * c * 0.30;
    }
  }
  // bright rim-light along the domed crown
  glowRing(f, S / 2, crown + halfW * 0.9, halfW * 0.98, 8, CREAM, 0.22, Math.PI * 1.2, Math.PI * 1.8);
  // colony living inside the dough — gentle, spread across the dough body
  glutenStrands(f, S / 2, S * 0.64, halfW * 0.7, S * 0.11, 9, 3.5, 0.05, 5);
  yeast(f, S * 0.44, S * 0.60, 34, -0.6, 0.5);
  yeast(f, S * 0.59, S * 0.65, 28, -2.2, 0.45);
  yeast(f, S * 0.50, S * 0.71, 22, 0.4, 0.4);
  labChain(f, S * 0.40, S * 0.72, 0.2, 3, 13);
  labChain(f, S * 0.57, S * 0.74, -0.3, 3, 12);
  bubble(f, S * 0.46, S * 0.495, 15);
  bubble(f, S * 0.56, S * 0.50, 11);
  return toneMap(f, 1.12);
}

/** C — "The Bloom": abstract peak-fermentation burst — a bright core throwing
 *  a fan of CO₂ bubbles upward. Calm, iconic, least literal. */
function conceptBloom() {
  const f = Frame();
  background(f, S / 2, S * 0.62, S * 0.6);
  // warm core low-center
  glow(f, S / 2, S * 0.66, 120, AMBER, 0.5, 1.3);
  glow(f, S / 2, S * 0.66, 60, AMBER_CORE, 0.7, 1.8);
  glow(f, S / 2, S * 0.66, 26, WHITE_HOT, 0.9, 2.4);
  // fan of rising bubbles
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 16; i++) {
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.5;
    const dist = lerp(S * 0.12, S * 0.42, rnd());
    const bx = S / 2 + Math.cos(ang) * dist;
    const by = S * 0.66 + Math.sin(ang) * dist;
    bubble(f, bx, by, lerp(8, 30, rnd()) * (1 - dist / (S * 0.5)) + 8);
  }
  return toneMap(f, 1.2);
}

// ── render ───────────────────────────────────────────────────────────────────
const concepts = [
  ['specimen', conceptSpecimen],
  ['culture-jar', conceptCultureJar],
  ['bloom', conceptBloom],
];

mkdirSync(OUT, { recursive: true });
const previews = [];
for (const [name, fn] of concepts) {
  const px = fn();
  writeFileSync(join(OUT, `${name}.png`), encodePng(px, S, S));
  previews.push(downscale(px, 96));
  console.log(`wrote ${name}.png (1024²)`);
}

// contact sheet: each concept at 96px on a neutral strip, to judge legibility
const pad = 24, box = 96, sheetW = concepts.length * (box + pad) + pad, sheetH = box + pad * 2;
const sheet = Buffer.alloc(sheetW * sheetH * 4);
for (let i = 0; i < sheetW * sheetH; i++) {
  sheet[i * 4] = 40; sheet[i * 4 + 1] = 40; sheet[i * 4 + 2] = 44; sheet[i * 4 + 3] = 255;
}
previews.forEach((p, k) => {
  const ox = pad + k * (box + pad), oy = pad;
  for (let y = 0; y < box; y++)
    for (let x = 0; x < box; x++) {
      const src = (y * box + x) * 4, dst = ((oy + y) * sheetW + (ox + x)) * 4;
      sheet[dst] = p[src]; sheet[dst + 1] = p[src + 1]; sheet[dst + 2] = p[src + 2]; sheet[dst + 3] = 255;
    }
});
writeFileSync(join(OUT, 'contact-sheet.png'), encodePng(sheet, sheetW, sheetH));
console.log(`\nwrote contact-sheet.png (${concepts.length} concepts @ 96px)\n→ ${OUT}`);
