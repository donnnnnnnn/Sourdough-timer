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
 * ── How it's structured (performance) ───────────────────────────────────────
 * A `buildLayout(st, W, H)` pass (memoised on st+size) computes every
 * per-organism CONSTANT once — positions, seeds, radii, poses, budding/fission
 * assignments, gluten node grid + strand connectivity, protease→node attack
 * targets. Those constants only change when the dough STATE or canvas size
 * changes (rarely), NOT every frame. The per-frame draw code layers cheap
 * time-based MOTION (drift, breathing, budding phase, rising bubbles, shimmer,
 * a shared slow flow current) on top of that static layout. So the expensive
 * work (RNG, array building, node/strand topology) is amortised and the hot
 * path is mostly trig + draw calls.
 *
 * ── How it animates ─────────────────────────────────────────────────────────
 * Motion comes from a JS-thread animation clock (requestAnimationFrame,
 * ~30fps) fed into a plain SkPicture (useMemo). The imperative draw code below
 * mirrors scratchpad-spike/web/scene.js (the CanvasKit reference that was
 * screenshot-validated) as closely as the RN Skia API allows.
 *
 * NOTE: this used to animate via Skia's useClock + reanimated useDerivedValue
 * (UI-thread worklet). That crashed the app on launch on this Skia 2.6.2 +
 * reanimated 4.3 / worklets 0.8 combo — createPicture() inside the worklet threw
 * "undefined is not a function" (see docs/SKIA-HANDOFF.md). Driving the clock
 * from JS keeps every drawing call and Skia GPU primitive identical; only the
 * per-frame trigger moved off the UI thread.
 *
 * ⚠️ DO NOT add `'worklet'` directives to any function in this file. The
 * worklets Babel plugin rewrites a `'worklet'`-marked `function foo(){}` into a
 * var-assigned factory that captures its deps at the declaration site, which
 * breaks JS function hoisting and crashed the app for a full day. Every draw
 * function here MUST stay a plain hoisted `function`. See docs/SKIA-HANDOFF.md.
 *
 * ── Glass panels: real blur without backdrop filters ────────────────────────
 * The frosted-glass panels behind the UI cards are NOT drawn with a backdrop
 * filter (`saveLayer` + backdrop image filter sampling the destination, or
 * the declarative `<BackdropBlur>`). Both were tried and confirmed broken on
 * a Pixel 9: the in-picture version was a no-op (no blur), and the
 * declarative version made Skia's native surface render ABOVE the rest of
 * the app's UI (buttons were hidden underneath it). A third attempt —
 * rendering organisms into a separate offscreen SkSurface, snapshotting to
 * an SkImage, and drawImage-ing that through a blur filter — ALSO produced
 * no visible blur on-device (an SkImage from a second GPU surface, replayed
 * inside a recorded SkPicture, is a rare code path).
 *
 * What actually works: draw organisms once (full canvas, "in focus"), then
 * for each glass panel, clip to its rounded rect, open `canvas.saveLayer()`
 * with a paint carrying `ImageFilter.MakeBlur`, and redraw the organisms
 * AGAIN directly into that layer — see `drawGlassPanels`. A saveLayer image
 * filter only affects content drawn after it opens, not the existing
 * canvas, so this is NOT a backdrop read; it stays on Skia's ordinary
 * layer-filter path and composites correctly under the native UI.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import React from 'react';
import {
  Canvas,
  Picture,
  Skia,
  createPicture,
  vec,
  BlendMode,
  PaintStyle,
  StrokeCap,
  BlurStyle,
  TileMode,
  ClipOp,
  type SkPicture,
} from '@shopify/react-native-skia';
import {
  computeDoughState,
  DEFAULT_INPUTS,
  type BakerInputs,
  type FoldEvent,
  type DoughState,
} from '../model/doughState';
import { screenRects, type GlassScreenRect } from './glassStage';

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

// ── math helpers (pure, no closures over host objects) ───────────────────────
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, a: number, b: number) => {
  return x < a ? a : x > b ? b : x;
};
const lerp = (a: number, b: number, t: number) => {
  return a + (b - a) * t;
};
const smooth = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

// deterministic per-index drift so motion is smooth + stable (no RNG per frame)
function drift(t: number, seed: number, ampX: number, ampY: number, period: number) {
  const ph = seed * 1.7;
  return {
    dx: Math.sin((t * TAU) / period + ph) * ampX,
    dy: Math.cos((t * TAU) / (period * 0.85) + ph * 1.3) * ampY,
  };
}
function breathe(t: number, seed: number, amp: number, period: number) {
  return 1 + Math.sin((t * TAU) / period + seed * 2.1) * amp;
}
// gentle per-organism opacity shimmer — specimens "twinkle" under the scope
function twinkle(t: number, seed: number, amp: number, period: number) {
  return 1 + Math.sin((t * TAU) / period + seed * 6.28) * amp;
}
// A very slow, smooth shared current so the whole population drifts cohesively
// instead of every dot doing its own thing. Small amplitude — a collective sway,
// not a wind. Pure function of position + time.
function flow(x: number, y: number, t: number) {
  return {
    fx: Math.sin(y * 0.011 + t * 0.24) * 3.0 + Math.cos(x * 0.009 - t * 0.17) * 1.5,
    fy: Math.cos(x * 0.012 - t * 0.2) * 2.4 + Math.sin(y * 0.008 + t * 0.13) * 1.2,
  };
}

// ── low-level additive primitives (RN Skia canvas API mirrors CanvasKit) ─────
// These run hundreds of times per recorded frame, so they must not allocate.
// Skia draw calls SNAPSHOT paint/path state into the recording at call time,
// so one scratch paint (reset per call), one scratch path, and a small
// rotating pool of color arrays are safe to mutate between calls. The
// previous versions allocated fresh Paint + parsed-string Color (+ often a
// MaskFilter) objects per call — tens of thousands of short-lived objects a
// second, and the resulting GC pauses visibly hitched the JS-driven clock.
const SCRATCH_PAINT = Skia.Paint();
function additivePaint() {
  const p = SCRATCH_PAINT;
  p.setShader(null);
  p.setMaskFilter(null);
  p.setStyle(PaintStyle.Fill);
  p.setStrokeCap(StrokeCap.Butt);
  p.setAntiAlias(true);
  p.setBlendMode(BlendMode.Plus);
  return p;
}

// Rotating color pool: a single gradient uses at most 3 colors at once, so 8
// slots is ample headroom before a slot gets overwritten.
const COLOR_POOL = Array.from({ length: 8 }, () => new Float32Array(4));
let colorSlot = 0;
function col(rgb: RGB, a: number) {
  const aa = a < 0 ? 0 : a > 1 ? 1 : a;
  const c = COLOR_POOL[(colorSlot = (colorSlot + 1) & 7)];
  c[0] = rgb[0] / 255;
  c[1] = rgb[1] / 255;
  c[2] = rgb[2] / 255;
  c[3] = aa;
  return c;
}

// Blur mask filters are immutable and position-independent — cache by sigma,
// quantized to 0.25px steps so animated sigmas keep the cache small (the
// quantization is invisible; sigmas here are 1–20px soft glows).
const MASK_CACHE = new Map<number, ReturnType<typeof Skia.MaskFilter.MakeBlur>>();
function blurMask(sigma: number) {
  const key = Math.max(0.25, Math.round(sigma * 4) / 4);
  let f = MASK_CACHE.get(key);
  if (!f) {
    f = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, key, false);
    MASK_CACHE.set(key, f);
  }
  return f;
}

