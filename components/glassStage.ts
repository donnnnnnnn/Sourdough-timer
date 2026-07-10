/**
 * glassStage — a tiny module-level registry that lets React Native UI cards
 * tell the fullscreen Skia scene WHERE to render frosted-glass panels behind
 * them, so the living fermentation animation shows through the controls.
 *
 * Why a plain module store (not React context/state):
 * The fullscreen SkiaFermentationScene already re-renders ~30fps off its own
 * requestAnimationFrame clock. It reads this registry once per frame via
 * `screenRects()`. Card positions and scroll offset are written here as plain
 * mutations — NO React re-render is triggered by a scroll event, which would
 * otherwise cause a re-render storm. The scene simply picks up the latest
 * positions on its next animation frame.
 *
 * Coordinate model (all in on-screen / Skia-canvas pixels):
 *   screenY = contentTop + contentY - scrollY
 *     contentTop — screen Y where the scroll content's origin sits (scrollY=0);
 *                  measured once from the ScrollView. Constant.
 *     contentY   — a card's Y within the scroll content (scroll-independent);
 *                  measured via measureLayout against the content container.
 *     scrollY    — live vertical scroll offset, updated from onScroll.
 * X needs no scroll math (no horizontal scroll): screenX = card's measured x.
 */

export interface GlassRegistration {
  /** Stable id per card instance. */
  id: string;
  /** Card left edge, screen px (no horizontal scroll, so already screen-space). */
  x: number;
  /** Card width, px. */
  w: number;
  /** Card height, px. */
  h: number;
  /** Card top within scroll content, px (scroll-independent). */
  contentY: number;
  /** Corner radius, px. */
  radius: number;
  /** Optional per-card tint strength multiplier (0..1.5); default 1. */
  tint?: number;
}

/** A glass panel resolved to current on-screen coordinates for the renderer. */
export interface GlassScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  tint: number;
}

const rects = new Map<string, GlassRegistration>();
let contentTop = 0;
let scrollY = 0;

export function setContentTop(y: number): void {
  contentTop = y;
}

export function setScrollY(y: number): void {
  scrollY = y;
}

export function upsertGlass(reg: GlassRegistration): void {
  rects.set(reg.id, reg);
}

export function removeGlass(id: string): void {
  rects.delete(id);
}

/**
 * Resolve every registered card to its current on-screen rectangle. Called by
 * the scene once per animation frame. Cards with zero size are skipped.
 */
export function screenRects(): GlassScreenRect[] {
  const out: GlassScreenRect[] = [];
  for (const r of rects.values()) {
    if (r.w <= 0 || r.h <= 0) continue;
    out.push({
      x: r.x,
      y: contentTop + r.contentY - scrollY,
      w: r.w,
      h: r.h,
      radius: r.radius,
      tint: r.tint ?? 1,
    });
  }
  return out;
}

let counter = 0;
/** Monotonic id source for GlassCard instances. */
export function nextGlassId(): string {
  counter += 1;
  return `glass-${counter}`;
}
