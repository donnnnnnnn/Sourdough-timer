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
  lastScrollEventAt = Date.now();
}

// Scroll events stream at ~60Hz while a drag or fling is in flight and stop
// dead when it settles, so "an event arrived recently" is a reliable
// scroll-in-progress signal with no begin/end bookkeeping. GlassBackdrops
// halve their content-refresh rate while this is true: compositing ~9 moving
// panes already costs the GPU during a scroll, and that is exactly when
// blur re-rasterizations were shoving frames over budget ("scrolling is
// jerky even pre-bulk", build #20). The pane's POSITION is native-driven and
// unaffected — only how often the organisms behind the frost advance, which
// is imperceptible while everything is in motion.
const SCROLL_ACTIVE_WINDOW_MS = 150;
let lastScrollEventAt = 0;

export function isScrollActive(): boolean {
  return Date.now() - lastScrollEventAt < SCROLL_ACTIVE_WINDOW_MS;
}

export function getContentTop(): number {
  return contentTop;
}

export function getScrollY(): number {
  return scrollY;
}

// Scene canvas size (px), published by the scene. GlassBackdrops size their
// world-anchored canvases to it, and use the height to skip updates while
// their slice is off-screen — with ~8 panes mounted during bulk, updating
// the invisible ones was measurable JS + GPU work per frame for nothing.
let sceneWidth = 0;
let sceneHeight = 0;

export function setSceneSize(w: number, h: number): void {
  sceneWidth = w;
  sceneHeight = h;
}

export function getSceneWidth(): number {
  return sceneWidth;
}

export function getSceneHeight(): number {
  return sceneHeight;
}

// The ScrollView's live scroll offset as a NATIVE-driven RN Animated.Value
// (registered by index.tsx). Each GlassBackdrop binds its counter-translation
// to this value, so the world stays pixel-locked under the glass in the same
// UI-thread frame as the scroll itself. Every JS-driven alternative failed
// on-device: live JS offsets lag native card motion and stutter; freezing
// the offset drags the sprites along with the card and snaps on settle
// (glaring through the owner's near-clear tuned glass). Typed `unknown` to
// keep this module dependency-free.
let scrollAnim: unknown = null;

export function setScrollAnim(v: unknown): void {
  scrollAnim = v;
}

export function getScrollAnim(): unknown {
  return scrollAnim;
}

// ── Scene picture channel ────────────────────────────────────────────────────
// Listeners receive a monotonic tick so they can stagger their own updates
// (see nextPaneSlot below) instead of every pane reacting to every publish.

type SceneListener = (tick: number) => void;
let scenePicture: unknown = null;
let sceneTick = 0;
const sceneListeners = new Set<SceneListener>();

/** Called by the scene each frame with its freshly recorded organism picture. */
export function publishScenePicture(pic: unknown): void {
  scenePicture = pic;
  sceneTick += 1;
  for (const l of sceneListeners) l(sceneTick);
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

// Fermentation progress 0..1, published by the scene each render. GlassCard
// panes widen their update period as this grows — the organism cast (hence
// the cost of re-rasterizing + blurring a pane's full-viewport picture
// replay) gets larger through bulk, and that growth was the "gets worse
// later in bulk" symptom. See GlassBackdrop's PERIOD math.
let sceneProgress = 0;

export function setSceneProgress(p: number): void {
  sceneProgress = p;
}

export function getSceneProgress(): number {
  return sceneProgress;
}

// Stable per-pane slot for round-robin update staggering. Every mounted pane
// used to react to the SAME tick-modulo condition, so all ~7-8 panes during
// bulk redrew (rasterize + blur a full-viewport layer) on the SAME published
// frame — a periodic multi-pane GPU burst that read on-device as
// choppiness. Distinct slots spread that cost evenly across frames instead;
// no visual change, only WHEN each pane's turn falls.
let paneSlotCounter = 0;

export function nextPaneSlot(): number {
  paneSlotCounter += 1;
  return paneSlotCounter;
}