const SCRATCH_PATH = Skia.Path.Make();

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
  if (a <= 0.002) return;
  const p = additivePaint();
  p.setColor(col(rgb, a));
  p.setMaskFilter(blurMask(sigma));
  canvas.drawCircle(x, y, r, p);
}
function dot(canvas: any, x: number, y: number, r: number, rgb: RGB, a: number) {
  if (a <= 0.002 || r <= 0.2) return;
  const p = additivePaint();
  p.setColor(col(rgb, a));
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
  if (a <= 0.002) return;
  const p = additivePaint();
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(w);
  p.setColor(col(rgb, a));
  if (sigma > 0) p.setMaskFilter(blurMask(sigma));
  canvas.drawCircle(x, y, r, p);
}

// ── Precomputed layout types ─────────────────────────────────────────────────
// Everything here is a CONSTANT for a given (st, W, H). Built once in
// buildLayout() and reused across frames; the draw pass only adds motion.

type YeastPose = 'quiescent' | 'budding' | 'starved';
interface YeastCell {
  x: number;
  y: number;
  seed: number;
  idx: number;
  r0: number;
  bright: number;
  pose: YeastPose;
  budAngle: number;
  budPeriod: number;
  driftP: number;
  breatheP: number;
  twkP: number;
  rotSpeed: number;
  scars: { a: number; d: number }[];
  siblings: { a: number; d: number; r: number }[];
}
interface LabChain {
  x: number;
  y: number;
  seed: number;
  idx: number;
  ang: number;
  beads: number;
  br: number;
  bright: number;
  curve: number;
  swayP: number;
  driftP: number;
  rotSpeed: number;
  fissionBead: number; // index of a bead mid-division, or -1
  twkP: number;
}
interface AmylaseMol {
  x: number;
  y: number;
  seed: number;
  idx: number;
  rr: number;
  driftP: number;
  spinDir: number;
}
interface ProteaseMol {
  x: number;
  y: number;
  seed: number;
  idx: number;
  rr: number;
  driftP: number;
  biteP: number;
  targetNode: number; // gluten node index it's clamped onto, or -1 (free)
  approach: number; // 0..1 how far it has closed on the node
}
interface AceticCluster {
  x: number;
  y: number;
  seed: number;
  idx: number;
  driftP: number;
  members: { a: number; d: number; r: number }[];
}
interface Bubble {
  x0: number;
  life: number;
  phase: number;
  seed: number;
  sizeMul: number;
  wobAmp: number;
  wobFreq: number;
  pairDX: number; // horizontal convergence toward a partner (coalescence), 0 = none
}
interface GlutenNode {
  x: number; // static jittered x
  baseY: number; // static jittered y
  v: number; // node-size variety
  shPhase: number;
  attacked: boolean; // a protease is docked here → junction dims
}
interface GlutenStrand {
  ai: number;
  bi: number;
  wMul: number;
  aMul: number;
  thickMul: number;
  bowSign: number;
  bowMag: number;
  snap: number;
  idx: number;
}
interface GlutenLayout {
  nodes: GlutenNode[];
  strands: GlutenStrand[];
  cols: number;
  rows: number;
  organize: number;
  fray: number;
  alive: number;
}
interface SceneLayout {
  yeast: YeastCell[];
  lab: LabChain[];
  amylase: AmylaseMol[];
  amylaseEmerge: number;
  protease: ProteaseMol[];
  proteaseEmerge: number;
  acetic: AceticCluster[];
  aceticEmerge: number;
  bubbles: Bubble[];
  gluten: GlutenLayout;
  haze: number;
}

// ── Layout builder — all per-organism constants, computed ONCE per st/size ────
function buildLayout(st: DoughState, W: number, H: number): SceneLayout {
  const gluten = buildGluten(st, W, H);
  return {
    yeast: buildYeast(st, W, H),
    lab: buildLAB(st, W, H),
    amylase: buildAmylase(st, W, H),
    amylaseEmerge:
      clamp(1 - smooth(0.04, 0.3, st.fermentation), 0, 1) * 0.9 + 0.1 * st.sugarAvail,
    protease: buildProtease(st, W, H, gluten),
    proteaseEmerge: Math.max(
      smooth(0.12, 0.7, st.glutenDamage),
      smooth(0.55, 1.0, st.acidity),
    ),
    acetic: buildAcetic(st, W, H),
    aceticEmerge: smooth(0.35, 0.85, st.acidity),
    bubbles: buildBubbles(st, W, H),
    gluten,
    haze: smooth(0.45, 1.0, st.acidity),
  };
}

function buildYeast(st: DoughState, W: number, H: number): YeastCell[] {
  const m = st.microbeActivity;
  const vigor = m;
  const rng = mulberry32(99);
  const count = Math.round(lerp(2, 7, m));
  // Blue-noise-ish spread via the plastic-number (R2) low-discrepancy sequence.
  const R2A = 0.7548776662466927;
  const R2B = 0.5698402909980532;
  const cells: YeastCell[] = [];
  for (let i = 0; i < count; i++) {
    const fx = (0.5 + R2A * (i + 1)) % 1;
    const fy = (0.5 + R2B * (i + 1)) % 1;
    const jx = (rng() * 2 - 1) * 24;
    const jy = (rng() * 2 - 1) * 24;
    const x = clamp(lerp(52, W - 52, fx) + jx, 46, W - 46);
    const y = clamp(lerp(66, H - 72, fy) + jy, 58, H - 64);
    const poseRoll = rng();
    // ~1 in 5 cells read as "past its prime" (dimmer, no division); the rest
    // bud when the colony is vigorous, else sit quiescent.
    let pose: YeastPose;
    if (poseRoll < 0.2) pose = 'starved';
    else if (vigor > 0.28) pose = 'budding';
    else pose = 'quiescent';
    const dim = pose === 'starved' ? 0.55 : 1.0;
    const r0 = lerp(14, 22, rng()) * lerp(0.75, 1.05, vigor) * (pose === 'starved' ? 0.86 : 1);
    const bright = lerp(0.55, 1.0, vigor) * dim;
    // 0–2 ring-shaped bud scars (evidence of past divisions) on the mother.
    const scarN = pose === 'starved' ? 2 : Math.floor(rng() * 2) + (vigor > 0.5 ? 1 : 0);
    const scars: { a: number; d: number }[] = [];
    for (let s = 0; s < scarN; s++) scars.push({ a: rng() * TAU, d: lerp(0.6, 0.85, rng()) });
    // A thriving colony forms grape-like clumps: a few cells get sibling minis.
    const siblings: { a: number; d: number; r: number }[] = [];
    if (pose === 'budding' && vigor > 0.6 && rng() < 0.45) {
      const sn = 1 + Math.floor(rng() * 2);
      for (let s = 0; s < sn; s++)
        siblings.push({ a: rng() * TAU, d: lerp(1.15, 1.5, rng()), r: lerp(0.4, 0.62, rng()) });
    }
    cells.push({
      x,
      y,
      seed: (i + 1) / (count + 1),
      idx: i,
      r0,
      bright,
      pose,
      budAngle: rng() * TAU,
      budPeriod: lerp(5.5, 9.5, rng()),
      driftP: lerp(5.4, 7.4, rng()),
      breatheP: lerp(3.2, 4.8, rng()),
      twkP: lerp(2.4, 4.2, rng()),
      rotSpeed: (rng() * 2 - 1) * 0.12,
      scars,
      siblings,
    });
  }
  return cells;
}

