import {
  type Diagnosis,
  type FermentationState,
  type FusionOutput,
  DIAGNOSIS_COPY,
} from './training-data';

export type FlourTag = 'white' | 'partial_whole_grain' | 'whole_wheat' | 'rye';

export interface ClassifierInput {
  crumbProbs: Record<FermentationState, number>;
  shapeFlat: boolean;
  crustPale: boolean;
  gummyDetected: boolean;
  evenHoles: boolean;
  tunnelingDetected: boolean;
  topHeavyHoles: boolean;
  bulkDurationMinutes: number;
  foldCount: number;
  userAverageBulkMinutes: number | null;
  flourTag?: FlourTag;
}

const OVERFERMENT_WINDOW: Record<FlourTag, number> = {
  white: 1.0,
  partial_whole_grain: 0.85,
  whole_wheat: 0.7,
  rye: 0.6,
};

function bulkRatio(input: ClassifierInput): 'short' | 'normal' | 'long' | 'unknown' {
  const baseline = input.userAverageBulkMinutes;
  if (!baseline || baseline === 0) return 'unknown';
  const ratio = input.bulkDurationMinutes / baseline;
  if (ratio < 0.85) return 'short';
  if (ratio > 1.25) return 'long';
  return 'normal';
}

function topCrumbClass(probs: Record<FermentationState, number>): FermentationState {
  let best: FermentationState = 'properly_fermented';
  let bestP = -1;
  for (const [k, v] of Object.entries(probs) as [FermentationState, number][]) {
    if (v > bestP) { bestP = v; best = k; }
  }
  return best;
}

export function diagnose(input: ClassifierInput): FusionOutput {
  const flour = input.flourTag ?? 'white';
  const bulk = bulkRatio(input);
  const crumbTop = topCrumbClass(input.crumbProbs);

  // Fool's crumb: top-heavy huge holes + dense base + tunneling
  if (input.tunnelingDetected && input.topHeavyHoles && input.gummyDetected) {
    return result('fools_crumb', 0.9,
      "Large tunnels near top with dense gummy base — classic fool's crumb from short bulk.");
  }

  // Flat loaf disambiguation — the critical fusion logic
  if (input.shapeFlat) {
    return disambiguateFlat(input, bulk, flour);
  }

  // Non-flat loaf: lean on crumb classifier + timing cross-check
  if (crumbTop === 'under_fermented' || crumbTop === 'slightly_under') {
    if (flour === 'whole_wheat' || flour === 'rye') {
      if (input.evenHoles && !input.gummyDetected && !input.tunnelingDetected) {
        return result('properly_fermented', 0.72,
          'Tight crumb is normal for whole grain flour. Holes are even and not gummy — fermentation looks fine.');
      }
    }

    if (input.gummyDetected && input.tunnelingDetected) {
      return result('under_fermented', 0.88,
        'Dense gummy crumb with tunneling confirms underfermentation.');
    }

    const diag: Diagnosis = crumbTop === 'under_fermented' ? 'under_fermented' : 'slightly_under';
    const conf = bulk === 'short' ? 0.85 : 0.65;
    return result(diag, conf,
      `Crumb pattern suggests ${diag.replace('_', '-')}. ${
        bulk === 'short' ? 'Short bulk time confirms.' : 'Timing is ambiguous — check if your starter was active.'
      }`);
  }

  if (crumbTop === 'over_fermented' || crumbTop === 'slightly_over') {
    const window = OVERFERMENT_WINDOW[flour];
    const timingConfirms = bulk === 'long';
    const conf = timingConfirms ? 0.85 : 0.6;
    const diag: Diagnosis = crumbTop === 'over_fermented' ? 'over_fermented' : 'slightly_over';

    if (flour !== 'white' && window < 0.85) {
      return result(diag, Math.min(conf + 0.05, 0.95),
        `${flour.replace('_', ' ')} flour has a shorter fermentation window. ${
          timingConfirms ? 'Long bulk confirms overfermentation.' : 'Crumb pattern suggests you went past peak.'
        }`);
    }

    return result(diag, conf,
      `Crumb shows signs of ${diag.replace('_', '-')}.${timingConfirms ? ' Bulk time was longer than your average.' : ''}`);
  }

  return result('properly_fermented', input.crumbProbs.properly_fermented,
    'Even crumb, good structure, fermentation looks balanced.');
}

function disambiguateFlat(
  input: ClassifierInput,
  bulk: 'short' | 'normal' | 'long' | 'unknown',
  flour: FlourTag,
): FusionOutput {
  const crustSignal = input.crustPale ? 'over' : 'shaping';
  const crumbSignal = input.gummyDetected ? 'over' : (input.evenHoles ? 'shaping' : 'ambiguous');
  const timingSignal = bulk === 'long' ? 'over' : (bulk === 'normal' ? 'shaping' : (bulk === 'short' ? 'under' : 'ambiguous'));

  const overVotes = [crustSignal, crumbSignal, timingSignal].filter(s => s === 'over').length;
  const shapingVotes = [crustSignal, crumbSignal, timingSignal].filter(s => s === 'shaping').length;

  if (timingSignal === 'under' && input.gummyDetected) {
    return result('under_fermented', 0.82,
      'Flat + short bulk + gummy crumb = dough never developed enough gas or structure.');
  }

  if (overVotes >= 2) {
    const conf = overVotes === 3 ? 0.92 : 0.78;
    return result('over_fermented', conf,
      `Flat shape with ${
        input.crustPale ? 'pale crust (sugars consumed)' : 'degraded crumb'
      } and ${bulk === 'long' ? 'extended bulk time' : 'gummy interior'} — overfermentation.`);
  }

  if (shapingVotes >= 2) {
    const conf = shapingVotes === 3 ? 0.88 : 0.72;
    return result('weak_shaping', conf,
      `Crumb looks well-fermented${
        !input.crustPale ? ', crust browned normally' : ''
      } — the flat shape is from insufficient surface tension during shaping.`);
  }

  const primary = overVotes > shapingVotes ? 'over_fermented' : 'weak_shaping';
  return result(primary as Diagnosis, 0.52,
    'Signals are mixed — could be overfermentation or a shaping issue. Check the expanded details for both possibilities.');
}

function result(diagnosis: Diagnosis, confidence: number, reasoning: string): FusionOutput {
  const copy = DIAGNOSIS_COPY[diagnosis];
  return { diagnosis, confidence, advice: copy.oneLiner, reasoning };
}

export { DIAGNOSIS_COPY };
