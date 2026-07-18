/**
 * perfFlags — runtime switches for animation-performance experiments, plus
 * the frame-pacing stats the dev perf HUD displays.
 *
 * Why this exists: every optimization so far was reasoned from first
 * principles because we can't profile a Pixel 9 from the cloud. This module
 * lets the OWNER run the experiments: each non-pixel-identical change ships
 * behind a flag here, togglable live from the hidden perf HUD (long-press
 * the faint "· perf ·" label at the bottom of the timer screen), so an A/B
 * comparison costs seconds instead of a 35-minute build cycle.
 *
 * The flags:
 *   renderer     'direct' = the scene records its SkPicture and hands it to
 *                the native Skia view imperatively (2 JSI calls/frame, zero
 *                React). 'react' = build #22's path (setState 60×/s → React
 *                render → declarative <Canvas>). Pixel-identical output; the
 *                toggle exists as a safety fallback, and the scene auto-flips
 *                to 'react' if the direct path throws (see noteDirectFallback).
 *   glow         'mask' = MaskFilter blur halos (build #22 look, exact).
 *                'grad' = cached radial-gradient discs approximating the same
 *                blur — cheaper for the GPU, NOT pixel-identical. Owner A/Bs.
 *   resScale     1 = full-resolution scene canvas. 0.75 = the scene renders
 *                at 75% size and is scaled back up by the compositor (~44%
 *                less GPU fill for the 60fps fullscreen pass). Soft additive
 *                glow tolerates upscaling well, but it is NOT pixel-identical
 *                — sharp specks/rim highlights are the tell. Owner A/Bs.
 *   cull         true = skip draws whose alpha lands below ~1.2% (additive,
 *                over black: at most ~3/255 on any pixel — sub-visible, but
 *                by the letter of the law not pixel-identical, so togglable).
 *   demoProgress null = live timer drives the scene. A number (0..1) forces
 *                the scene to that bulk progress so late-bulk performance can
 *                be tested in seconds without running a real 5-hour bulk.
 *                HUD-only; never persisted.
 *   hud          Show the frame-pacing HUD overlay.
 *
 * Plain module store (same pattern as glassStage): no React state, so the
 * 60fps writer paths never trigger renders. The HUD and the scene subscribe
 * for the rare toggle events.
 */

import { Platform } from 'react-native';

export interface PerfFlags {
  renderer: 'direct' | 'react';
  glow: 'mask' | 'grad';
  resScale: 1 | 0.75;
  cull: boolean;
  demoProgress: number | null;
  hud: boolean;
}

const DEFAULTS: PerfFlags = {
  // The direct path talks to the native Skia view API; on web that global
  // may not exist, so web keeps the declarative React path from the start.
  renderer: Platform.OS === 'web' ? 'react' : 'direct',
  // Everything below defaults to the pixel-identical setting: with the HUD
  // untouched, a build renders EXACTLY like build #22 (only the renderer
  // mechanism differs), so any owner-reported look change has one suspect.
  glow: 'mask',
  resScale: 1,
  cull: false,
  demoProgress: null,
  hud: false,
};

let flags: PerfFlags = { ...DEFAULTS };
let version = 0;
const listeners = new Set<() => void>();

export function getPerfFlags(): PerfFlags {
  return flags;
}

/** Monotonic counter bumped on every change — cheap useSyncExternalStore key. */
export function getPerfFlagsVersion(): number {
  return version;
}

export function setPerfFlags(patch: Partial<PerfFlags>): void {
  flags = { ...flags, ...patch };
  version += 1;
  for (const l of listeners) l();
}

export function subscribePerfFlags(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// If the direct renderer throws at runtime the scene flips itself back to
// the React path (build #22 behavior) instead of crashing, and records why
// here so the HUD can show it and the owner can report it.
let directFallbackReason: string | null = null;

export function noteDirectFallback(reason: string): void {
  directFallbackReason = reason;
  setPerfFlags({ renderer: 'react' });
}

export function getDirectFallbackReason(): string | null {
  return directFallbackReason;
}

// ── Frame-pacing stats ───────────────────────────────────────────────────────
// The scene's animation loop calls noteFrame() every accepted tick — plain
// field writes, zero allocation, so measuring never perturbs what's measured.
// Once per second the window rolls into `perfSnap`, which the HUD polls at
// 1Hz. Thresholds: at a 60fps target the budget is 16.7ms; >20ms means the
// JS tick missed at least one 120Hz vsync ("late"), >34ms is a visibly
// dropped frame ("hitch").

export const perfSnap = {
  fps: 0,
  worstMs: 0,
  late: 0, // ticks >20ms in the last window
  hitch: 0, // ticks >34ms in the last window
  workAvgMs: 0, // JS record+publish cost per frame, window average
  workMaxMs: 0,
  totalLate: 0, // session totals since mount
  totalHitch: 0,
  updatedAt: 0,
};

const win = {
  startTs: 0,
  frames: 0,
  worstMs: 0,
  late: 0,
  hitch: 0,
  workSum: 0,
  workMax: 0,
  workN: 0,
};

/**
 * @param ts       rAF timestamp (ms) of this accepted tick
 * @param deltaMs  time since the previous accepted tick
 * @param workMs   JS time spent recording/publishing this frame (-1 = unknown)
 */
export function noteFrame(ts: number, deltaMs: number, workMs: number): void {
  if (win.startTs === 0) {
    win.startTs = ts;
    return; // first tick has no meaningful delta
  }
  win.frames += 1;
  if (deltaMs > win.worstMs) win.worstMs = deltaMs;
  if (deltaMs > 20) win.late += 1;
  if (deltaMs > 34) win.hitch += 1;
  if (workMs >= 0) {
    win.workSum += workMs;
    if (workMs > win.workMax) win.workMax = workMs;
    win.workN += 1;
  }
  const span = ts - win.startTs;
  if (span >= 1000) {
    perfSnap.fps = Math.round((win.frames * 1000) / span);
    perfSnap.worstMs = Math.round(win.worstMs * 10) / 10;
    perfSnap.late = win.late;
    perfSnap.hitch = win.hitch;
    perfSnap.workAvgMs = win.workN ? Math.round((win.workSum / win.workN) * 100) / 100 : 0;
    perfSnap.workMaxMs = Math.round(win.workMax * 100) / 100;
    perfSnap.totalLate += win.late;
    perfSnap.totalHitch += win.hitch;
    perfSnap.updatedAt = Date.now();
    win.startTs = ts;
    win.frames = 0;
    win.worstMs = 0;
    win.late = 0;
    win.hitch = 0;
    win.workSum = 0;
    win.workMax = 0;
    win.workN = 0;
  }
}