function buildLAB(st: DoughState, W: number, H: number): LabChain[] {
  const m = st.microbeActivity;
  const rng = mulberry32(211);
  const chains = Math.round(lerp(1, 10, m));
  const bright = lerp(0.5, 0.95, m);
  const out: LabChain[] = [];
  for (let i = 0; i < chains; i++) {
    const beads = 2 + Math.floor(rng() * 4); // 2..5 (doublet → long chain)
    // one chain in ~three is caught mid-division (a bead with a septum)
    const fissionBead = rng() < 0.34 ? Math.floor(rng() * beads) : -1;
    out.push({
      x: lerp(38, W - 38, rng()),
      y: lerp(50, H - 50, rng()),
      seed: (i + 1) / (chains + 1),
      idx: i,
      ang: rng() * TAU,
      beads,
      br: lerp(4.5, 6.5, rng()),
      bright,
      curve: (rng() * 2 - 1) * 0.06, // gentle chain curvature
      swayP: lerp(4.0, 5.4, rng()),
      driftP: lerp(4.8, 6.2, rng()),
      rotSpeed: (rng() * 2 - 1) * 0.09,
      fissionBead,
      twkP: lerp(2.6, 4.0, rng()),
    });
  }
  return out;
}

function buildAmylase(st: DoughState, W: number, H: number): AmylaseMol[] {
  const rng = mulberry32(53);
  const out: AmylaseMol[] = [];
  for (let i = 0; i < 3; i++) {
    out.push({
      x: lerp(50, W - 50, rng()),
      y: lerp(60, H - 70, rng()),
      seed: (i + 1) / 4,
      idx: i,
      rr: lerp(11, 15, rng()),
      driftP: lerp(6.4, 7.8, rng()),
      spinDir: rng() < 0.5 ? -1 : 1,
    });
  }
  return out;
}

function buildProtease(st: DoughState, W: number, H: number, gluten: GlutenLayout): ProteaseMol[] {
  const emerge = Math.max(smooth(0.12, 0.7, st.glutenDamage), smooth(0.55, 1.0, st.acidity));
  if (emerge < 0.04) return [];
  const rng = mulberry32(131);
  const count = Math.round(lerp(1, 4, emerge));
  // As damage rises, more protease dock onto gluten junctions (the antagonist
  // beat, art-spec B4/C3). We pick distinct nodes so they don't stack.
  const nodeN = gluten.nodes.length;
  const takenNodes: number[] = [];
  const out: ProteaseMol[] = [];
  for (let i = 0; i < count; i++) {
    // fraction of protease that are actively attacking scales with damage
    const attacks = smooth(0.25, 0.75, st.glutenDamage);
    const doAttack = nodeN > 0 && rng() < attacks;
    let targetNode = -1;
    if (doAttack) {
      for (let tries = 0; tries < 6; tries++) {
        const cand = Math.floor(rng() * nodeN);
        if (!takenNodes.includes(cand)) {
          targetNode = cand;
          takenNodes.push(cand);
          break;
        }
      }
    }
    out.push({
      x: lerp(48, W - 48, rng()),
      y: lerp(70, H - 60, rng()),
      seed: (i + 1) / (count + 1),
      idx: i,
      rr: lerp(7, 10, rng()),
      driftP: lerp(6.0, 7.2, rng()),
      biteP: lerp(1.6, 2.6, rng()),
      targetNode,
      approach: targetNode >= 0 ? smooth(0.2, 0.8, st.glutenDamage) : 0,
    });
    if (targetNode >= 0) gluten.nodes[targetNode].attacked = true;
  }
  return out;
}

function buildAcetic(st: DoughState, W: number, H: number): AceticCluster[] {
  const emerge = smooth(0.35, 0.85, st.acidity);
  if (emerge < 0.04) return [];
  const rng = mulberry32(177);
  const clusters = Math.round(lerp(1, 4, st.acidity));
  const out: AceticCluster[] = [];
  for (let i = 0; i < clusters; i++) {
    // "acid burst": more molecules share a glow where acidity concentrates.
    const memberN = 1 + Math.round(lerp(0, 3, st.acidity) * rng() + st.acidity * 1.2);
    const members: { a: number; d: number; r: number }[] = [];
    for (let mi = 0; mi < Math.max(1, memberN); mi++) {
      members.push({
        a: rng() * TAU,
        d: mi === 0 ? 0 : lerp(4, 9, rng()),
        r: lerp(3.5, 5.5, rng()),
      });
    }
    out.push({
      x: lerp(44, W - 44, rng()),
      y: lerp(56, H - 56, rng()),
      seed: (i + 1) / (clusters + 1),
      idx: i,
      driftP: lerp(4.6, 5.6, rng()),
      members,
    });
  }
  return out;
}

function buildBubbles(st: DoughState, W: number, H: number): Bubble[] {
  const gas = st.gasVolume;
  if (gas < 0.03) return [];
  const rng = mulberry32(311);
  const count = Math.round(lerp(0, 14, gas));
  const out: Bubble[] = [];
  for (let i = 0; i < count; i++) {
    // ~1 in 4 bubbles drifts toward its neighbour's column as it rises, so the
    // two overlap near the top — an occasional coalescence read (additive glow
    // makes the overlap look like one merged gas cell).
    const pairDX = rng() < 0.25 ? (rng() * 2 - 1) * lerp(14, 34, gas) : 0;
    out.push({
      x0: lerp(20, W - 20, rng()),
      life: lerp(4.5, 7.5, rng()),
      phase: rng(),
      seed: rng(),
      sizeMul: 0.5 + 0.5 * rng(),
      wobAmp: lerp(4, 11, rng()),
      wobFreq: lerp(1.1, 1.9, rng()),
      pairDX,
    });
  }
  return out;
}

function buildGluten(st: DoughState, W: number, H: number): GlutenLayout {
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
  const jBase = 11;
  const nodes: GlutenNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gx = lerp(x0, x1, c / (COLS - 1));
      const gy = lerp(y0, y1, r / (ROWS - 1));
      const jx = (rng() * 2 - 1) * (jBase + 26 * slack);
      const jy = (rng() * 2 - 1) * (jBase * 0.85 + 22 * slack);
      const nvar = lerp(0.8, 1.2, rng());
      nodes.push({
        x: gx + jx,
        baseY: gy + jy,
        v: nvar,
        shPhase: c * 0.7 + r * 0.9,
        attacked: false,
      });
    }
  }
  // Strand connectivity + per-strand random params, precomputed once (was
  // re-seeded RNG every frame before). Draw applies live wobble/fray on top.
  const srng = mulberry32(7013);
  const strands: GlutenStrand[] = [];
  let idx = 0;
  const pushStrand = (ai: number, bi: number, wMul: number, aMul: number) => {
    strands.push({
      ai,
      bi,
      wMul,
      aMul,
      thickMul: lerp(0.6, 1.45, srng()),
      bowSign: srng() < 0.5 ? -1 : 1,
      bowMag: lerp(5, 14, srng()),
      snap: srng(),
      idx: idx++,
    });
  };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ni = r * COLS + c;
      if (c < COLS - 1) pushStrand(ni, r * COLS + (c + 1), 1, 1);
      if (r < ROWS - 1) pushStrand(ni, (r + 1) * COLS + c, 1, 1);
    }
  }
  // A few diagonal cross-links so the web reads tangled, not like graph paper.
  const drng = mulberry32(9161);
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const pick = drng();
      if (pick < 0.22) pushStrand(r * COLS + c, (r + 1) * COLS + (c + 1), 0.72, 0.62);
      else if (pick < 0.4) pushStrand(r * COLS + (c + 1), (r + 1) * COLS + c, 0.72, 0.62);
    }
  }
  return {
    nodes,
    strands,
    cols: COLS,
    rows: ROWS,
    organize,
    fray,
    alive: clamp(organize * (1 - fray), 0, 1),
  };
}

