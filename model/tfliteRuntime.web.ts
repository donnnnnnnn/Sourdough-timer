/**
 * Web stub for tfliteRuntime.
 *
 * react-native-fast-tflite is a native (Nitro) module with no web build, and
 * on-device TFLite inference doesn't run in a browser anyway. Pulling the native
 * import into the web bundle breaks Metro's web resolution, so this `.web.ts`
 * variant (Metro resolves it for the web platform, same convention as
 * store/*.web.ts) keeps that import out of the web bundle entirely.
 *
 * On web the crumb probabilities always come from the heuristic synthesis, so
 * tryModelProbs returns null — the "fall back to heuristicProbs()" signal.
 */
import type { FermentationState } from './training-data';

export async function tryModelProbs(
  _uri: string,
): Promise<Record<FermentationState, number> | null> {
  return null;
}
