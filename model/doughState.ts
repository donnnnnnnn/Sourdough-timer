/**
 * DoughStateModel — pure-function curve engine for fermentation visualization.
 *
 * Takes baker inputs + fold events + elapsed minutes → returns visual state.
 * No React, no canvas, no side effects. Same inputs = same output always.
 *
 * The curves are shaped sigmoids, not differential equations. They feel right
 * without pretending to be scientifically exact. Temperature shifts timing,
 * inoculation shifts lag, flour strength scales gluten peaks, etc.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BakerInputs {
  /** Dough temperature in °F. Default 76. Range ~65–90. */
  tempF: number;
  /** Starter inoculation as fraction (0.10 = 10%). Default 0.20. */
  inoculation: number;
  /** Hydration as fraction (0.75 = 75%). Default 0.75. */
  hydration: number;
  /**
   * Flour strength 0–1. 1 = strong bread flour, 0.5 = AP,
   * 0.2 = weak/ancient grain. Default 0.85.
   */
  flourStrength: number;
  /** Whole grain fraction 0–1. 0 = all white, 1 = 100% whole grain. Default 0. */
  wholeGrain: number;
  /** Salt as fraction (0.02 = 2%). Default 0.02. */
  salt: number;
}

export interface FoldEvent {
  /** When the fold happened, as fermentation progress 0–1. */
  atProgress: number;
}

