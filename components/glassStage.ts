/**
 * glassStage — a tiny module-level bridge between the fullscreen Skia
 * fermentation scene and the GlassCard panes that float over it.
 *
 * Why a plain module store (not React context/state):
 * The scene re-renders ~60fps off its own requestAnimationFrame clock, and
 * scroll offsets update on every scroll event. Writing those here as plain
 * mutations triggers NO React re-renders — subscribers pull the latest
 * values when they need them, so a scroll can never cause a re-render storm.
 *
 * Two channels live here:
 *
 * 1. Coordinates — where the scroll content sits relative to the scene
 *    canvas (`contentTop`) and the live scroll offset (`scrollY`). A
 *    GlassCard combines these with its own measured position to pick WHICH
 *    slice of the scene shows through its blur:
 *        sceneY = contentTop + contentY - scrollY
 *    Note these only affect the CONTENT of a pane. The pane itself is a
 *    child of its card and scrolls natively — stale values here cannot
 *    misplace it (the old design drew panes in the fullscreen canvas from
 *    these values, and they visibly trailed the cards during scroll).
 *
 * 2. The scene picture — the organism SkPicture the scene records each
 *    frame, published so every GlassBackdrop can replay a blurred slice of
 *    it. Typed `unknown` to keep this module free of any runtime Skia
 *    import (it is imported by index.tsx on every platform).
 */

let contentTop = 0;
let scrollY = 0;

/** Screen Y (in scene-canvas space) of the scroll content's origin at scrollY=0. */
export function setContentTop(y: number): void {
  contentTop = y;
}

export function setScrollY(y: number): void {
  scrollY = y;
}

export function getContentTop(): number {
  return contentTop;
}

export function getScrollY(): number {
  return scrollY;
}

// While a scroll gesture/fling is in motion, each GlassBackdrop HOLDS its
// scene offset (the animation itself keeps playing): repositioning the
// blurred content from a JS scrollY that lags native card motion by a frame
// or two read on-device as the blur "stuttering" inside a smoothly-moving
// pane. Fresh animation frames drawn at a held offset are jitter-free. The
// slice re-syncs on settle; in a blurred field the snap is invisible.
let scrolling = false;

export function setScrolling(v: boolean): void {
  scrolling = v;
}

export function isScrolling(): boolean {
  return scrolling;
}

// Scene canvas height (px), published by the scene. GlassBackdrops use it to
// skip updates entirely while their slice is off-screen — with ~8 panes
// mounted during bulk, updating the invisible ones was measurable JS + GPU
// work per frame for nothing.
let sceneHeight = 0;

export function setSceneHeight(h: number): void {
  sceneHeight = h;
}

export function getSceneHeight(): number {
  return sceneHeight;
}

// ── Scene picture channel ────────────────────────────────────────────────────

type SceneListener = () => void;
let scenePicture: unknown = null;
const sceneListeners = new Set<SceneListener>();

/** Called by the scene each frame with its freshly recorded organism picture. */
export function publishScenePicture(pic: unknown): void {
  scenePicture = pic;
  for (const l of sceneListeners) l();
}

export function getScenePicture(): unknown {
  return scenePicture;
}

/** Subscribe to new scene pictures. Returns an unsubscribe function. */
export function subscribeScenePicture(l: SceneListener): () => void {
  sceneListeners.add(l);
  return () => {
    sceneListeners.delete(l);
  };
}