// live y of a gluten node (static x + a gentle breathing shimmer)
function glutenNodeY(n: GlutenNode, time: number, organize: number) {
  return n.baseY + Math.sin((time * TAU) / 7 + n.shPhase) * 1.4 * (0.4 + organize * 0.6);
}

// ── the scene ────────────────────────────────────────────────────────────────
// Just the organisms — drawn identically whether the target is the visible
// canvas or the offscreen surface used to source the glass-panel blur.
function drawOrganisms(
  canvas: any,
  st: DoughState,
  layout: SceneLayout,
  W: number,
  H: number,
  time: number,
  dim: number,
) {
  const dimmed = dim < 0.999;
  if (dimmed) {
    const lp = Skia.Paint();
    lp.setAlphaf(clamp(dim, 0, 1));
    canvas.saveLayer(lp, null);
  }
  drawAcidHaze(canvas, layout, W, H);
  drawGluten(canvas, layout.gluten, time);
  drawAmylase(canvas, layout, st, time);
  drawProtease(canvas, layout, st, time);
  drawLAB(canvas, layout, st, time);
  drawYeast(canvas, layout, st, time);
  drawAcetic(canvas, layout, time);
  drawBubbles(canvas, layout, st, W, H, time);
  if (dimmed) canvas.restore();
}

// Frosted-glass panels: a REAL blur, without ever asking the GPU to sample
// the EXISTING destination canvas (a "backdrop" filter). On this Skia 2.6.2 /
// Android build, invoking a true backdrop filter — either recorded inside
// createPicture(), or as a declarative <BackdropBlur> sibling after
// <Picture> — forces the native Skia surface into a compositing mode that
// renders ABOVE the rest of the app's native views (buttons vanished
// underneath it, confirmed on a Pixel 9). Sampling the destination is the
// thing that breaks.
//
// A prior attempt avoided that by rendering organisms into a separate
// offscreen SkSurface, snapshotting it to an SkImage, then drawImage-ing that
// through an ImageFilter blur. That still didn't blur anything visible on a
// Pixel 9 — an SkImage sourced from a second GPU surface, replayed inside a
// recorded SkPicture, is a much less-travelled code path than the one below.
//
// This version uses `canvas.saveLayer(paintWithImageFilter, bounds)`, which
// is NOT a backdrop filter — it only filters content drawn AFTER the
// saveLayer call, not whatever was already on the canvas. We clip to the
// panel's rounded rect, open a layer with a blur image filter, redraw the
// organisms straight into that layer (so Skia rasterizes just this clipped
// region and blurs it while compositing back), then restore. Ordinary
// layer-filter idiom, same GPU context as everything else on this canvas.
function drawGlassPanels(
  canvas: any,
  glass: GlassScreenRect[],
  orgPicture: SkPicture,
  time: number,
) {
  for (const g of glass) {
    if (g.w <= 1 || g.h <= 1) continue;
    const sigma = g.blur !== null
      ? g.blur
      : 8 + Math.sin((time * TAU) / 7 + g.x * 0.01) * 1.5;
    const rr = Skia.RRectXY(Skia.XYWHRect(g.x, g.y, g.w, g.h), g.radius, g.radius);

    // Real blur: redraw the organisms clipped to this panel, through a
    // saveLayer whose paint carries the blur image filter.
    canvas.save();
    canvas.clipRRect(rr, ClipOp.Intersect, true);

    // CRITICAL: erase the sharp organisms already painted under this panel
    // before drawing the blurred copy. Compositing a translucent blurred
    // copy OVER the sharp original leaves the sharp strokes fully visible
    // through it — which read as "no blur at all" on-device and survived
    // every previous blur attempt. The scene background is pure black, so a
    // black fill restores an empty slate inside the panel.
    const basePaint = Skia.Paint();
    basePaint.setColor(Skia.Color('black'));
    canvas.drawRRect(rr, basePaint);

    const blurPaint = Skia.Paint();
    blurPaint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp));
    canvas.saveLayer(blurPaint, null);
    // Replay the once-per-frame organism recording instead of re-recording
    // every draw call per panel — replay is native-side and near-free.
    canvas.drawPicture(orgPicture);
    canvas.restore(); // composite the blurred layer back
    canvas.restore(); // pop the clip

    canvas.save();
    canvas.clipRRect(rr, ClipOp.Intersect, true);

    // Warm espresso tint (normal blend mutes the additive glow into a pane).
    // g.tint IS the final overlay opacity — the same number the frosted-glass
    // tuner's readout shows — so tuner values port into GlassCard props 1:1.
    const tintPaint = Skia.Paint();
    tintPaint.setColor(Skia.Color(`rgba(22,16,13,${clamp(g.tint, 0, 0.92)})`));
    canvas.drawRRect(rr, tintPaint);

    // Top-down warm sheen.
    const sheenPaint = Skia.Paint();
    sheenPaint.setShader(
      Skia.Shader.MakeLinearGradient(
        vec(g.x, g.y),
        vec(g.x, g.y + g.h),
        [Skia.Color('rgba(255,240,220,0.12)'), Skia.Color('rgba(255,240,220,0.0)')],
        [0, 0.5],
        TileMode.Clamp,
      ),
    );
    canvas.drawRRect(rr, sheenPaint);

    // Hairline bright edge.
    const edgePaint = Skia.Paint();
    edgePaint.setStyle(PaintStyle.Stroke);
    edgePaint.setStrokeWidth(1);
    edgePaint.setColor(Skia.Color('rgba(255,238,212,0.22)'));
    canvas.drawRRect(rr, edgePaint);
    canvas.restore(); // pop the tint/sheen/edge clip
  }
}

function drawScene(
  canvas: any,
  orgPicture: SkPicture,
  glass: GlassScreenRect[],
  time: number,
) {
  // Organisms draw first, across the FULL canvas — this is the "full focus"
  // layer visible in the gaps between UI cards. They were recorded ONCE this
  // frame (see the orgPicture memo in the component); everything here just
  // replays that recording.
  canvas.drawPicture(orgPicture);
  // Glass panels draw LAST, on top, but each one is clipped to its own
  // rounded-rect region (see drawGlassPanels) — so only the area under a
  // card gets the blurred/tinted treatment; everywhere else keeps the
  // full-focus organisms drawn above.
  if (glass.length > 0) {
    drawGlassPanels(canvas, glass, orgPicture, time);
  }
}


