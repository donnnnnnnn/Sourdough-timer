/**
 * SkiaErrorBoundary — keeps a Skia scene failure from ever reaching users.
 *
 * Behavior:
 *  - On web the Skia module (CanvasKit) isn't bundled, so we skip Skia
 *    entirely and render the pure-JS `FermentationScene` fallback directly.
 *  - On native, the Skia scene is lazy-`require`d DURING RENDER (deliberate
 *    and load-bearing: `@shopify/react-native-skia` runs real code at
 *    module-evaluation time, and a static import would throw before any
 *    boundary exists — see docs/SKIA-HANDOFF.md).
 *  - If the scene throws: production users silently get the pure-JS
 *    `FermentationScene` (same mode/fraction API, same organisms, no Skia);
 *    dev builds get the red diagnostic panel with the real error + stacks,
 *    because that panel is how the original launch crash was found.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { FermentationScene, type SceneMode } from './FermentationScene';

// Type-only import: erased at compile time, so it does NOT trigger the
// runtime module load we are deliberately deferring (verified `import type`).
import type { SkiaFermentationScene as SkiaSceneType } from './SkiaFermentationScene';

type SkiaSceneProps = Parameters<typeof SkiaSceneType>[0];

interface BoundaryProps {
  children: ReactNode;
  /** Props forwarded to the silent FermentationScene fallback. */
  mode: SceneMode;
  fraction: number;
}

interface BoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/** Trim very long stacks so the dev panel stays scrollable/readable. */
function trim(s: string | null | undefined, max = 4000): string {
  if (!s) return '(none)';
  return s.length > max ? s.slice(0, max) + `\n… [truncated, ${s.length} chars total]` : s;
}

export class SkiaErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always log the full details so `adb logcat` / a dev-client console has
    // them even when the on-screen fallback is the silent scene.
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

    // Production: never show diagnostics — fall back to the pure-JS scene so
    // the screen keeps its living backdrop and the user never knows.
    if (!__DEV__) {
      return <FermentationScene mode={this.props.mode} fraction={this.props.fraction} />;
    }

    // Dev: the diagnostic panel that found the original launch crash.
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
            SKIA SCENE ERROR (caught by SkiaErrorBoundary — dev builds only)
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

/** Drop-in <SkiaFermentationScene> with a silent pure-JS fallback. */
export function SafeSkiaFermentationScene(props: SkiaSceneProps) {
  // Web never bundles CanvasKit — skip the throw/catch cycle entirely and
  // render the DOM-based scene, which was built for exactly this.
  if (Platform.OS === 'web') {
    return <FermentationScene mode={props.mode} fraction={props.fraction ?? 0} />;
  }
  return (
    <SkiaErrorBoundary mode={props.mode} fraction={props.fraction ?? 0}>
      <LazySkiaScene {...props} />
    </SkiaErrorBoundary>
  );
}
