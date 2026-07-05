import {
  type Diagnosis,
  type FermentationState,
  type FusionOutput,
  DIAGNOSIS_COPY,
} from './training-data';

export type FlourTag = 'white' | 'partial_whole_grain' | 'whole_wheat' | 'rye';
export type ShoulderProfile = 'high_even' | 'pyramidal' | 'falling' | 'sunken' | 'flat' | 'unknown';

export interface ClassifierInput {
  // Image model outputs
  crumbProbs: Record<FermentationState, number>;
  shapeFlat: boolean;
  crustPale: boolean;
  gummyDetected: boolean;
  evenHoles: boolean;
  tunnelingDetected: boolean;
  topHeavyHoles: boolean;
  megaPocketsNearCrust: boolean;   // large smooth holes only under top crust, lower crumb fine
  shoulderProfile: ShoulderProfile;
  glutenStrandsInBloom: boolean;   // thread-like strands visible in score opening
  bubblesInBloom: boolean;         // gas pockets in score, replacing strands (over signal)
  // App timing data
  bulkDurationMinutes: number;
  foldCount: number;
  userAverageBulkMinutes: number | null;
  // User-provided context
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

  // ── Oven artifact: mega pockets near crust with otherwise good exterior ──
  // Must check BEFORE fermentation diagnosis — good height + brown crust +
  // mega pockets = oven problem, not fermentation.
  if (
    input.megaPocketsNearCrust &&
    !input.shapeFlat &&
    !input.crustPale &&
    !input.gummyDetected
  ) {
    return result(
      'oven_artifact',
      0.87,
      'Large smooth pockets clustered under the crust with healthy lower crumb and good loaf height — this is an oven heat/steam issue, not fermentation. Do not adjust bulk time.',
    );
  }

  // ── Fool's crumb: top-heavy tunnels + gummy base ──────────────────────────
  if (input.tunnelingDetected && input.topHeavyHoles && input.gummyDetected) {
    return result(
      'fools_crumb',
      0.9,
      "Large tunnels near top with dense gummy base — classic fool's crumb from short bulk.",
    );
  }

  // ── Shoulder profile: strongest exterior read BEFORE slicing ─────────────
  // Read shoulders first — they are visible before the crumb and carry high
  // diagnostic weight when combined with the bloom signal.
  const shoulderDiag = readShoulderProfile(input, bulk);
  if (shoulderDiag) return shoulderDiag;

  // ── Flat loaf disambiguation ──────────────────────────────────────────────
  if (input.shapeFlat) {
    return disambiguateFlat(input, bulk);
  }

  // ── Non-flat: crumb classifier + timing cross-check ──────────────────────
  if (crumbTop === 'under_fermented' || crumbTop === 'slightly_under') {
    // Whole grain: tight crumb may be normal
    if (flour === 'whole_wheat' || flour === 'rye') {
      if (input.evenHoles && !input.gummyDetected && !input.tunnelingDetected) {
        return result(
          'properly_fermented',
          0.72,
          'Tight crumb is normal for whole grain flour. Even holes, no gumminess — fermentation looks fine.',
        );
      }
    }
    if (input.gummyDetected && input.tunnelingDetected) {
      return result('under_fermented', 0.88, 'Dense gummy crumb with tunneling confirms underfermentation.');
    }
    const diag: Diagnosis = crumbTop === 'under_fermented' ? 'under_fermented' : 'slightly_under';
    const conf = bulk === 'short' ? 0.85 : 0.65;
    return result(
      diag,
      conf,
      `Crumb pattern suggests ${diag.replace(/_/g, '-')}. ${
        bulk === 'short' ? 'Short bulk time confirms.' : 'Timing is ambiguous — check if your starter was active.'
      }`,
    );
  }

  if (crumbTop === 'over_fermented' || crumbTop === 'slightly_over') {
    const window = OVERFERMENT_WINDOW[flour];
    const timingConfirms = bulk === 'long';
    const conf = timingConfirms ? 0.85 : 0.6;
    const diag: Diagnosis = crumbTop === 'over_fermented' ? 'over_fermented' : 'slightly_over';
    if (flour !== 'white' && window < 0.85) {
      return result(
        diag,
        Math.min(conf + 0.05, 0.95),
        `${flour.replace(/_/g, ' ')} flour has a shorter fermentation window. ${
          timingConfirms ? 'Long bulk confirms overfermentation.' : 'Crumb pattern suggests you went past peak.'
        }`,
      );
    }
    return result(
      diag,
      conf,
      `Crumb shows signs of ${diag.replace(/_/g, '-')}.${timingConfirms ? ' Bulk time was longer than your average.' : ''}`,
    );
  }