// warm haze that deepens with acidity — a soft CENTERED bloom that fades fully
// to pure black well inside the frame (must never read as a glowing rectangle).
function drawAcidHaze(canvas: any, layout: SceneLayout, W: number, H: number) {
  const a = layout.haze;
  if (a < 0.02) return;
  glowOrb(canvas, W * 0.5, H * 0.58, W * 0.42, P.protease, P.protease, 0.045 * a, 0.05 * a);
}

function drawYeast(canvas: any, layout: SceneLayout, st: DoughState, time: number) {
  const vigor = st.microbeActivity;
  for (const cell of layout.yeast) {
    const d = drift(time, cell.idx + 1, 6, 5, cell.driftP);
    const fl = flow(cell.x, cell.y, time);
    const s = breathe(time, cell.idx + 1, 0.05, cell.breatheP);
    const twk = twinkle(time, cell.seed, 0.09, cell.twkP);
    const x = cell.x + d.dx + fl.fx;
    const y = cell.y + d.dy + fl.fy;
    const r = cell.r0 * s;
    const bright = cell.bright * twk;
    const rot = time * cell.rotSpeed;

    // Ovoid cell: each cell gets a per-seed tilt and aspect ratio so the
    // population reads as plump biological cells, not identical circles.
    const tilt = cell.seed * 180 + rot * 17; // degrees (Skia rotate)
    const aspect = lerp(0.72, 0.88, cell.seed);

    canvas.save();
    canvas.translate(x, y);
    canvas.rotate(tilt);
    canvas.scale(1.0, aspect);

    // Outer diffuse halo (the bloom around the cell)
    halo(canvas, 0, 0, r * 1.9, P.amber, 0.18 * bright, r * 0.9);
    // Main cytoplasm body
    glowOrb(canvas, 0, 0, r, P.whiteHot, P.amber, 0.85 * bright, 0.55 * bright);
    // Inner cytoplasm density gradient
    glowOrb(canvas, 0, 0, r * 0.62, P.amberCore, P.amber, 0.5 * bright, 0.35 * bright);
    // Cell wall membrane — thin luminous ring near the edge
    ring(canvas, 0, 0, r * 0.94, Math.max(0.7, r * 0.045), P.amberCore, 0.32 * bright, r * 0.12);

    // Nucleus — bright off-center organelle with its own micro-halo
    const nOff = r * 0.18;
    glowOrb(canvas, nOff, -nOff * 0.6, r * 0.26, P.whiteHot, P.amberCore, 0.55 * bright, 0.35 * bright);
    dot(canvas, nOff, -nOff * 0.6, r * 0.1, P.whiteHot, 0.7 * bright);

    // Vacuole(s) — dim fluid-filled pockets
    if (cell.pose === 'starved') {
      // large vacuole (starved cell: "past its prime")
      glowOrb(canvas, r * 0.2, -r * 0.15, r * 0.4, P.amber, P.amber, 0.16 * bright, 0.1 * bright);
      glowOrb(canvas, -r * 0.15, r * 0.22, r * 0.2, P.amber, P.amber, 0.1 * bright, 0.07 * bright);
    } else {
      glowOrb(canvas, -r * 0.24, r * 0.16, r * 0.16, P.amber, P.amber, 0.12 * bright, 0.08 * bright);
    }

    // Granular cytoplasm — scattered micro-dots for that "grainy" fluorescence look
    const grng = mulberry32(cell.idx * 17 + 131);
    const grains = 5 + Math.floor(bright * 3);
    for (let gi = 0; gi < grains; gi++) {
      const ga = grng() * TAU;
      const gd = grng() * r * 0.68;
      dot(canvas, Math.cos(ga) * gd, Math.sin(ga) * gd, lerp(0.5, 1.3, grng()), P.amberCore, 0.16 * bright * grng());
    }

    // Ring-shaped bud scars from past divisions
    for (const sc of cell.scars) {
      const sx = Math.cos(sc.a + rot) * r * sc.d;
      const sy = Math.sin(sc.a + rot) * r * sc.d;
      ring(canvas, sx, sy, r * 0.16, Math.max(0.8, r * 0.05), P.amberCore, 0.28 * bright, r * 0.1);
    }
    // Slowly-orbiting specular highlight (the cell reads as rotating under the scope)
    const spa = -0.9 + rot;
    dot(canvas, Math.cos(spa) * r * 0.4, Math.sin(spa) * r * 0.4, r * 0.13, P.whiteHot, 0.9 * bright);

    canvas.restore();

    // Sibling minis (grape-like clump at peak colony vigor) — each has its own oval
    for (const sib of cell.siblings) {
      const bx = x + Math.cos(sib.a + rot * 0.6) * r * sib.d;
      const by = y + Math.sin(sib.a + rot * 0.6) * r * sib.d;
      const sr = r * sib.r * s;
      canvas.save();
      canvas.translate(bx, by);
      canvas.rotate((sib.a * 37) % 360);
      canvas.scale(1.0, lerp(0.74, 0.9, cell.seed));
      halo(canvas, 0, 0, sr * 1.5, P.amber, 0.1 * bright, sr * 0.9);
      glowOrb(canvas, 0, 0, sr, P.whiteHot, P.amber, 0.6 * bright, 0.42 * bright);
      ring(canvas, 0, 0, sr * 0.92, Math.max(0.5, sr * 0.04), P.amberCore, 0.25 * bright, sr * 0.1);
      canvas.restore();
    }

    // Budding daughter cell
    if (cell.pose === 'budding' && vigor > 0.25) {
      const bp = (time / cell.budPeriod + cell.seed) % 1;
      const grow = smooth(0.05, 0.62, bp);
      const pinch = smooth(0.6, 0.85, bp);
      const release = smooth(0.8, 1.0, bp);
      const ba = cell.budAngle + rot;
      const bdist = r * (0.9 + release * 0.7);
      const bxp = x + Math.cos(ba) * bdist;
      const byp = y + Math.sin(ba) * bdist;
      const br = r * (0.18 + 0.42 * grow) * lerp(0.9, 1.15, vigor);
      const bAlpha = bright * (1 - release * 0.85);
      // cytoplasmic bridge (neck)
      const neckA = bright * (1 - pinch) * 0.5;
      if (neckA > 0.01) {
        const mx = x + Math.cos(ba) * r * 0.7;
        const my = y + Math.sin(ba) * r * 0.7;
        glowOrb(canvas, mx, my, r * 0.28 * (1 - pinch * 0.6), P.amberCore, P.amber, neckA, neckA * 0.7);
      }
      // daughter as its own oval
      canvas.save();
      canvas.translate(bxp, byp);
      canvas.rotate(ba * (180 / Math.PI));
      canvas.scale(1.0, lerp(0.76, 0.88, cell.seed));
      halo(canvas, 0, 0, br * 1.6, P.amber, 0.12 * bAlpha, br * 0.9);
      glowOrb(canvas, 0, 0, br, P.whiteHot, P.amber, 0.7 * bAlpha, 0.5 * bAlpha);
      ring(canvas, 0, 0, br * 0.9, Math.max(0.5, br * 0.04), P.amberCore, 0.22 * bAlpha, br * 0.1);
      canvas.restore();
    }
  }
}