export interface DoughState {
  /** Overall fermentation progress 0–1. */
  fermentation: number;
  /** Gas volume in the dough. 0 = none, 1 = fully expanded. */
  gasVolume: number;
  /** Gluten network strength. 0 = unformed, 1 = peak windowpane. */
  glutenStrength: number;
  /** Cumulative gluten damage from acid/protease. 0 = none, 1 = destroyed. */
  glutenDamage: number;
  /** Acidity level. 0 = neutral, 1 = very acidic. */
  acidity: number;
  /** Combined microbe visibility/activity. 0 = dormant, 1 = peak. */
  microbeActivity: number;
  /** Available sugar (from starch breakdown). 1 = abundant, 0 = depleted. */
  sugarAvail: number;
  /** Net wall integrity = strength − damage, clamped 0–1. */
  wallIntegrity: number;
  /** Current stage name for display. */
  stageName: string;
  /** Stage description. */
  stageDesc: string;
  /** Whether a fold is currently recommended. */
  foldDue: boolean;
  /** Caption for the user, if any. */
  caption: string | null;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_INPUTS: BakerInputs = {
  tempF: 76,
  inoculation: 0.20,
  hydration: 0.75,
  flourStrength: 0.85,
  wholeGrain: 0,
  salt: 0.02,
};

// ── Math helpers ──────────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── Input-derived timing parameters ───────────────────────────────────────────

interface TimingParams {
  /** How much to stretch/compress the time axis. >1 = faster. */
  speedFactor: number;
  /** Lag phase duration (progress units before activity starts). */
  lagEnd: number;
  /** When gas production peaks. */
  gasPeak: number;
  /** When gluten peaks. */
  glutenPeak: number;
  /** When protease damage becomes significant. */
  damageOnset: number;
  /** Peak gas retention (flour strength). */
  peakRetention: number;
  /** How large bubbles get (hydration). */
  bubbleScale: number;
  /** Extra enzyme activity from whole grain. */
  enzymeBoost: number;
}

function computeTiming(inputs: BakerInputs): TimingParams {
  const { tempF, inoculation, hydration, flourStrength, wholeGrain, salt } =
    inputs;

  // Temperature: 76°F = baseline (1.0). Every 5°F warmer ≈ 30% faster.
  const tempFactor = Math.pow(1.3, (tempF - 76) / 5);

  // Inoculation: 20% = baseline. Higher = shorter lag, faster overall.
  const inocFactor = Math.pow(inoculation / 0.2, 0.5);

  // Salt: 2% = baseline. Higher = slower.
  const saltBrake = lerp(1.15, 0.85, clamp((salt - 0.015) / 0.015, 0, 1));

  // Whole grain: more = faster fermentation tendency.
  const wgBoost = 1 + wholeGrain * 0.25;

  const speedFactor = tempFactor * inocFactor * saltBrake * wgBoost;

  // Lag phase shortens with higher inoculation and temperature.
  const lagEnd = clamp(0.12 / (inocFactor * Math.pow(tempFactor, 0.5)), 0.02, 0.25);

  // Gas peaks earlier when fermentation is faster.
  const gasPeak = clamp(0.55 / Math.pow(speedFactor, 0.3), 0.35, 0.70);

  // Gluten peaks slightly before gas peak (it needs to form first).
  const glutenPeak = clamp(gasPeak - 0.08, 0.30, 0.60);

  // Damage onset: earlier if weak flour, more whole grain, or fast fermentation.
  const damageOnset = clamp(
    0.65 * flourStrength / Math.pow(speedFactor, 0.2) - wholeGrain * 0.05,
    0.40,
    0.80,
  );

  // Peak gas retention scales with flour strength.
  const peakRetention = clamp(0.5 + flourStrength * 0.5, 0.45, 0.98);

  // Bubble size scales with hydration.
  const bubbleScale = lerp(0.65, 1.15, clamp((hydration - 0.60) / 0.25, 0, 1));

  // Enzyme activity from whole grain (more starch/amylase visible).
  const enzymeBoost = wholeGrain * 0.6;

  return {
    speedFactor,
    lagEnd,
    gasPeak,
    glutenPeak,
    damageOnset,
    peakRetention,
    bubbleScale,
    enzymeBoost,
  };
}

// ── Fold effects ──────────────────────────────────────────────────────────────

interface FoldEffects {
  glutenBoost: number;
  gasRetentionBoost: number;
  degassPenalty: number;
  tearRisk: number;
}

function computeFoldEffects(
  folds: FoldEvent[],
  progress: number,
  acidity: number,
): FoldEffects {
  let glutenBoost = 0;
  let gasRetentionBoost = 0;
  let degassPenalty = 0;
  let tearRisk = 0;

  for (const fold of folds) {
    if (fold.atProgress > progress) continue;

    const age = progress - fold.atProgress;
    const decay = Math.exp(-age * 8);
    const earlyness = clamp(1 - fold.atProgress / 0.5, 0, 1);

    // Early folds: strong gluten boost, modest degassing.
    // Late folds: less boost, more degassing, risk of tearing.
    const lateness = clamp((fold.atProgress - 0.5) / 0.4, 0, 1);

    glutenBoost += (0.15 + earlyness * 0.10) * decay;
    gasRetentionBoost += (0.08 + earlyness * 0.06) * decay;
    degassPenalty += (0.10 + lateness * 0.15) * decay;

    if (acidity > 0.5 && lateness > 0.3) {
      tearRisk += lateness * acidity * 0.15 * decay;
    }
  }

  return { glutenBoost, gasRetentionBoost, degassPenalty, tearRisk };
}

// ── Main compute ──────────────────────────────────────────────────────────────

/**
 * Compute the full dough visual state at a given progress point.
 *
 * @param progress Fermentation progress 0–1 (mapped from elapsed time by caller).
 * @param inputs Baker's recipe inputs.
 * @param folds Array of fold events that have occurred.
 */
export function computeDoughState(
  progress: number,
  inputs: BakerInputs = DEFAULT_INPUTS,
  folds: FoldEvent[] = [],
): DoughState {
  const t = clamp(progress, 0, 1);
  const T = computeTiming(inputs);

  // Acidity: rises monotonically, speed proportional to fermentation speed.
  const acidity = smoothstep(T.lagEnd + 0.10, 0.85 / T.speedFactor + 0.15, t);

  const foldFx = computeFoldEffects(folds, t, acidity);

  // Microbe activity: ramps up after lag, sustained through fermentation.
  const microbeActivity =
    smoothstep(T.lagEnd, T.lagEnd + 0.15, t) *
    (1 - smoothstep(0.90, 1.0, t) * 0.5);

  // Sugar: starts high (starch available), consumed over time.
  // Whole grain = more initial enzyme activity = faster sugar release + consumption.
  const sugarRelease = smoothstep(0, T.lagEnd + 0.10, t) * (1 + T.enzymeBoost);
  const sugarConsume = smoothstep(T.lagEnd + 0.05, 0.80, t);
  const sugarAvail = clamp(sugarRelease * (1 - sugarConsume * 0.85), 0, 1);

  // Gas production: ramps up, peaks, then declines.
  const gasProduction =
    smoothstep(T.lagEnd, T.gasPeak, t) *
    (1 - smoothstep(T.gasPeak + 0.15, 0.95, t) * 0.4) -
    foldFx.degassPenalty;

  // Gas retention: depends on gluten strength.
  const baseRetention =
    T.peakRetention * smoothstep(T.lagEnd + 0.05, T.glutenPeak, t);

  // Gluten strength: builds up, peaks, then degrades from acid/protease.
  const glutenBuild = smoothstep(0.02, T.glutenPeak, t);
  const baseStrength = inputs.flourStrength * glutenBuild + foldFx.glutenBoost;

  // Gluten damage: protease activated by acid, attacks after damageOnset.
  const protease = smoothstep(T.damageOnset, T.damageOnset + 0.15, t) * acidity;
  const glutenDamage = clamp(protease * 0.8 + foldFx.tearRisk, 0, 1);

  const glutenStrength = clamp(baseStrength * (1 - glutenDamage * 0.9), 0, 1);
  const retention = clamp(
    baseRetention * (1 - glutenDamage * 0.7) + foldFx.gasRetentionBoost,
    0,
    1,
  );

  // Gas volume = production × retention × bubble scale.
  const gasVolume = clamp(
    Math.max(gasProduction, 0) * retention * T.bubbleScale,
    0,
    1,
  );

  // Wall integrity: derived.
  const wallIntegrity = clamp(glutenStrength - glutenDamage * 0.6, 0, 1);

  // Stage determination.
  const { stageName, stageDesc, foldDue, caption } = determineStage(
    t,
    T,
    gasVolume,
    glutenStrength,
    glutenDamage,
    acidity,
    folds,
  );

  return {
    fermentation: t,
    gasVolume,
    glutenStrength,
    glutenDamage,
    acidity,
    microbeActivity,
    sugarAvail,
    wallIntegrity,
    stageName,
    stageDesc,
    foldDue,
    caption,
  };
}

// ── Stage labels ──────────────────────────────────────────────────────────────

function determineStage(
  t: number,
  T: TimingParams,
  gasVolume: number,
  glutenStrength: number,
  glutenDamage: number,
  acidity: number,
  folds: FoldEvent[],
): { stageName: string; stageDesc: string; foldDue: boolean; caption: string | null } {
  let stageName: string;
  let stageDesc: string;
  let foldDue = false;
  let caption: string | null = null;

  if (t < T.lagEnd) {
    stageName = 'Autolyse';
    stageDesc = 'Flour hydrating; gluten fragments forming.';
  } else if (t < T.lagEnd + 0.15) {
    stageName = 'Early Fermentation';
    stageDesc = 'Microbes waking; tiny CO₂ nuclei forming.';
    if (folds.length === 0 && t > T.lagEnd + 0.08) {
      foldDue = true;
      caption = 'Fold now: strengthen gluten and redistribute gas.';
    }
  } else if (gasVolume > 0.6 && glutenDamage < 0.15) {
    stageName = 'Peak Bulk';
    stageDesc = 'Full foam; taut films; bright junctions.';
    caption = 'Approaching peak bulk.';
  } else if (t < T.gasPeak - 0.05) {
    stageName = 'Strengthening';
    stageDesc = 'Gas cells inflating; gluten stretching and aligning.';
    const lastFoldAt = folds.length > 0 ? folds[folds.length - 1].atProgress : 0;
    if (t - lastFoldAt > 0.18 && t < 0.55) {
      foldDue = true;
      caption = 'Fold now: strengthen gluten and redistribute gas.';
    }
  } else if (glutenDamage > 0.3) {
    stageName = 'Over-fermented';
    stageDesc = 'Films tearing; voids merging; structure collapsing.';
    caption = 'Structure weakening — consider shaping soon.';
  } else {
    stageName = 'Ripe';
    stageDesc = 'Acid building; protease activating; approaching limits.';
    if (glutenDamage > 0.15) {
      caption = 'Structure weakening — consider shaping soon.';
    }
  }

  return { stageName, stageDesc, foldDue, caption };
}

// ── Estimated total bulk time ─────────────────────────────────────────────────

/**
 * Rough estimate of total bulk fermentation time in minutes.
 * Used to map wall-clock elapsed time → progress 0–1.
 */
export function estimateBulkMinutes(inputs: BakerInputs): number {
  const T = computeTiming(inputs);
  // Baseline: ~4 hours at default conditions.
  const baseMinutes = 240;
  return Math.round(baseMinutes / T.speedFactor);
}
