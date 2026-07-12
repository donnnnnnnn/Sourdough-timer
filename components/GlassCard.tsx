/**
 * GlassCard — a frosted-glass panel floating over the fullscreen Skia
 * fermentation scene.
 *
 * The glass pane is rendered INSIDE the card: a small Skia canvas
 * (GlassBackdrop) fills the card behind its children and paints a blurred,
 * tinted window onto the scene's organism picture. Because the pane is a
 * child of the card, native scrolling moves card and glass together —
 * slab/card alignment is perfect by construction. (The previous design drew
 * the slabs in the fullscreen canvas at JS-reported positions; they trailed
 * the natively-scrolled cards by a few frames and visibly detached during
 * scroll — confirmed on a Pixel 9.)
 *
 * Measurement (relative to the scroll content container) is still needed,
 * but only to pick WHICH slice of the scene shows through the blur — a
 * slightly stale value there is imperceptible; it can no longer misplace the
 * pane itself.
 *
 * GlassBackdrop is require()d lazily inside render, NEVER imported at module
 * scope: @shopify/react-native-skia runs real JSI code at module-evaluation
 * time, and a static import chain from a route module would crash before any
 * error boundary exists (the original Skia crash saga — docs/SKIA-HANDOFF.md).
 */
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform, View, type ViewStyle, type LayoutChangeEvent } from 'react-native';
import { C } from './theme';

interface GlassStageValue {
  /**
   * Ref to the scroll content container View to measure cards against.
   * Must be the component ref itself, NOT a findNodeHandle() number — on the
   * New Architecture, measureLayout rejects numeric handles by silently
   * calling its failure callback (which once left every card unregistered).
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
  /** Blur sigma, px. Default 12. */
  blur?: number;
}

// Lazily-resolved GlassBackdrop. undefined = not attempted, null = unavailable.
let BackdropComp: React.ComponentType<any> | null | undefined;
function resolveBackdrop(): React.ComponentType<any> | null {
  if (BackdropComp === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      BackdropComp = require('./GlassBackdrop').GlassBackdrop ?? null;
    } catch {
      BackdropComp = null;
    }
  }
  return BackdropComp ?? null;
}

/** Silent boundary: a glass pane failing must never take the card's content
 * (timer controls!) down with it — the card just stays transparent. */
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('[GlassCard] backdrop crashed; card renders without glass:', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function GlassCard({ children, style, radius = 20, tint = 0.44, blur = 12 }: GlassCardProps) {
  const ref = useRef<View>(null);
  const warnedRef = useRef(false);
  const { contentNode, measureTick } = useContext(GlassStageContext);

  const [size, setSize] = useState({ w: 0, h: 0 });
  // Position within the scroll content (scroll-independent), used by the
  // backdrop to pick which slice of the scene shows through the blur.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node || !contentNode) return;
    node.measureLayout(
      contentNode,
      (x: number, y: number) => {
        setPos((prev) =>
          prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5 ? prev : { x, y },
        );
      },
      () => {
        if (!warnedRef.current) {
          warnedRef.current = true;
          console.warn(
            '[GlassCard] measureLayout failed — the glass pane will show the ' +
              'wrong scene slice. Check that GlassStageProvider receives the ' +
              'content container View ref (not a node handle).',
          );
        }
      },
    );
  }, [contentNode]);

  // Re-measure whenever the provider asks (scroll settle, layout shifts).
  useEffect(() => {
    measure();
  }, [measure, measureTick]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setSize((prev) =>
        Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5
          ? prev
          : { w: width, h: height },
      );
      measure();
    },
    [measure],
  );

  const Backdrop = Platform.OS === 'web' ? null : resolveBackdrop();

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
      {Backdrop && pos && size.w > 0 && size.h > 0 && (
        <SilentBoundary>
          <Backdrop
            w={size.w}
            h={size.h}
            x={pos.x}
            contentY={pos.y}
            tint={tint}
            blur={blur}
          />
        </SilentBoundary>
      )}
      {children}
    </View>
  );
}
