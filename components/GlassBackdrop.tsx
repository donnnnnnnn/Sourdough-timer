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
 * pub/sub channel, throttled/bounded four ways (each earned by an on-device
 * jank report — "choppy later in bulk" build #19, "scrolling is jerky even
 * pre-bulk" build #20):
 *
 *   1. STAGGERED, not synchronized. Every pane used to gate on the same
 *      "tick % 3" condition, so ALL mounted panes redrew — each
 *      re-rasterizing + re-blurring a layer — on the SAME published frame:
 *      a periodic multi-pane GPU burst. Each pane now owns a stable slot
 *      (glassStage.nextPaneSlot()) and only redraws on its own turn,
 *      spreading that cost evenly across frames instead.
 *   2. WIDENING through bulk. The organism cast a pane replays grows
 *      through bulk (more yeast, LAB chains, bubbles, fraying gluten), so
 *      each redraw itself gets costlier over time even with #1 fixed. The
 *      update period grows with glassStage.getSceneProgress() to hold total
 *      per-pane GPU time roughly constant — imperceptible behind blur.
 *   3. SLOWER WHILE SCROLLING. Scroll frames are when the GPU is already
 *      compositing ~9 moving panes; the period doubles while scroll events
 *      are streaming (glassStage.isScrollActive()). Position is native-
 *      driven and unaffected — only the frost content's frame rate drops,
 *      invisible while everything is in motion.
 *   4. BLUR CLIPPED TO THE VISIBLE SLICE. The canvas is scene-sized, but
 *      only a card-height sliver ever shows through the card's overflow
 *      clip. Un-clipped, every redraw rasterized + blurred the WHOLE scene
 *      (~200 full-screen blur passes/sec pre-bulk — the reason build #20
 *      janked while scrolling even with #1 and #2 in place). The blur layer
 *      is now clipped to the visible slice + BLUR_CLIP_MARGIN; the opaque
 *      base and tint fills stay full-canvas so a fling that outruns the
 *      margin degrades to plain glass, never to sharp sprites leaking in.
 *
 * Panes fully off-screen skip updates outright regardless of turn. The
 * card-anchored sheen gradient lives in its own tiny static canvas so it
 * doesn't ride the world transform.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  rect,
  vec,
  type SkPicture,
} from '@shopify/react-native-skia';
import {
  getContentTop,
  getScenePicture,
  getSceneHeight,
  getSceneProgress,
  getSceneWidth,
  getScrollAnim,
  getScrollY,
  isScrollActive,
  nextPaneSlot,
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

// Update period (in published scene ticks) a pane waits between redraws.
// Widens through bulk — see the file header for why. At 60fps scene ticks:
// period 4 ≈ 15fps, period 7 ≈ 8.5fps. (Was 3/20fps; build #20 was still
// GPU-bound enough that scrolling janked even pre-bulk. 15fps organism
// drift behind frost is indistinguishable from 20.)
const BASE_PERIOD = 4;
const PERIOD_GROWTH = 3;

// While a scroll is in flight the period doubles: compositing ~9 moving
// panes is the GPU's busiest moment, and pane POSITION is native-driven so
// only the frost content's frame rate drops — invisible while everything is
// moving. (Direct response to "scrolling is jerky even pre-bulk", build #20.)
const SCROLLING_PERIOD_SCALE = 2;

// The blur layer is clipped to the slice of the scene the card can actually
// reveal, plus this margin (px) of scroll drift on each side. Without the
// clip, every redraw rasterized + Gaussian-blurred the ENTIRE scene-sized
// canvas to show a card-height sliver — the single biggest GPU line item
// (~200 full-screen blur passes/sec pre-bulk). The margin covers scroll
// travel between a pane's redraws; if a violent fling outruns it, the card
// edge briefly shows the base+tint without organisms — behind frost, in
// motion, effectively invisible (and safe: the opaque base still hides the
// sharp scene). The base and tint fills stay UNCLIPPED for exactly that
// safety: overrun degrades to "plain glass", never to sharp sprites
// leaking through.
const BLUR_CLIP_MARGIN = 160;

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
  // Stable per-instance slot for staggering — lazy initializer so
  // nextPaneSlot() (a mutating counter) runs exactly once per mount, not on
  // every render (a plain useRef(nextPaneSlot()) argument would).
  const [mySlot] = useState(() => nextPaneSlot());

  useEffect(() => {
    return subscribeScenePicture((tick) => {
      // 1. Staggered turn-taking: only redraw on this pane's slot, so
      // mounted panes never all rasterize+blur in the same frame. The period
      // widens through bulk and doubles while a scroll is streaming events.
      let period = BASE_PERIOD + Math.round(getSceneProgress() * PERIOD_GROWTH);
      if (isScrollActive()) period *= SCROLLING_PERIOD_SCALE;
      if (tick % period !== mySlot % period) return;
      // 2. Off-screen panes skip updates outright.
      const sceneH = getSceneHeight();
      if (sceneH > 0) {
        const liveY = getContentTop() + contentY - getScrollY();
        if (liveY + h < -OFFSCREEN_MARGIN || liveY > sceneH + OFFSCREEN_MARGIN) return;
      }
      force();
    });
  }, [contentY, h, mySlot]);

  // World anchor: static base −(contentTop + contentY), plus the live native
  // scroll value. setValue keeps working on native-driven values, so measure
  // corrections land without re-creating the node. The effect runs every
  // render (contentTop can change without a prop change) but only crosses the
  // bridge when the value actually moved — panes re-render ~15×/sec each, and
  // unconditional setValue was a native round-trip per redraw per pane.
  const baseRef = useRef(new Animated.Value(-(getContentTop() + contentY)));
  const lastBaseRef = useRef(-(getContentTop() + contentY));
  useEffect(() => {
    const base = -(getContentTop() + contentY);
    if (base !== lastBaseRef.current) {
      lastBaseRef.current = base;
      baseRef.current.setValue(base);
    }
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

  // The scene slice (in canvas coords) the card's viewport shows right now,
  // padded by the drift margin. Recomputed from live values on every redraw,
  // so it tracks the scroll at the pane's own refresh rate. Skia limits the
  // blur's saveLayer to (current clip ∩ content bounds), so this shrinks the
  // rasterize+blur from the whole scene to a card-sized band — and culls the
  // picture's off-slice draw ops for free.
  const sliceTop = getContentTop() + contentY - getScrollY();
  const blurClip = rect(
    0,
    sliceTop - BLUR_CLIP_MARGIN,
    sceneW,
    h + 2 * BLUR_CLIP_MARGIN,
  );

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
          {/* Clip OUTSIDE the layer group so the clip is guaranteed to be on
              the canvas before saveLayer bounds are computed. */}
          <Group clip={blurClip}>
            <Group layer={<Paint><Blur blur={sigma} /></Paint>}>
              <Picture picture={pic} />
            </Group>
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
