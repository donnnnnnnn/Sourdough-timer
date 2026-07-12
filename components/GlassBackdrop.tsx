/**
 * GlassBackdrop — the frosted-glass pane INSIDE a GlassCard.
 *
 * v3: WORLD-ANCHORED via native counter-scroll. The pane hosts a canvas the
 * size of the WHOLE scene (black base → blurred scene picture → espresso
 * tint), clipped by the card, and counter-translated by an RN Animated
 * transform bound to the ScrollView's native-driven scroll value:
 *
 *     translateY = scrollY − (contentTop + contentY)
 *
 * Because the transform runs on the UI thread in the same frame as the
 * scroll, the blurred world stays pixel-locked under the moving glass at any
 * fling speed. The two JS-driven designs both failed on-device:
 *   • live JS offsets  → content lags native card motion 1–2 frames = the
 *     "very choppy when scrolling" stutter;
 *   • frozen offsets   → sprites ride along with the card and snap on
 *     settle — glaring through the owner's near-clear tuned glass
 *     ("totally breaks the illusion of frosted glass over the ferment").
 *
 * Content updates (fresh scene pictures) still arrive over glassStage's
 * pub/sub channel: every 3rd frame (~20fps — indistinguishable behind blur)
 * and only while the pane is on-screen. The card-anchored sheen gradient
 * lives in its own tiny static canvas so it doesn't ride the world
 * transform.
 *
 * Cost note: each visible pane rasterizes + blurs a scene-sized layer on
 * update. If this GPU load ever shows on-device, the levers are (in order)
 * lowering the update rate, then an overscan-window canvas with re-anchoring.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
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
  getSceneHeight,
  getSceneWidth,
  getScrollAnim,
  getScrollY,
  subscribeScenePicture,
} from './glassStage';

/**
 * Tuner-px → Skia-sigma calibration. The frosted-glass tuner expresses blur
 * in CSS px in a desktop browser; on-device (build #14, Pixel 9) the same
 * number rendered visibly ~2× stronger — the phone's ~2.6× pixel density and
 * Skia's Gaussian differ from the browser's backdrop-filter. This factor
 * keeps the tuner readout pasteable 1:1 into the `blur` prop. Tweak HERE to
 * re-calibrate globally; tweak per-card props for per-panel character.
 * MUST stay equal to TUNER_BLUR_SCALE in tools/frosted-glass-tuner.html.
 */
const TUNER_BLUR_SCALE = 0.5;

// Panes within this many px beyond the screen edge keep updating, so a pane
// entering the viewport never shows a stale frame.
const OFFSCREEN_MARGIN = 120;

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
  /** Blur in tuner units, px. */
  blur: number;
}

export function GlassBackdrop({ w, h, x, contentY, tint, blur }: GlassBackdropProps) {
  const [, force] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    let n = 0;
    return subscribeScenePicture(() => {
      // Cost caps: visible panes redraw on every 3rd scene frame (~20fps —
      // indistinguishable behind blur); panes whose slice is entirely
      // off-screen skip updates outright.
      n = (n + 1) % 3;
      if (n !== 0) return;
      const sceneH = getSceneHeight();
      if (sceneH > 0) {
        const liveY = getContentTop() + contentY - getScrollY();
        if (liveY + h < -OFFSCREEN_MARGIN || liveY > sceneH + OFFSCREEN_MARGIN) return;
      }
      force();
    });
  }, [contentY, h]);

  // World anchor: static base −(contentTop + contentY), plus the live native
  // scroll value. setValue keeps working on native-driven values, so measure
  // corrections land without re-creating the node.
  const baseRef = useRef(new Animated.Value(-(getContentTop() + contentY)));
  useEffect(() => {
    baseRef.current.setValue(-(getContentTop() + contentY));
  });
  const scrollAnim = getScrollAnim() as Animated.Value | null;
  const translateY = useMemo(
    () => (scrollAnim ? Animated.add(scrollAnim, baseRef.current) : null),
    [scrollAnim],
  );

  const pic = getScenePicture() as SkPicture | null;
  const sceneW = getSceneWidth();
  const sceneH = getSceneHeight();
  if (!pic || !translateY || w <= 0 || h <= 0 || sceneW <= 0 || sceneH <= 0) return null;

  const tintAlpha = Math.min(0.92, Math.max(0, tint));
  const sigma = blur * TUNER_BLUR_SCALE;

  return (
    <>
      {/* Scene-sized, world-locked layer. The uniform black base and tint
          ride the transform too, but being uniform they read as static. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -x,
          top: 0,
          width: sceneW,
          height: sceneH,
          transform: [{ translateY }],
        }}>
        <Canvas pointerEvents="none" style={{ width: sceneW, height: sceneH }}>
          {/* Opaque base: hides the sharp full-focus organisms behind the
              card (the card View itself is transparent). The scene
              background is pure black, so this reads as "the scene, out of
              focus" not "a hole". */}
          <Fill color="black" />
          <Group layer={<Paint><Blur blur={sigma} /></Paint>}>
            <Picture picture={pic} />
          </Group>
          {/* Warm espresso tint — mutes the additive glow into a pane. */}
          {tintAlpha > 0.004 && <Fill color={`rgba(22,16,13,${tintAlpha})`} />}
        </Canvas>
      </Animated.View>
      {/* Card-anchored top sheen: must NOT ride the world transform. Static
          tiny canvas — never re-renders except on card resize. */}
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, h)}
            colors={['rgba(255,240,220,0.12)', 'rgba(255,240,220,0.0)']}
            positions={[0, 0.5]}
          />
        </Rect>
      </Canvas>
    </>
  );
}

export default GlassBackdrop;