// LAB: capsule-shaped violet rods in gently-curved, slowly-rotating chains.
// Each bead is elongated along the chain axis (scale transform) so it reads
// as a rod bacterium, not a sphere. Bright poles + a dimmer mid-section give
// the classic confocal "bean" look.
function drawLAB(canvas: any, layout: SceneLayout, st: DoughState, time: number) {
  const acidBud = smooth(0.4, 0.9, st.acidity);
  for (const ch of layout.lab) {
    const d = drift(time, ch.idx + 40, 7, 6, ch.driftP);
    const fl = flow(ch.x, ch.y, time);
    const twk = twinkle(time, ch.seed, 0.08, ch.twkP);
    const sway = Math.sin((time * TAU) / ch.swayP + ch.idx) * 0.22;
    const baseAng = ch.ang + sway + time * ch.rotSpeed;
    const bright = ch.bright * twk;
    const step = ch.br * 1.5;
    const cx = ch.x + d.dx + fl.fx;
    const cy = ch.y + d.dy + fl.fy;
    const angDeg = baseAng * (180 / Math.PI);
    for (let b = 0; b < ch.beads; b++) {
      const along = (b - (ch.beads - 1) / 2) * step;
      const bend = along * along * ch.curve;
      const ca = Math.cos(baseAng);
      const sa = Math.sin(baseAng);
      const x = cx + ca * along - sa * bend;
      const y = cy + sa * along + ca * bend;
      const poleBoost = b === 0 || b === ch.beads - 1 ? 1.25 : 1.0;

      if (b === ch.fissionBead) {
        // mid-division: two sub-orbs with a pinched septum
        const sep = ch.br * 0.55;
        const ox = ca * sep * 0.5;
        const oy = sa * sep * 0.5;
        halo(canvas, x, y, ch.br * 1.7, P.lab, 0.12 * bright, ch.br);
        // each half is a capsule
        canvas.save();
        canvas.translate(x - ox, y - oy);
        canvas.rotate(angDeg);
        canvas.scale(1.35, 0.78);
        glowOrb(canvas, 0, 0, ch.br * 0.72, P.labHot, P.lab, 0.8 * bright, 0.5 * bright);
        canvas.restore();
        canvas.save();
        canvas.translate(x + ox, y + oy);
        canvas.rotate(angDeg);
        canvas.scale(1.35, 0.78);
        glowOrb(canvas, 0, 0, ch.br * 0.72, P.labHot, P.lab, 0.8 * bright, 0.5 * bright);
        canvas.restore();
        // faint septum constriction line
        const sx1 = x - sa * ch.br * 0.6;
        const sy1 = y + ca * ch.br * 0.6;
        const sx2 = x + sa * ch.br * 0.6;
        const sy2 = y - ca * ch.br * 0.6;
        const sp = additivePaint();
        sp.setColor(col(P.labHot, 0.2 * bright));
        sp.setStrokeWidth(0.8);
        sp.setStyle(PaintStyle.Stroke);
        canvas.drawLine(sx1, sy1, sx2, sy2, sp);
      } else {
        // capsule-shaped bead: elongated along the chain axis
        halo(canvas, x, y, ch.br * 1.7, P.lab, 0.12 * bright, ch.br);
        canvas.save();
        canvas.translate(x, y);
        canvas.rotate(angDeg);
        canvas.scale(1.4, 0.76);
        glowOrb(canvas, 0, 0, ch.br, P.labHot, P.lab, 0.8 * bright * poleBoost, 0.5 * bright);
        // bright polar caps
        dot(canvas, -ch.br * 0.55, 0, ch.br * 0.22, P.labHot, 0.5 * bright * poleBoost);
        dot(canvas, ch.br * 0.55, 0, ch.br * 0.22, P.labHot, 0.5 * bright * poleBoost);
        // faint internal line (nucleoid region)
        dot(canvas, 0, 0, ch.br * 0.18, P.whiteHot, 0.2 * bright);
        canvas.restore();
      }

      // acid molecules budding off the chain ends as pH drops (B3)
      if (acidBud > 0.05 && (b === 0 || b === ch.beads - 1)) {
        const aph = (time * 0.5 + b + ch.idx) % 1;
        const adist = ch.br * (1.4 + aph * 1.4);
        const aang = baseAng + (b === 0 ? -1.6 : 1.6);
        const axp = x + Math.cos(aang) * adist;
        const ayp = y + Math.sin(aang) * adist;
        glowOrb(canvas, axp, ayp, 2.6, P.aceticHot, P.acetic, 0.4 * acidBud * (1 - aph), 0.25 * acidBud * (1 - aph));
      }
    }
  }
}

// Amylase: teal toroid — the autolyse workhorse. Knobby surface subunits orbit
// the ring; active form flings cleaved-sugar specks off its rim.
function drawAmylase(canvas: any, layout: SceneLayout, st: DoughState, time: number) {
  const emerge = layout.amylaseEmerge;
  if (emerge < 0.04) return;
  const active = st.sugarAvail;
  for (const mol of layout.amylase) {
    const d = drift(time, mol.idx + 70, 8, 7, mol.driftP);
    const fl = flow(mol.x, mol.y, time);
    const x = mol.x + d.dx + fl.fx;
    const y = mol.y + d.dy + fl.fy;
    const rr = mol.rr;
    const pulse = 1 + Math.sin((time * TAU) / 3.4 + mol.idx) * 0.12 * active;
    // outer halo bloom
    halo(canvas, x, y, rr * 1.8 * pulse, P.amylase, 0.08 * emerge, rr * 0.7);
    // main ring structure
    ring(canvas, x, y, rr * pulse, rr * 0.32, P.amylase, 0.5 * emerge, rr * 0.25);
    ring(canvas, x, y, rr * pulse, rr * 0.12, P.amylaseHot, 0.6 * emerge, 0);
    // knobby surface subunits — bright dots orbiting the ring, giving texture
    const knobs = 6;
    const spinRate = time * 0.3 * mol.spinDir;
    for (let k = 0; k < knobs; k++) {
      const ka = (k / knobs) * TAU + spinRate;
      const kx = x + Math.cos(ka) * rr * pulse;
      const ky = y + Math.sin(ka) * rr * pulse;
      const kBright = 0.4 + 0.2 * Math.sin(ka * 2 + time);
      dot(canvas, kx, ky, rr * 0.14, P.amylaseHot, kBright * emerge);
      glowOrb(canvas, kx, ky, rr * 0.22, P.amylase, P.amylaseHot, 0.25 * emerge, 0.15 * emerge);
    }
    // cleaved-sugar specks flung off the rim
    const specks = 3 + Math.round(active * 2);
    for (let s2 = 0; s2 < specks; s2++) {
      const ph = (time * 0.4 + s2 / specks + mol.idx) % 1;
      const sa = (s2 / specks) * TAU + time * 0.6 * mol.spinDir;
      const sr = rr * (1.0 + ph * 0.9);
      const sx = x + Math.cos(sa) * sr;
      const sy = y + Math.sin(sa) * sr;
      glowOrb(canvas, sx, sy, 2.4, P.amberCore, P.amber, 0.5 * emerge * (1 - ph), 0.3 * emerge * (1 - ph));
    }
  }
}

