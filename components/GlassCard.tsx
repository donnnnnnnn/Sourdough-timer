/**
 * GlassCard — a frosted-glass panel that floats over the fullscreen Skia
 * fermentation scene. It does two things:
 *
 *  1. Renders its children in a rounded container with a TRANSPARENT interior
 *     plus a hairline warm border and a faint top sheen — so it always reads
 *     as an intentional glass panel even before/without the Skia blur.
 *
 *  2. Measures its own on-screen rectangle and registers it with `glassStage`,
 *     so the Skia scene draws a real backdrop-blurred, tinted glass slab at
 *     exactly that spot. The living organisms beneath show through, blurred —
 *     the "microscope slide" look.
 *
 * Measurement is relative to the scroll content container (scroll-independent),
 * so the registered position stays correct as the user scrolls; the scene
 * combines it with the live scroll offset each frame. Cards re-measure on
 * layout and whenever the provider bumps `measureTick` (e.g. after scroll
 * settles), which self-corrects any drift.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { View, type ViewStyle, type LayoutChangeEvent } from 'react-native';
import { C } from './theme';
import { nextGlassId, removeGlass, upsertGlass } from './glassStage';

interface GlassStageValue {
  /**
   * Ref to the scroll content container View to measure cards against.
   * Must be the component ref itself, NOT a findNodeHandle() number — on the
   * New Architecture, measureLayout rejects numeric handles by silently
   * calling its failure callback, which is exactly how every glass panel
   * once failed to register (zero blur/tint on-device, organisms showing
   * through the transparent cards at full sharpness).
   */
  contentNode: View | null;
  /** Bumped to ask every card to re-measure (e.g. after scroll settles). */
  measureTick: number;
}

const GlassStageContext = createContext<GlassStageValue>({
  contentNode: null,
  measureTick: 0,
});

export function GlassStageProvider({
  contentNode,
  measureTick,
  children,
}: {
  contentNode: View | null;
  measureTick: number;
  children: ReactNode;
}) {
  return (
    <GlassStageContext.Provider value={{ contentNode, measureTick }}>
      {children}
    </GlassStageContext.Provider>
  );
}

interface GlassCardProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Corner radius; must match the container's borderRadius. Default 20. */
  radius?: number;
  /**
   * Espresso-overlay opacity (0..0.92) — the final alpha drawn over the
   * blurred organisms. Same units as the frosted-glass tuner's readout, so
   * tuner values paste in directly. Lower = clearer glass. Default 0.44.
   */
  tint?: number;
  /** Per-card blur sigma override. Omit to use the shared animated sigma. */
  blur?: number;
}

export function GlassCard({ children, style, radius = 20, tint = 0.44, blur }: GlassCardProps) {
  const ref = useRef<View>(null);
  const idRef = useRef<string>(nextGlassId());
  const warnedRef = useRef(false);
  const { contentNode, measureTick } = useContext(GlassStageContext);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node || !contentNode) return;
    // measureLayout gives this card's frame relative to the scroll content
    // container — a scroll-INDEPENDENT position we can combine with the live
    // scroll offset each frame. The second argument must be the container's
    // component ref (a number node handle fails on the New Architecture).
    node.measureLayout(
      contentNode,
      (x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
          upsertGlass({ id: idRef.current, x, w, h, contentY: y, radius, tint, blur });
        }
      },
      // Never fail silently: an unregistered card means its glass panel
      // simply doesn't render, which is invisible in the UI and burned
      // several device-test builds before anyone saw a log line.
      () => {
        if (!warnedRef.current) {
          warnedRef.current = true;
          console.warn(
            `[GlassCard ${idRef.current}] measureLayout failed — this card's ` +
              'frosted-glass panel will NOT render. Check that GlassStageProvider ' +
              'receives the content container View ref (not a node handle).',
          );
        }
      },
    );
  }, [contentNode, radius, tint, blur]);

  // Re-measure whenever the provider asks (scroll settle, layout shifts).
  useEffect(() => {
    measure();
  }, [measure, measureTick]);

  // Unregister on unmount so stale panels don't linger.
  useEffect(() => {
    const id = idRef.current;
    return () => removeGlass(id);
  }, []);

  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      // Defer a tick so the layout has committed before we measure.
      measure();
    },
    [measure],
  );

  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={[
        {
          borderRadius: radius,
          borderWidth: 1,
          borderColor: C.glassBorder,
          backgroundColor: 'transparent',
          // A faint top sheen sold via a border-highlight on the top edge.
          borderTopColor: C.glassSheen,
          overflow: 'hidden',
        },
        style as ViewStyle,
      ]}>
      {children}
    </View>
  );
}
