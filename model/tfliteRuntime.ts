/**
 * TFLite runtime for the crumb classifier — the model half of visionAnalyzer.
 *
 * `tryModelProbs(uri)` returns a 5-way `crumbProbs` distribution from the
 * bundled MobileNetV3Small model, or `null` to signal "use the heuristic
 * fallback." It returns null (never throws) whenever the model can't run:
 * the model isn't bundled yet, the native module is missing (Expo Go), the
 * labels drifted, or preprocessing/inference fails. visionAnalyzer treats null
 * as "fall back to heuristicProbs()", so the app degrades instead of crashing.
 *
 * Design constraints (from docs/crumb-model-integration.md):
 *  - Map the output vector to states BY NAME via labels.json, never by
 *    position — Keras writes labels alphabetically, which is NOT the app's
 *    semantic order.
 *  - Feed RAW 0–255 pixels at 224×224. The Keras export uses
 *    include_preprocessing=True, so the graph normalizes internally; dividing
 *    by 255 or applying ImageNet mean/std would double-normalize.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { decode as b64decode } from 'base-64';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import type { FermentationState } from './training-data';

// ─────────────────────────────────────────────────────────────────────────────
// MODEL GATE — WP8: flip to `true` in the same commit that adds
//   assets/model/crumb_classifier.tflite  +  assets/model/labels.json
// While this is `false` the asset require()s below are never reached, so the
// app bundles and runs (heuristic path) before the model exists. Do not flip
// it without those two files present, or Metro will fail to resolve the assets.
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_BUNDLED = false;

const MODEL_SIZE = 224; // MobileNetV3Small input resolution

// The app's semantic states. labels.json must be a permutation of exactly this
// 5-way set (or the 3-way subset handled in WP4); anything else means the model
// was retrained with drifted labels and we refuse to use it (fall back).
const FIVE_WAY: readonly FermentationState[] = [
  'under_fermented',
  'slightly_under',
  'properly_fermented',
  'slightly_over',
  'over_fermented',
];

type ModelBundle = { model: TfliteModel; labels: FermentationState[] };

// Cache the load attempt so we only require/log/assert once per session.
let loadAttempt: Promise<ModelBundle | null> | null = null;
let pathLogged = false;

function logPath(path: 'tflite' | 'heuristic') {
  if (pathLogged) return;
  pathLogged = true;
  console.log(`[crumb] probability path: ${path}`);
}

/** Validate labels.json against the known label set. Returns the typed labels or null. */
function validateLabels(raw: unknown): FermentationState[] | null {
  if (!Array.isArray(raw) || raw.some((l) => typeof l !== 'string')) {
    console.error('[crumb] labels.json is not a string array — disabling model path.');
    return null;
  }
  const labels = raw as FermentationState[];
  const set = new Set(labels);
  const isFiveWay = labels.length === 5 && FIVE_WAY.every((s) => set.has(s));
  // NOTE (WP4): the 3-way model support extends this check with the
  // ["over_fermented","properly_fermented","under_fermented"] set.
  if (!isFiveWay) {
    console.error(
      `[crumb] labels.json (${JSON.stringify(labels)}) does not match the expected ` +
        'fermentation states — disabling model path to avoid mislabeling.',
    );
    return null;
  }
  return labels;
}

async function loadModel(): Promise<ModelBundle | null> {
  if (!MODEL_BUNDLED) {
    logPath('heuristic');
    return null;
  }
  try {
    // These requires only resolve once WP8 drops the real files alongside
    // MODEL_BUNDLED = true. Guarded above so they are unreachable until then.
    const labels = validateLabels(require('../assets/model/labels.json'));
    if (!labels) return null;
    const model = await loadTensorflowModel(require('../assets/model/crumb_classifier.tflite'), []);
    logPath('tflite');
    return { model, labels };
  } catch (e) {
    console.warn('[crumb] TFLite model failed to load — falling back to heuristics.', e);
    logPath('heuristic');
    return null;
  }
}

/** Decode the photo to a raw 224×224 RGB pixel buffer (0–255, alpha dropped). */
async function preprocess(uri: string): Promise<Uint8Array> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MODEL_SIZE, height: MODEL_SIZE } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) throw new Error('no image data');

  const bin = b64decode(manipulated.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const { data } = jpeg.decode(bytes, { useTArray: true }); // RGBA, 0–255

  const px = MODEL_SIZE * MODEL_SIZE;
  const rgb = new Uint8Array(px * 3);
  for (let i = 0; i < px; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return rgb;
}

/**
 * Build the model input ArrayBuffer at the dtype the model actually declares.
 * The converter (tf.lite.Optimize.DEFAULT, no representative dataset) keeps I/O
 * float32, but we read model.inputs[0].dataType rather than assume — a uint8
 * export must still get raw 0–255 bytes, not a rescale.
 */
function toInputBuffer(rgb: Uint8Array, model: TfliteModel): ArrayBuffer {
  const dtype = model.inputs[0]?.dataType;
  if (dtype === 'uint8') {
    return rgb.buffer as ArrayBuffer;
  }
  // Default: float32, still raw 0–255 (include_preprocessing normalizes inside).
  const f = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) f[i] = rgb[i];
  return f.buffer as ArrayBuffer;
}

/**
 * Run the bundled model on the photo. Returns crumbProbs mapped BY NAME, or
 * null to fall back to the heuristic synthesis.
 */
export async function tryModelProbs(
  uri: string,
): Promise<Record<FermentationState, number> | null> {
  if (loadAttempt === null) loadAttempt = loadModel();
  const bundle = await loadAttempt;
  if (!bundle) return null;

  try {
    const rgb = await preprocess(uri);
    const outputs = await bundle.model.run([toInputBuffer(rgb, bundle.model)]);
    const probs = new Float32Array(outputs[0]);

    // Map output index i → labels[i] BY NAME. labels.json is the source of
    // truth for index→class; never index a hardcoded semantic order.
    const out: Record<FermentationState, number> = {
      under_fermented: 0,
      slightly_under: 0,
      properly_fermented: 0,
      slightly_over: 0,
      over_fermented: 0,
    };
    bundle.labels.forEach((label, i) => {
      out[label] = probs[i] ?? 0;
    });
    return out;
  } catch (e) {
    console.warn('[crumb] TFLite inference failed — falling back to heuristics.', e);
    return null;
  }
}
