/**
 * On-device crumb photo analyzer — zero network, zero cloud.
 *
 * v1 uses deterministic computer-vision heuristics (downscale → grayscale →
 * Otsu threshold → connected-component hole analysis) to produce the same
 * output shape a trained CNN would. A TFLite/ONNX model can replace the
 * internals later without touching the classifier or UI.
 *
 * Confidence from this analyzer is intentionally moderate: when its features
 * are ambiguous the fusion classifier drops below the 0.75 threshold and the
 * UI surfaces tiebreaker questions — that interplay is the designed UX.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { decode as b64decode } from 'base-64';
import type { FermentationState } from './training-data';

export interface CrumbVisionFeatures {
  crumbProbs: Record<FermentationState, number>;
  evenHoles: boolean;
  topHeavyHoles: boolean;
  tunnelingDetected: boolean;
  gummyDetected: boolean;
  holeFraction: number;
}

const SIZE = 160; // analysis resolution — small enough for fast flood fill on-device

export async function analyzeCrumbPhoto(uri: string): Promise<CrumbVisionFeatures> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: SIZE, height: SIZE } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) throw new Error('no image data');

  const bin = b64decode(manipulated.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const { data, width, height } = jpeg.decode(bytes, { useTArray: true });

  // Grayscale
  const n = width * height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    gray[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0;
  }

  // Otsu threshold — separates dark holes from lighter crumb walls
  const thresh = otsu(gray);
  const holes = new Uint8Array(n);
  let holeCount = 0;
  for (let i = 0; i < n; i++) {
    if (gray[i] < thresh) { holes[i] = 1; holeCount++; }
  }
  const holeFraction = holeCount / n;

  // Hole fraction per vertical third — distribution signal
  const third = Math.floor(height / 3);
  const fracOfBand = (y0: number, y1: number) => {
    let c = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) c += holes[y * width + x];
    return c / ((y1 - y0) * width);
  };
  const topFrac = fracOfBand(0, third);
  const midFrac = fracOfBand(third, 2 * third);
  const botFrac = fracOfBand(2 * third, height);

  // Connected components — hole size stats (iterative flood fill, 4-neighbor)
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (holes[i] !== 1 || labels[i] !== -1) continue;
    const label = sizes.length;
    let size = 0;
    stack.push(i);
    labels[i] = label;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % width, py = (p / width) | 0;
      if (px > 0 && holes[p - 1] === 1 && labels[p - 1] === -1) { labels[p - 1] = label; stack.push(p - 1); }
      if (px < width - 1 && holes[p + 1] === 1 && labels[p + 1] === -1) { labels[p + 1] = label; stack.push(p + 1); }
      if (py > 0 && holes[p - width] === 1 && labels[p - width] === -1) { labels[p - width] = label; stack.push(p - width); }
      if (py < height - 1 && holes[p + width] === 1 && labels[p + width] === -1) { labels[p + width] = label; stack.push(p + width); }
    }
    sizes.push(size);
  }
  const largestFrac = sizes.length ? Math.max(...sizes) / n : 0;
  const meaningful = sizes.filter(s => s > 4);
  const meanSize = meaningful.length ? meaningful.reduce((a, b) => a + b, 0) / meaningful.length : 0;
  const sizeVariance = meaningful.length
    ? meaningful.reduce((a, b) => a + (b - meanSize) ** 2, 0) / meaningful.length / (meanSize * meanSize || 1)
    : 0;

  // Wall texture — low local contrast in wall regions reads as dense/gummy sheen
  let wallContrast = 0, wallSamples = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x;
      if (holes[i]) continue;
      wallContrast += Math.abs(gray[i] - gray[i + 1]) + Math.abs(gray[i] - gray[i + width]);
      wallSamples++;
    }
  }
  const avgWallContrast = wallSamples ? wallContrast / wallSamples : 0;

  // ── Feature interpretation ───────────────────────────────────────
  const topHeavyHoles = topFrac > botFrac * 1.6 && topFrac > 0.12;
  const bottomDense = botFrac < 0.06 && topFrac > 0.10;
  const tunnelingDetected = largestFrac > 0.06 && topHeavyHoles;
  const evenHoles =
    Math.abs(topFrac - botFrac) < 0.05 &&
    Math.abs(midFrac - (topFrac + botFrac) / 2) < 0.05 &&
    holeFraction > 0.05;
  const gummyDetected = avgWallContrast < 6 && holeFraction < 0.12;

  // ── Probability synthesis ─────────────────────────────────────────
  let under = 0.1, sUnder = 0.15, proper = 0.3, sOver = 0.15, over = 0.1;
  if (tunnelingDetected || (bottomDense && topHeavyHoles)) { under += 0.35; sUnder += 0.15; proper -= 0.2; }
  else if (bottomDense || gummyDetected) { under += 0.2; sUnder += 0.15; proper -= 0.1; }
  if (evenHoles && holeFraction > 0.12 && sizeVariance > 0.5 && sizeVariance < 4) { proper += 0.35; under -= 0.05; }
  if (evenHoles && holeFraction <= 0.12) { proper += 0.1; sUnder += 0.1; } // tight-but-even: proper wholegrain vs slightly under — genuinely ambiguous
  if (holeFraction > 0.10 && sizeVariance < 0.4 && !topHeavyHoles) { sOver += 0.15; over += 0.1; } // uniform ragged smallness
  const sum = under + sUnder + proper + sOver + over;
  const crumbProbs: Record<FermentationState, number> = {
    under_fermented: under / sum,
    slightly_under: sUnder / sum,
    properly_fermented: proper / sum,
    slightly_over: sOver / sum,
    over_fermented: over / sum,
  };

  return { crumbProbs, evenHoles, topHeavyHoles, tunnelingDetected, gummyDetected, holeFraction };
}

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, best = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) { maxVar = between; best = t; }
  }
  return best;
}