// Protease: red lobes. Free-floating early; late, they DOCK onto gluten
// junctions and "bite" (art-spec B4/C3) — the docked-onto node dims in drawGluten.
function drawProtease(canvas: any, layout: SceneLayout, st: DoughState, time: number) {
  const emerge = layout.proteaseEmerge;
  if (emerge < 0.04) return;
  const nodes = layout.gluten.nodes;
  const organize = layout.gluten.organize;
  for (const pr of layout.protease) {
    const bite = 0.5 + 0.5 * Math.sin((time * TAU) / pr.biteP + pr.seed * 6);
    let x: number;
    let y: number;
    let open: number;
    if (pr.targetNode >= 0 && pr.approach > 0.05) {
      // clamp onto the junction with a small in/out "chewing" motion
      const n = nodes[pr.targetNode];
      const ny = glutenNodeY(n, time, organize);
      const homeD = drift(time, pr.idx + 90, 5, 4, pr.driftP);
      const freeX = pr.x + homeD.dx;
      const freeY = pr.y + homeD.dy;
      const gnaw = 1 - 0.14 * bite; // rock slightly toward the strand as it bites
      x = lerp(freeX, n.x, pr.approach * gnaw);
      y = lerp(freeY, ny, pr.approach * gnaw);
      open = 0.75 + 0.25 * bite; // hyperactive, splayed
    } else {
      const d = drift(time, pr.idx + 90, 5, 4, pr.driftP);
      const fl = flow(pr.x, pr.y, time);
      x = pr.x + d.dx + fl.fx;
      y = pr.y + d.dy + fl.fy;
      open = 0.5 + 0.5 * emerge;
    }
    const rr = pr.rr;
    halo(canvas, x, y, rr * 1.8, P.protease, 0.14 * emerge, rr * 1.0);
    glowOrb(canvas, x - rr * 0.35 * open, y, rr, P.proteaseHot, P.protease, 0.7 * emerge, 0.5 * emerge);
    glowOrb(canvas, x + rr * 0.35 * open, y + rr * 0.18, rr * 0.85, P.proteaseHot, P.protease, 0.6 * emerge, 0.45 * emerge);
    // a third splayed lobe on the hyperactive/docked form
    if (open > 0.7) {
      glowOrb(canvas, x, y - rr * 0.42 * open, rr * 0.7, P.proteaseHot, P.protease, 0.5 * emerge, 0.4 * emerge);
    }
  }
}

// Acetic acid: yellow-green molecule clusters ("acid bursts") — concentrate late.
function drawAcetic(canvas: any, layout: SceneLayout, time: number) {
  const emerge = layout.aceticEmerge;
  if (emerge < 0.04) return;
  for (const cl of layout.acetic) {
    const d = drift(time, cl.idx + 120, 9, 8, cl.driftP);
    const fl = flow(cl.x, cl.y, time);
    const cx = cl.x + d.dx + fl.fx;
    const cy = cl.y + d.dy + fl.fy;
    const twk = twinkle(time, cl.seed, 0.1, 3.6);
    // shared soft glow binds the burst together
    if (cl.members.length > 1) {
      glowOrb(canvas, cx, cy, 11, P.acetic, P.acetic, 0.1 * emerge * twk, 0.08 * emerge * twk);
    }
    for (const mb of cl.members) {
      const jitter = Math.sin((time * TAU) / 2.6 + mb.a * 3) * 1.4;
      const mx = cx + Math.cos(mb.a) * (mb.d + jitter);
      const my = cy + Math.sin(mb.a) * (mb.d + jitter);
      glowOrb(canvas, mx, my, mb.r, P.aceticHot, P.acetic, 0.6 * emerge * twk, 0.4 * emerge * twk);
    }
  }
}

// CO₂ bubbles: inflate + rise with gasVolume; some pairs converge & coalesce.
function drawBubbles(canvas: any, layout: SceneLayout, st: DoughState, W: number, H: number, time: number) {
  const gas = st.gasVolume;
  if (gas < 0.03 || layout.bubbles.length === 0) return;
  const rise = lerp(H * 0.25, H * 0.85, gas);
  const baseSize = lerp(3, 15, gas);
  for (let i = 0; i < layout.bubbles.length; i++) {
    const bub = layout.bubbles[i];
    const frac = (time / bub.life + bub.phase) % 1;
    const size = baseSize * bub.sizeMul * (0.6 + 0.4 * frac);
    // converge horizontally toward a partner column near the top (coalescence)
    const conv = bub.pairDX * smooth(0.4, 1.0, frac);
    const x = bub.x0 + Math.sin(frac * TAU * bub.wobFreq + i) * bub.wobAmp + conv;
    const y = H - 6 - frac * rise;
    const fade = Math.sin(clamp(frac, 0, 1) * Math.PI); // in then out
    if (fade < 0.03) continue;
    // faint interior fill so the bubble reads as a luminous gas cell, not a hoop
    glowOrb(canvas, x, y, size, P.gluten, P.gluten, 0.1 * fade, 0.05 * fade);
    ring(canvas, x, y, size, 1.5, P.glutenHot, 0.6 * fade, size * 0.28);
    // bright specular rim highlight on the film
    dot(canvas, x - size * 0.28, y - size * 0.28, Math.max(1.2, size * 0.18), P.whiteHot, 0.6 * fade);
  }
}

// Gluten network: orange filaments + glowing junction nodes.
// organize (glutenStrength): slack/dim -> aligned/bright lattice
// fray (glutenDamage): thins, dims, snaps strands, extinguishes nodes
// nodes flagged `attacked` (a protease is docked) dim toward dark (B4/C3).
function drawGluten(canvas: any, g: GlutenLayout, time: number) {
  const organize = g.organize;
  const fray = g.fray;
  // live node positions (static x, breathing y)
  const live: { x: number; y: number; v: number; attacked: boolean }[] = [];
  for (const n of g.nodes) {
    live.push({ x: n.x, y: glutenNodeY(n, time, organize), v: n.v, attacked: n.attacked });
  }
  const strandA = lerp(0.14, 0.6, organize) * (1 - 0.8 * fray);
  const strandW = lerp(1.0, 4.0, organize) * (1 - 0.55 * fray);
  for (const s of g.strands) {
    const a = live[s.ai];
    const b = live[s.bi];
    // strands touching an attacked junction dim (the bond is being severed)
    const atk = a.attacked || b.attacked ? 0.5 : 1;
    drawStrand(canvas, a, b, strandW * s.wMul, strandA * s.aMul * atk, fray, organize, time, s);
  }
  const alive = g.alive;
  if (alive >= 0.04) {
    for (const n of live) {
      const nr = lerp(2.0, 6.5, organize) * (1 - 0.6 * fray) * n.v;
      // a docked protease extinguishes the junction toward dark
      const na = n.attacked ? alive * 0.28 : alive;
      halo(canvas, n.x, n.y, nr * 2.0, P.gluten, 0.16 * na, nr * 1.1);
      glowOrb(canvas, n.x, n.y, nr, P.glutenHot, P.gluten, 0.9 * na, 0.6 * na);
    }
  }
}

