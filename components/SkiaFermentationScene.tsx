/**
 * SkiaFermentationScene — animated "confocal microscopy" fermentation visual.
 *
 * Drop-in replacement for the DOM-based <FermentationScene mode fraction />.
 * Renders the full cast of organisms — yeast (amber), LAB rod-chains (violet),
 * amylase rings (teal), protease lobes (red), acetic flecks (yellow-green),
 * CO₂ bubbles, an acid haze, and the gluten lattice — as luminous, semi-
 * translucent specimens glowing from within on pure black, composited with
 * ADDITIVE blending (BlendMode.Plus). That additive glow is what produces the
 * fluorescence-microscopy look (see docs/fermentation-art-spec.md).
 *
 * ── How it's driven ─────────────────────────────────────────────────────────
 * Every organism's count / size / brightness / emergence is a pure mapping of
 * the fields returned by model/doughState.ts (microbeActivity, gasVolume,
 * glutenStrength, glutenDamage, acidity, sugarAvail, fermentation). This
 * component only CONSUMES that engine via computeDoughState — it never
 * re-derives any fermentation science. Mapping already-computed state → pixels
 * is the only thing happening here.
 *
 * ── How it animates ─────────────────────────────────────────────────────────
 * The dough *state* is memoised on the JS thread (it only depends on the
 * mode/fraction props). Motion — organism drift, cell breathing, budding
 * pulses, rising CO₂ bubbles — comes from a monotonic clock (useClock) fed
 * into a derived SkPicture drawn on the UI thread. The imperative draw code
 * below mirrors scratchpad-spike/web/scene.js (the CanvasKit reference that was
 * screenshot-validated) as closely as the RN Skia API allows.
 *
 * The drawing runs inside a reanimated worklet (createPicture within
 * useDerivedValue). The RN-Skia + reanimated animated-Picture pattern is the
 * documented one, but it can only be truly verified in a native build — see the
 * note in this session's report.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import {
  Canvas,
  Picture,
  Group,
  Skia,
  createPicture,
  useClock,
  vec,
  BlendMode,
  PaintStyle,
  StrokeCap,
  BlurStyle,
  TileMode,
} from '@shopify/react-native-skia';
import {
  computeDoughState,
  DEFAULT_INPUTS,
  type BakerInputs,
  type FoldEvent,
  type DoughState,
} from '../model/doughState';

// ── Palette (0..255 rgb) — matches fermentation-art-spec.md & scene.js ───────
const P = {
  amber: [232, 163, 61],
  amberCore: [246, 208, 138],
  whiteHot: [255, 251, 240],
  gluten: [232, 163, 61],
  glutenHot: [255, 214, 150],
  lab: [201, 168, 214],
  labHot: [236, 214, 255],
  amylase: [111, 184, 168],
  amylaseHot: [20, 224, 200],
  protease: [229, 140, 118],
  proteaseHot: [255, 70, 60],
  acetic: [170, 200, 110],
  aceticHot: [210, 255, 120],
} as const;

type RGB = readonly [number, number, number];

const TAU = Math.PI * 2;
const FALLBACK_W = 340;
const FALLBACK_H = 400;

// ── math helpers (worklet-safe: pure, no closures over host objects) ─────────
function mulberry32(a: number) {
  'worklet';
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, a: number, b: number) => {
  'worklet';
  return x < a ? a : x > b ? b : x;
};
const lerp = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};
const smooth = (a: number, b: number, t: number) => {
  'worklet';
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

// deterministic per-index drift so motion is smooth + stable (no RNG per frame)
function drift(t: number, seed: number, ampX: number, ampY: number, period: number) {
  'worklet';
  const ph = seed * 1.7;
  return {
    dx: Math.sin((t * TAU) / period + ph) * ampX,
    dy: Math.cos((t * TAU) / (period * 0.85) + ph * 1.3) * ampY,
  };
}
function breathe(t: number, seed: number, amp: number, period: number) {
  'worklet';
  return 1 + Math.sin((t * TAU) / period + seed * 2.1) * amp;
}

// ── low-level additive primitives (RN Skia canvas API mirrors CanvasKit) ─────
function additivePaint() {
  'worklet';
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setBlendMode(BlendMode.Plus);
  return p;
}
function col(rgb: RGB, a: number) {
  'worklet';
  const aa = a < 0 ? 0 : a > 1 ? 1 : a;
  return Skia.Color(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`);
}

function glowOrb(
  canvas: any,
  x: number,
  y: number,
  r: number,
  coreRgb: RGB,
  hueRgb: RGB,
  coreA: number,
  hueA: number,
) {
  'worklet';
  if (r <= 0.2 || (coreA <= 0 && hueA <= 0)) return;
  const p = additivePaint();
  const sh = Skia.Shader.MakeRadialGradient(
    vec(x, y),
    r,
    [col(coreRgb, coreA), col(hueRgb, hueA), col(hueRgb, 0)],
    [0.0, 0.45, 1.0],
    TileMode.Clamp,
  );
  p.setShader(sh);
  canvas.drawCircle(x, y, r, p);
}
function halo(canvas: any, x: number, y: number, r: number, rgb: RGB, a: number, sigma: number) {
  'worklet';
  if (a <= 0.002) return;
  const p = additivePaint();
  p.setColor(col(rgb, a));
  p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, false));
  canvas.drawCircle(x, y, r, p);
}
function ring(
  canvas: any,
  x: number,
  y: number,
  r: number,
  w: number,
  rgb: RGB,
  a: number,
  sigma: number,
) {
  'worklet';
  if (a <= 0.002) return;
  const p = additivePaint();
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(w);
  p.setColor(col(rgb, a));
  if (sigma > 0) p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, false));
  canvas.drawCircle(x, y, r, p);
}

// ── the scene (mirrors scene.js drawScene) ───────────────────────────────────
function drawScene(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  drawAcidHaze(canvas, st, W, H);
  drawGluten(canvas, st, W, H, time);
  drawAmylase(canvas, st, W, H, time);
  drawProtease(canvas, st, W, H, time);
  drawLAB(canvas, st, W, H, time);
  drawYeast(canvas, st, W, H, time);
  drawAcetic(canvas, st, W, H, time);
  drawBubbles(canvas, st, W, H, time);
}

// warm haze that deepens with acidity — a soft CENTERED bloom that fades fully
// to pure black well inside the frame (must never read as a glowing rectangle).
function drawAcidHaze(canvas: any, st: DoughState, W: number, H: number) {
  'worklet';
  const a = smooth(0.45, 1.0, st.acidity);
  if (a < 0.02) return;
  glowOrb(canvas, W * 0.5, H * 0.58, W * 0.42, P.protease, P.protease, 0.045 * a, 0.05 * a);
}

function drawYeast(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const m = st.microbeActivity;
  const rng = mulberry32(99);
  const count = Math.round(lerp(2, 7, m));
  const vigor = m;
  // Blue-noise-ish spread via the plastic-number (R2) low-discrepancy sequence:
  // deterministic, frame-stable, and guarantees the colony fills the frame
  // instead of piling up like raw PRNG samples do. A small seeded jitter keeps
  // it from reading as a lattice.
  const R2A = 0.7548776662466927;
  const R2B = 0.5698402909980532;
  for (let i = 0; i < count; i++) {
    const fx = (0.5 + R2A * (i + 1)) % 1;
    const fy = (0.5 + R2B * (i + 1)) % 1;
    const jx = (rng() * 2 - 1) * 24;
    const jy = (rng() * 2 - 1) * 24;
    const bx0 = clamp(lerp(52, W - 52, fx) + jx, 46, W - 46);
    const by0 = clamp(lerp(66, H - 72, fy) + jy, 58, H - 64);
    const r0 = lerp(14, 22, rng()) * lerp(0.75, 1.05, vigor);
    const bright = lerp(0.55, 1.0, vigor);
    const d = drift(time, i + 1, 6, 5, 6.2);
    const s = breathe(time, i + 1, 0.05, 3.8);
    const x = bx0 + d.dx;
    const y = by0 + d.dy;
    const r = r0 * s;

    halo(canvas, x, y, r * 1.9, P.amber, 0.18 * bright, r * 0.9);
    glowOrb(canvas, x, y, r, P.whiteHot, P.amber, 0.85 * bright, 0.55 * bright);
    glowOrb(canvas, x, y, r * 0.62, P.amberCore, P.amber, 0.5 * bright, 0.35 * bright);
    // specular highlight
    const sp = additivePaint();
    sp.setColor(col(P.whiteHot, 0.9 * bright));
    canvas.drawCircle(x - r * 0.28, y - r * 0.3, r * 0.13, sp);
    // budding daughter — pulses (division)
    if (vigor > 0.25) {
      const ba = Math.PI * lerp(-0.4, 0.4, rng()) - 0.4;
      const pulse = 0.7 + 0.3 * Math.sin((time * TAU) / 3.0 + i);
      const bd = r * 0.95;
      const bxp = x + Math.cos(ba) * bd;
      const byp = y + Math.sin(ba) * bd;
      const br = r * lerp(0.34, 0.6, vigor) * pulse;
      halo(canvas, bxp, byp, br * 1.6, P.amber, 0.12 * bright, br * 0.9);
      glowOrb(canvas, bxp, byp, br, P.whiteHot, P.amber, 0.7 * bright, 0.5 * bright);
    }
  }
}

// LAB: bead-like violet rods in chains — bacteria outnumber yeast
function drawLAB(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const m = st.microbeActivity;
  const rng = mulberry32(211);
  const chains = Math.round(lerp(1, 10, m));
  const bright = lerp(0.5, 0.95, m);
  for (let i = 0; i < chains; i++) {
    const cx0 = lerp(38, W - 38, rng());
    const cy0 = lerp(50, H - 50, rng());
    const ang = rng() * TAU;
    const beads = 2 + Math.floor(rng() * 3);
    const br = lerp(4.5, 6.5, rng());
    const step = br * 1.5;
    const d = drift(time, i + 40, 7, 6, 5.4);
    const sway = Math.sin((time * TAU) / 4.6 + i) * 0.22;
    for (let b = 0; b < beads; b++) {
      const along = (b - (beads - 1) / 2) * step;
      const a2 = ang + sway;
      const x = cx0 + d.dx + Math.cos(a2) * along;
      const y = cy0 + d.dy + Math.sin(a2) * along;
      const poleBoost = b === 0 || b === beads - 1 ? 1.25 : 1.0;
      halo(canvas, x, y, br * 1.7, P.lab, 0.12 * bright, br * 1.0);
      glowOrb(canvas, x, y, br, P.labHot, P.lab, 0.8 * bright * poleBoost, 0.5 * bright);
    }
  }
}

// Amylase: teal rings — the autolyse workhorse, fades as ferment proceeds
function drawAmylase(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const emerge = clamp(1 - smooth(0.04, 0.3, st.fermentation), 0, 1) * 0.9 + 0.1 * st.sugarAvail;
  if (emerge < 0.04) return;
  const rng = mulberry32(53);
  const count = 3;
  for (let i = 0; i < count; i++) {
    const x0 = lerp(50, W - 50, rng());
    const y0 = lerp(60, H - 70, rng());
    const rr = lerp(11, 15, rng());
    const d = drift(time, i + 70, 8, 7, 7.0);
    const x = x0 + d.dx;
    const y = y0 + d.dy;
    ring(canvas, x, y, rr, rr * 0.32, P.amylase, 0.5 * emerge, rr * 0.25);
    ring(canvas, x, y, rr, rr * 0.12, P.amylaseHot, 0.6 * emerge, 0);
    // faint cleaved-sugar specks flung off the rim (active enzyme)
    const specks = 3;
    for (let s2 = 0; s2 < specks; s2++) {
      const ph = (time * 0.4 + s2 / specks + i) % 1;
      const sa = (s2 / specks) * TAU + time * 0.6;
      const sr = rr * (1.0 + ph * 0.9);
      const sx = x + Math.cos(sa) * sr;
      const sy = y + Math.sin(sa) * sr;
      glowOrb(canvas, sx, sy, 2.4, P.amberCore, P.amber, 0.5 * emerge * (1 - ph), 0.3 * emerge * (1 - ph));
    }
  }
}

// Protease: red lobes — appear as gluten damage / acidity rise (late)
function drawProtease(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const emerge = Math.max(smooth(0.12, 0.7, st.glutenDamage), smooth(0.55, 1.0, st.acidity));
  if (emerge < 0.04) return;
  const rng = mulberry32(131);
  const count = Math.round(lerp(1, 4, emerge));
  for (let i = 0; i < count; i++) {
    const x0 = lerp(48, W - 48, rng());
    const y0 = lerp(70, H - 60, rng());
    const rr = lerp(7, 10, rng());
    const d = drift(time, i + 90, 5, 4, 6.6);
    const open = 0.5 + 0.5 * emerge; // hyperactive form splays open
    const x = x0 + d.dx;
    const y = y0 + d.dy;
    halo(canvas, x, y, rr * 1.8, P.protease, 0.14 * emerge, rr * 1.0);
    glowOrb(canvas, x - rr * 0.35 * open, y, rr, P.proteaseHot, P.protease, 0.7 * emerge, 0.5 * emerge);
    glowOrb(canvas, x + rr * 0.35 * open, y + rr * 0.18, rr * 0.85, P.proteaseHot, P.protease, 0.6 * emerge, 0.45 * emerge);
  }
}

// Acetic acid: small yellow-green flecks — concentrate as acidity rises (late)
function drawAcetic(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const emerge = smooth(0.35, 0.85, st.acidity);
  if (emerge < 0.04) return;
  const rng = mulberry32(177);
  const count = Math.round(lerp(1, 5, st.acidity));
  for (let i = 0; i < count; i++) {
    const x0 = lerp(44, W - 44, rng());
    const y0 = lerp(56, H - 56, rng());
    const d = drift(time, i + 120, 9, 8, 5.0);
    const x = x0 + d.dx;
    const y = y0 + d.dy;
    glowOrb(canvas, x, y, 5.5, P.aceticHot, P.acetic, 0.6 * emerge, 0.4 * emerge);
  }
}

// CO₂ bubbles: inflate + rise with gasVolume
function drawBubbles(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const gas = st.gasVolume;
  if (gas < 0.03) return;
  const rng = mulberry32(311);
  const count = Math.round(lerp(0, 14, gas));
  for (let i = 0; i < count; i++) {
    const x0 = lerp(20, W - 20, rng());
    const life = lerp(4.5, 7.5, rng());
    const phase = rng();
    const frac = (time / life + phase) % 1;
    const size = lerp(3, 15, gas) * (0.5 + 0.5 * rng()) * (0.6 + 0.4 * frac);
    const rise = lerp(H * 0.25, H * 0.85, gas);
    const x = x0 + Math.sin(frac * TAU * 1.5 + i) * 7;
    const y = H - 6 - frac * rise;
    const fade = Math.sin(clamp(frac, 0, 1) * Math.PI); // in then out
    if (fade < 0.03) continue;
    // faint interior fill so the bubble reads as a luminous gas cell, not a hoop
    glowOrb(canvas, x, y, size, P.gluten, P.gluten, 0.1 * fade, 0.05 * fade);
    ring(canvas, x, y, size, 1.5, P.glutenHot, 0.6 * fade, size * 0.28);
    // bright specular rim highlight on the film
    const sp = additivePaint();
    sp.setColor(col(P.whiteHot, 0.6 * fade));
    canvas.drawCircle(x - size * 0.28, y - size * 0.28, Math.max(1.2, size * 0.18), sp);
  }
}

// Gluten network: orange filaments + glowing junction nodes.
// organize (glutenStrength): slack/dim -> aligned/bright lattice
// fray (glutenDamage): thins, dims, snaps strands, extinguishes nodes
function drawGluten(canvas: any, st: DoughState, W: number, H: number, time: number) {
  'worklet';
  const organize = st.glutenStrength;
  const fray = st.glutenDamage;
  const rng = mulberry32(7);
  const COLS = 5;
  const ROWS = 4;
  const x0 = 36;
  const x1 = W - 36;
  const y0 = 50;
  const y1 = H - 42;
  const slack = 1 - organize;
  // Persistent per-node irregularity (kept even when fully organized) + extra
  // slack wander when the network is relaxed. A protein mesh is aligned but
  // never a perfect grid, so a baseline jitter always survives.
  const jBase = 11;
  const nodes: { x: number; y: number; v: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gx = lerp(x0, x1, c / (COLS - 1));
      const gy = lerp(y0, y1, r / (ROWS - 1));
      const jx = (rng() * 2 - 1) * (jBase + 26 * slack);
      const jy = (rng() * 2 - 1) * (jBase * 0.85 + 22 * slack);
      const nvar = lerp(0.8, 1.2, rng()); // node-size variety
      // gentle live shimmer of the mesh
      const sh = Math.sin((time * TAU) / 7 + c * 0.7 + r * 0.9) * 1.4 * (0.4 + organize * 0.6);
      nodes.push({ x: gx + jx, y: gy + jy + sh, v: nvar });
    }
  }
  const at = (c: number, r: number) => nodes[r * COLS + c];
  const strandA = lerp(0.14, 0.6, organize) * (1 - 0.8 * fray);
  const strandW = lerp(1.0, 4.0, organize) * (1 - 0.55 * fray);
  const srng = mulberry32(7013);
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const n = at(c, r);
      if (c < COLS - 1) drawStrand(canvas, n, at(c + 1, r), strandW, strandA, fray, organize, time, idx++, srng);
      if (r < ROWS - 1) drawStrand(canvas, n, at(c, r + 1), strandW, strandA, fray, organize, time, idx++, srng);
    }
  }
  // A few diagonal cross-links so the web reads tangled, not like graph paper.
  const drng = mulberry32(9161);
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const pick = drng();
      if (pick < 0.22)
        drawStrand(canvas, at(c, r), at(c + 1, r + 1), strandW * 0.72, strandA * 0.62, fray, organize, time, idx++, srng);
      else if (pick < 0.4)
        drawStrand(canvas, at(c + 1, r), at(c, r + 1), strandW * 0.72, strandA * 0.62, fray, organize, time, idx++, srng);
    }
  }
  const alive = clamp(organize * (1 - fray), 0, 1);
  if (alive >= 0.04) {
    for (const n of nodes) {
      const nr = lerp(2.0, 6.5, organize) * (1 - 0.6 * fray) * n.v;
      halo(canvas, n.x, n.y, nr * 2.0, P.gluten, 0.16 * alive, nr * 1.1);
      glowOrb(canvas, n.x, n.y, nr, P.glutenHot, P.gluten, 0.9 * alive, 0.6 * alive);
    }
  }
}
// One strand a→b as a curved, sagging filament (not a straight lattice edge):
// a quadratic bow perpendicular to the run, deterministic thickness variation,
// and a live wobble. Frays into two recoiled curved stubs as damage rises.
function drawStrand(
  canvas: any,
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  alpha: number,
  fray: number,
  organize: number,
  time: number,
  idx: number,
  rng: () => number,
) {
  'worklet';
  if (alpha < 0.01) return;
  const thick = w * lerp(0.6, 1.45, rng());
  const bowSign = rng() < 0.5 ? -1 : 1;
  const bowMag = lerp(5, 14, rng());
  const snap = rng();
  const p = additivePaint();
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(thick);
  p.setStrokeCap(StrokeCap.Round);
  p.setColor(col(P.gluten, alpha));
  p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, lerp(0.6, 2.2, alpha), false));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len; // unit perpendicular
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // strands sag more when slack, tighten (but never fully straighten) when organized
  const wob = Math.sin((time * TAU) / 6 + idx * 1.3) * 1.6 * (0.4 + organize * 0.6);
  const off = bowSign * bowMag * (0.55 + 0.45 * (1 - organize)) + wob;
  const cx = mx + nx * off;
  const cy = my + ny * off;
  if (fray > 0.35 && snap < fray) {
    // snapped mid-strand: two curved stubs recoil apart along the normal
    const g = lerp(0.12, 0.34, fray);
    const recoil = bowSign * 9 * fray;
    p.setColor(col(P.gluten, alpha * 0.7));
    const path = Skia.Path.Make();
    path.moveTo(a.x, a.y);
    path.quadTo(lerp(a.x, cx, 0.5), lerp(a.y, cy, 0.5), lerp(a.x, cx, 1 - g) + nx * recoil, lerp(a.y, cy, 1 - g) + ny * recoil);
    path.moveTo(lerp(cx, b.x, g) - nx * recoil, lerp(cy, b.y, g) - ny * recoil);
    path.quadTo(lerp(cx, b.x, 0.5), lerp(cy, b.y, 0.5), b.x, b.y);
    canvas.drawPath(path, p);
  } else {
    const path = Skia.Path.Make();
    path.moveTo(a.x, a.y);
    path.quadTo(cx, cy, b.x, b.y);
    canvas.drawPath(path, p);
  }
}

// ── React component ──────────────────────────────────────────────────────────
interface Props {
  /** 'idle' (dim/near-empty) | 'autolyse' (fixed early, amylase-led) | 'bulk'. */
  mode: 'idle' | 'autolyse' | 'bulk';
  /** Bulk fermentation progress 0..1+ (elapsed / target bulk time). */
  fraction?: number;
  inputs?: BakerInputs;
  folds?: FoldEvent[];
}