  return result(
    'properly_fermented',
    input.crumbProbs.properly_fermented,
    'Even crumb, good structure, fermentation looks balanced.',
  );
}

// ── Shoulder profile reader ───────────────────────────────────────────────
// Returns a high-confidence result when shoulder + bloom signals are clear.
// Returns null when ambiguous, letting crumb signals take over.
function readShoulderProfile(
  input: ClassifierInput,
  bulk: 'short' | 'normal' | 'long' | 'unknown',
): FusionOutput | null {
  const { shoulderProfile, glutenStrandsInBloom, bubblesInBloom } = input;

  if (shoulderProfile === 'high_even') {
    if (glutenStrandsInBloom) {
      return result(
        'properly_fermented',
        0.93,
        'Bunny profile (high even shoulders) + gluten strands in the bloom = highest-confidence properly fermented read.',
      );
    }
    // high_even alone without strands — let crumb confirm
    return null;
  }

  if (shoulderProfile === 'pyramidal') {
    const conf = input.topHeavyHoles ? 0.88 : 0.78;
    return result(
      input.tunnelingDetected ? 'fools_crumb' : 'slightly_under',
      conf,
      "Pyramidal (peaked/triangular) loaf profile — a key sign of slight underproofing. The dramatic ear here is deceptive: it reflects unreleased energy, not good fermentation. Check the crumb bottom strip for the confirming dense band.",
    );
  }

  if (shoulderProfile === 'falling') {
    if (bubblesInBloom) {
      return result(
        'slightly_over',
        0.87,
        'Falling shoulders + bubbles in bloom (replacing gluten strands) = fermentation just past peak. Shorten bulk by 15–20 min.',
      );
    }
    return result(
      'slightly_over',
      0.80,
      'Falling shoulders are the earliest reliable exterior sign of overproofing — distinct from a flat loaf. Crumb still looks reasonable but structure is losing tension.',
    );
  }

  if (shoulderProfile === 'sunken') {
    return result(
      'over_fermented',
      0.85,
      'Sunken/collapsed shoulders indicate significant overproofing. Gluten network has substantially degraded.',
    );
  }

  return null;
}

// ── Flat loaf disambiguation ──────────────────────────────────────────────
// 3-signal voting: crust color + crumb interior + timing
function disambiguateFlat(
  input: ClassifierInput,
  bulk: 'short' | 'normal' | 'long' | 'unknown',
): FusionOutput {
  const crustSignal = input.crustPale ? 'over' : 'shaping';
  const crumbSignal = input.gummyDetected ? 'over' : (input.evenHoles ? 'shaping' : 'ambiguous');
  const timingSignal =
    bulk === 'long' ? 'over' :
    bulk === 'normal' ? 'shaping' :
    bulk === 'short' ? 'under' : 'ambiguous';

  const overVotes = [crustSignal, crumbSignal, timingSignal].filter(s => s === 'over').length;
  const shapingVotes = [crustSignal, crumbSignal, timingSignal].filter(s => s === 'shaping').length;

  if (timingSignal === 'under' && input.gummyDetected) {
    return result('under_fermented', 0.82, 'Flat + short bulk + gummy = dough never developed enough gas or structure.');
  }

  if (overVotes >= 2) {
    const conf = overVotes === 3 ? 0.92 : 0.78;
    return result(
      'over_fermented',
      conf,
      `Flat shape with ${
        input.crustPale ? 'pale crust (sugars consumed)' : 'degraded crumb'
      } and ${bulk === 'long' ? 'extended bulk time' : 'gummy interior'} — overfermentation.`,
    );
  }

  if (shapingVotes >= 2) {
    const conf = shapingVotes === 3 ? 0.88 : 0.72;
    return result(
      'weak_shaping',
      conf,
      `Crumb looks well-fermented${
        !input.crustPale ? ', crust browned normally' : ''
      } — flat shape is from insufficient surface tension during shaping.`,
    );
  }

  const primary = overVotes > shapingVotes ? 'over_fermented' : 'weak_shaping';
  return result(
    primary as Diagnosis,
    0.52,
    'Signals are mixed — could be overfermentation or a shaping issue.',
  );
}

function result(diagnosis: Diagnosis, confidence: number, reasoning: string): FusionOutput {
  const copy = DIAGNOSIS_COPY[diagnosis];
  return { diagnosis, confidence, advice: copy.oneLiner, reasoning };
}

export { DIAGNOSIS_COPY };
