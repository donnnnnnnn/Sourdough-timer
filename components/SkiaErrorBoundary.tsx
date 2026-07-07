/**
 * SkiaErrorBoundary — on-device diagnostics for the Skia crash investigation.
 *
 * Why this exists: the app crashed on launch with only "Error: undefined is
 * not a function" and NO stack trace (see docs/SKIA-HANDOFF.md). This file
 * makes the next build tell us the REAL failing call, on the phone screen:
 *
 * 1. `SkiaErrorBoundary` catches any error thrown while rendering its
 *    children and renders the error message + JS stack + React component
 *    stack visibly on screen (and logs them via console.error).
 *
 * 2. `SafeSkiaFermentationScene` loads the Skia scene with an inline
 *    `require()` DURING RENDER instead of a top-level `import`. This is
 *    deliberate and load-bearing: `@shopify/react-native-skia` runs real code
 *    at module-evaluation time (JSI install in skia/NativeSetup.ts, a
 *    `createWorkletRuntime` call in external/reanimated/useVideoLoading.ts).
 *    With a static import, a throw there would happen while the route module
 *    is being evaluated — before ANY boundary exists — and we'd be back to
 *    the generic expo-router error screen. Requiring inside render moves that
 *    module evaluation inside the boundary, so even an import-time crash is
 *    caught and displayed with its stack.
 *
 * This wrapper is temporary scaffolding for the investigation. Once the root
 * cause is fixed and verified on-device, the diagnostic panel can be slimmed
 * down to a silent fallback (e.g. the pure-JS FermentationScene).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

// Type-only import: erased at compile time, so it does NOT trigger the
// runtime module load we are deliberately deferring (verified `import type`).
import type { SkiaFermentationScene as SkiaSceneType } from './SkiaFermentationScene';

type SkiaSceneProps = Parameters<typeof SkiaSceneType>[0];

interface BoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/** Trim very long stacks so the panel stays scrollable/readable. */
function trim(s: string | null | undefined, max = 4000): string {
  if (!s) return '(none)';
  return s.length > max ? s.slice(0, max) + `\n… [truncated, ${s.length} chars total]` : s;
}

export class SkiaErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Also log everything, so `adb logcat` (or a dev-client console) has the
    // full untruncated details even if the on-screen panel gets cut off.
    console.error('[SkiaErrorBoundary] Skia scene crashed:', error);
    console.error('[SkiaErrorBoundary] JS stack:', error?.stack ?? '(no stack)');
    console.error('[SkiaErrorBoundary] component stack:', info?.componentStack ?? '(none)');
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (error === null) {
      return this.props.children;
    }
    // Diagnostic panel: fills the same absolute area the scene would have
    // occupied. Text is selectable so the owner can long-press and copy it.
    return (
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: '#2a1212',
          borderWidth: 1,
          borderColor: '#c0392b',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
        <ScrollView contentContainerStyle={{ padding: 10 }}>
          <Text selectable style={{ color: '#ff9f9f', fontSize: 13, fontWeight: '700' }}>
            SKIA SCENE ERROR (caught by SkiaErrorBoundary)
          </Text>
          <Text selectable style={{ color: '#ffd7d7', fontSize: 12, marginTop: 6 }}>
            {error.name}: {error.message}
          </Text>
          <Text selectable style={{ color: '#e8b9b9', fontSize: 10, marginTop: 8, fontFamily: 'monospace' }}>
            {trim(error.stack)}
          </Text>
          <Text selectable style={{ color: '#caa', fontSize: 10, marginTop: 8, fontFamily: 'monospace' }}>
            component stack:{trim(componentStack)}
          </Text>
        </ScrollView>
      </View>
    );
  }
}

/**
 * Renders the Skia scene inside the boundary, loading the module lazily so
 * import-time throws are caught too (see file header for why).
 */
function LazySkiaScene(props: SkiaSceneProps) {
  // Inline require during render: if @shopify/react-native-skia (or the scene
  // module) throws while being evaluated, the throw happens HERE, inside the
  // boundary. Metro caches the module, so this only evaluates once.
  const { SkiaFermentationScene } =
    require('./SkiaFermentationScene') as typeof import('./SkiaFermentationScene');
  return <SkiaFermentationScene {...props} />;
}

/** Drop-in replacement for <SkiaFermentationScene> with crash diagnostics. */
export function SafeSkiaFermentationScene(props: SkiaSceneProps) {
  return (
    <SkiaErrorBoundary>
      <LazySkiaScene {...props} />
    </SkiaErrorBoundary>
  );
}