export function SkiaFermentationScene({
  mode,
  fraction = 0,
  inputs = DEFAULT_INPUTS,
  folds = [],
}: Props) {
  const [size, setSize] = useState({ w: FALLBACK_W, h: FALLBACK_H });

  // Map the scene mode → a progress point on the doughState curve engine.
  //   bulk     → live fraction
  //   autolyse → a fixed early point; at this progress doughState naturally
  //              yields strong amylase, forming gluten, and ~no microbes.
  //   idle     → progress 0 (near-empty resting field), rendered extra-dim.
  const progress = mode === 'bulk' ? clamp(fraction, 0, 1) : mode === 'autolyse' ? 0.06 : 0.0;
  const dim = mode === 'idle' ? 0.28 : 1.0;

  // State is computed once on the JS thread — it does NOT depend on the clock.
  const st = useMemo(
    () => computeDoughState(progress, inputs, folds),
    [progress, inputs, folds],
  );

  const { w: W, h: H } = size;
  const clock = useClock(); // monotonic ms, drives motion only

  // Derived SkPicture: rebuilt each frame on the UI thread as the clock ticks.
  const picture = useDerivedValue(() => {
    const time = clock.value / 1000; // seconds — matches scene.js clock units
    return createPicture((canvas) => {
      drawScene(canvas, st, W, H, time);
    });
  }, [st, W, H]);

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0 && (width !== W || height !== H)) {
          setSize({ w: Math.round(width), h: Math.round(height) });
        }
      }}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}
    >
      {/* backgroundColor black is required: additive glow over pure black. */}
      <Canvas style={{ width: W, height: H, backgroundColor: 'black' }}>
        <Group opacity={dim}>
          <Picture picture={picture} />
        </Group>
      </Canvas>
    </View>
  );
}

export default SkiaFermentationScene;
