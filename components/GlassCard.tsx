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
  /** Native node of the scroll content container to measure cards against. */
  contentNode: unknown | null;
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
  contentNode: unknown | null;
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
  /** Per-card tint strength (0..1.5). Lower = clearer glass. Default 1. */
  tint?: number;
}

export function GlassCard({ children, style, radius = 20, tint = 1 }: GlassCardProps) {
  const ref = useRef<View>(null);
  const idRef = useRef<string>(nextGlassId());
  const { contentNode, measureTick } = useContext(GlassStageContext);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node || !contentNode) return;
    // measureLayout gives this card's frame relative to the scroll content
    // container — a scroll-INDEPENDENT position we can combine with the live
    // scroll offset each frame.
    node.measureLayout(
      contentNode as number,
      (x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
          upsertGlass({ id: idRef.current, x, w, h, contentY: y, radius, tint });
        }
      },
      () => {},
    );
  }, [contentNode, radius, tint]);

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
