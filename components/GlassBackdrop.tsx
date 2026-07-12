/**
 * GlassBackdrop — the frosted-glass pane INSIDE a GlassCard.
 *
 * A small Skia canvas that fills the card and paints, in order: an opaque
 * black base (hiding the sharp organisms of the fullscreen scene behind the
 * card), a BLURRED replay of the scene's organism picture offset so the
 * correct slice shows through, the warm espresso tint, and a top sheen.
 *
 * Why this exists (two hard-won on-device facts, July 2026):
 *
 * 1. ALIGNMENT — the previous design drew glass slabs in the fullscreen
 *    canvas at positions reported from JS. Native scrolling moves the cards
 *    on the UI thread; the slabs followed one-to-three frames later and
 *    visibly detached during scroll. This canvas is a CHILD of the card, so
 *    it scrolls natively with it — slab/card alignment is perfect by
 *    construction. Only the *content offset* (which slice of the scene shows
 *    through) lags slightly during scroll, which is imperceptible in an
 *    abstract, blurred field.
 *
 * 2. BLUR — every blur recorded inside an SkPicture (saveLayer image filter,
 *    offscreen-surface snapshot, backdrop filter) showed NO blur on a
 *    Pixel 9. The declarative `layer` blur used here is RN Skia's
 *    mainstream, documented path and runs in this canvas's own scene graph,
 *    not inside a recorded picture.
 *
 * The organism picture arrives via glassStage's scene-picture channel
 * (published by SkiaFermentationScene each frame). This component updates on
 * every SECOND publish (~30fps) — halving React work for content that is
 * blurred anyway.
 */
import { useEffect, useReducer, useRef } from 'react';
import { StyleSheet } from 'react-native';
import {
  Canvas,
  Fill,
  Group,
  Paint,
  Blur,
  Picture,
  Rect,
  LinearGradient,
  vec,
  type SkPicture,
} from '@shopify/react-native-skia';
import {
  getContentTop,
  getScenePicture,
  getScrollY,
  isScrolling,
  subscribeScenePicture,
} from './glassStage';

/**
 * Tuner-px → Skia-sigma calibration. The frosted-glass tuner expresses blur
 * in CSS px in a desktop browser; on-device (build #14, Pixel 9) the same
 * number rendered visibly ~2× stronger — the phone's ~2.6× pixel density and
 * Skia's Gaussian differ from the browser's backdrop-filter. This factor
 * keeps the tuner readout pasteable 1:1 into the `blur` prop. Tweak HERE to
 * re-calibrate globally; tweak per-card props for per-panel character.
 */
const TUNER_BLUR_SCALE = 0.5;

interface GlassBackdropProps {
  /** Card size from onLayout, px. */
  w: number;
  h: number;
  /** Card left edge within the scroll content (== screen x; no h-scroll). */
  x: number;
  /** Card top within the scroll content, px (scroll-independent). */
  contentY: number;
  /** Final espresso-overlay opacity (0..0.92) — 1:1 with the tuner readout. */
  tint: number;
  /** Blur sigma, px. */
  blur: number;
}

export function GlassBackdrop({ w, h, x, contentY, tint, blur }: GlassBackdropProps) {
  const [, force] = useReducer((c: number) => c + 1, 0);
  // Last scene offset, held FROZEN while a scroll is in motion (see below).
  const frozenY = useRef<number | null>(null);

  useEffect(() => {
    let n = 0;
    return subscribeScenePicture(() => {
      // Content keeps animating during scroll — every 2nd frame, always.
      // Only the scene OFFSET freezes while scrolling (render body below):
      // repositioning from a JS scrollY that lags native card motion was
      // the stutter; fresh animation frames drawn at a held offset are not.
      n = (n + 1) & 1;
      if (n === 0) force();
    });
  }, []);

  const pic = getScenePicture() as SkPicture | null;

  // Where this card currently sits over the fullscreen scene. Shifting the
  // picture by the negative of that puts the correct scene slice under the
  // card. During a scroll we reuse the frozen offset — a re-render can still
  // arrive mid-scroll (e.g. the timer's 1-second clock tick), and computing
  // from a stale scrollY then would visibly jump the content.
  let sceneY: number;
  if (isScrolling() && frozenY.current !== null) {
    sceneY = frozenY.current;
  } else {
    sceneY = getContentTop() + contentY - getScrollY();
    frozenY.current = sceneY;
  }

  if (!pic || w <= 0 || h <= 0) return null;

  const sceneX = x;

  const tintAlpha = Math.min(0.92, Math.max(0, tint));

  return (
    <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Opaque base: hides the sharp full-focus organisms behind the card
          (the card View itself is transparent). The scene background is pure
          black, so this reads as "the scene, out of focus" not "a hole". */}
      <Fill color="black" />
      <Group layer={<Paint><Blur blur={blur * TUNER_BLUR_SCALE} /></Paint>}>
        <Group transform={[{ translateX: -sceneX }, { translateY: -sceneY }]}>
          <Picture picture={pic} />
        </Group>
      </Group>
      {/* Warm espresso tint — mutes the additive glow into a pane. */}
      <Fill color={`rgba(22,16,13,${tintAlpha})`} />
      {/* Top-down warm sheen. */}
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, h)}
          colors={['rgba(255,240,220,0.12)', 'rgba(255,240,220,0.0)']}
          positions={[0, 0.5]}
        />
      </Rect>
    </Canvas>
  );
}

export default GlassBackdrop;