// One strand a→b as a curved, sagging filament (not a straight lattice edge):
// a quadratic bow perpendicular to the run, deterministic thickness variation
// (from precomputed meta), and a live wobble. Frays into two recoiled curved
// stubs as damage rises.
function drawStrand(
  canvas: any,
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  alpha: number,
  fray: number,
  organize: number,
  time: number,
  meta: GlutenStrand,
) {
  if (alpha < 0.01) return;
  const thick = w * meta.thickMul;
  const p = additivePaint();
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(thick);
  p.setStrokeCap(StrokeCap.Round);
  p.setColor(col(P.gluten, alpha));
  p.setMaskFilter(blurMask(lerp(0.6, 2.2, alpha)));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len; // unit perpendicular
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // strands sag more when slack, tighten (but never fully straighten) when organized
  const wob = Math.sin((time * TAU) / 6 + meta.idx * 1.3) * 1.6 * (0.4 + organize * 0.6);
  const off = meta.bowSign * meta.bowMag * (0.55 + 0.45 * (1 - organize)) + wob;
  const cx = mx + nx * off;
  const cy = my + ny * off;
  if (fray > 0.35 && meta.snap < fray) {
    // snapped mid-strand: two curved stubs recoil apart along the normal
    const gap = lerp(0.12, 0.34, fray);
    const recoil = meta.bowSign * 9 * fray;
    p.setColor(col(P.gluten, alpha * 0.7));
    const path = SCRATCH_PATH;
    path.reset();
    path.moveTo(a.x, a.y);
    path.quadTo(lerp(a.x, cx, 0.5), lerp(a.y, cy, 0.5), lerp(a.x, cx, 1 - gap) + nx * recoil, lerp(a.y, cy, 1 - gap) + ny * recoil);
    path.moveTo(lerp(cx, b.x, gap) - nx * recoil, lerp(cy, b.y, gap) - ny * recoil);
    path.quadTo(lerp(cx, b.x, 0.5), lerp(cy, b.y, 0.5), b.x, b.y);
    canvas.drawPath(path, p);
  } else {
    const path = SCRATCH_PATH;
    path.reset();
    path.moveTo(a.x, a.y);
    path.quadTo(cx, cy, b.x, b.y);
    canvas.drawPath(path, p);
  }
}

// ── React component ──────────────────────────────────────────────────────────
const EMPTY_GLASS: GlassScreenRect[] = [];

interface Props {
  /** 'idle' (dim/near-empty) | 'autolyse' (fixed early, amylase-led) | 'bulk'. */
  mode: 'idle' | 'autolyse' | 'bulk';
  /** Bulk fermentation progress 0..1+ (elapsed / target bulk time). */
  fraction?: number;
  inputs?: BakerInputs;
  folds?: FoldEvent[];
  /**
   * When true (default), the scene draws frosted-glass panels behind every UI
   * card registered via glassStage — used by the fullscreen timer background.
   * Set false to render the organisms only (e.g. a stand-alone decorative use).
   */
  glassEnabled?: boolean;
}

export function SkiaFermentationScene({
  mode,
  fraction = 0,
  inputs = DEFAULT_INPUTS,
  folds = [],
  glassEnabled = true,
}: Props) {
  const [size, setSize] = useState({ w: FALLBACK_W, h: FALLBACK_H });

  // Map the scene mode → a progress point on the doughState curve engine.
  //   bulk     → live fraction
  //   autolyse → a fixed early point; at this progress doughState naturally
  //              yields strong amylase, forming gluten, and ~no microbes.
  //   idle     → progress 0 (near-empty resting field), rendered extra-dim.
  // `fraction` ticks every second (it derives from the timer screen's clock),
  // and every distinct value would rebuild `st` AND the whole organism layout
  // below — a visible once-per-second hitch. Quantize to 0.5% steps: a 2-hour
  // bulk then refreshes the layout every ~36s, and all per-frame motion comes
  // from the animation clock anyway, not from progress.
  const rawProgress = mode === 'bulk' ? clamp(fraction, 0, 1) : mode === 'autolyse' ? 0.06 : 0.0;
  const progress = Math.round(rawProgress * 200) / 200;
  const dim = mode === 'idle' ? 0.28 : 1.0;

  // State is computed once on the JS thread — it does NOT depend on the clock.
  const st = useMemo(
    () => computeDoughState(progress, inputs, folds),
    [progress, inputs, folds],
  );

  const { w: W, h: H } = size;

  // Per-organism CONSTANTS (positions, seeds, poses, gluten topology, protease
  // attack targets) — computed ONCE per state/size, NOT per frame. This is the
  // main performance lever: the hot per-frame path only layers motion on top.
  const layout = useMemo(() => buildLayout(st, W, H), [st, W, H]);

  // Animation clock, driven on the JS thread at 60fps. We deliberately do NOT
  // use Skia's useClock + reanimated useDerivedValue: on this Skia 2.6.2 +
  // reanimated 4.3 / worklets 0.8 combo, calling createPicture() inside a
  // reanimated worklet throws "undefined is not a function" and crashes the
  // app (see docs/SKIA-HANDOFF.md). Driving from JS keeps the drawing
  // byte-for-byte identical — only the per-frame trigger moves off the UI
  // thread. This component re-renders per frame in isolation; `st` and
  // `layout` (useMemo above) are NOT recomputed each frame, so only the
  // pictures rebuild.
  //
  // The gate was 30fps, which judders on a 120Hz phone: rAF ticks every
  // ~8.3ms, so a 33.3ms threshold fires after 33.3 OR 41.7ms — visibly
  // uneven — and 30fps is itself choppy for continuous ambient drift. The
  // 1ms epsilon keeps a frame from slipping a whole vsync tick when the
  // timestamp lands fractionally early.
  const [timeSec, setTimeSec] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    let last = -Infinity;
    const FRAME_MS = 1000 / 60;
    const loop = (ts: number) => {
      if (start === null) start = ts;
      if (ts - last >= FRAME_MS - 1) {
        last = ts;
        setTimeSec((ts - start) / 1000); // seconds — matches scene.js clock units
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Glass panel positions (screen-space rects of every registered GlassCard).
  const glass = glassEnabled ? screenRects() : EMPTY_GLASS;

  // Two-stage recording, rebuilt each frame as timeSec advances — plain Skia,
  // no worklet. The organisms are recorded ONCE into their own picture; the
  // scene picture replays it across the full canvas, then (only if there are
  // glass panels to paint) replays it again per panel inside a saveLayer
  // with a blur image filter, clipped to that panel's rounded rect. Replaying
  // a nested picture is native-side — without this, every visible panel
  // re-recorded the whole organism pass in JS (4× the recording cost with
  // three panels on screen). See drawGlassPanels for why this avoids
  // backdrop filters entirely.
  const orgPicture = useMemo(
    () => createPicture((canvas) => drawOrganisms(canvas, st, layout, W, H, timeSec, dim)),
    [st, layout, W, H, timeSec, dim],
  );
  const picture = useMemo(
    () => createPicture((canvas) => drawScene(canvas, orgPicture, glass, timeSec)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgPicture, glass, timeSec],
  );

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
      {/* backgroundColor black is required: additive glow over pure black.
          Organisms AND glass panels (real image-blur, no backdrop filter)
          are both drawn inside the single recorded Picture — see drawScene. */}
      <Canvas style={{ width: W, height: H, backgroundColor: 'black' }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

export default SkiaFermentationScene;
