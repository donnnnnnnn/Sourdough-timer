import type { BakeLog } from '@/store/useBakeStore';

/**
 * Estimates dough rise % from how far through bulk fermentation we are.
 *
 * Because targetMinutes is already temperature-corrected by suggestBulk,
 * the fraction elapsed/target captures temperature implicitly — a hot kitchen
 * shortens the target the same way it shortens actual fermentation. The curve
 * is a sigmoid (slow lag phase → rapid CO2 production → plateau) calibrated
 * so that elapsed == target lands at ~65%, the centre of the 50–75% shape zone.
 */
export function estimatedRise(elapsedMinutes: number, targetMinutes: number): number {
  if (targetMinutes <= 0 || elapsedMinutes <= 0) return 0;
  const f = Math.min(1.3, elapsedMinutes / targetMinutes);
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-9 * (x - 0.52)));
  const base = sigmoid(0);
  const atOne = sigmoid(1) - base;
  const pct = ((sigmoid(f) - base) / atOne) * 65;
  return Math.round(Math.max(0, pct));
}

// A typical sourdough at ~78°F finishes bulk in about 4 hours. Fermentation
// rate roughly doubles for every 15°F of warmth (Q10 ≈ 2 over ~8°C), which is
// the rule behind every baker's temperature table.
const BASELINE_MINUTES = 240;
const BASELINE_TEMP_F = 78;
const DOUBLING_DELTA_F = 15;

export interface BulkSuggestion {
  minutes: number;
  /** Plain-language explanation shown under the suggestion. */
  reason: string;
}

function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Suggest a bulk duration from the kitchen temperature and what the user's
 * own logged bakes turned out like. Priority: their history of good bakes
 * beats the generic baseline; their most recent miss nudges the number.
 */
export function suggestBulk(tempF: number, logs: BakeLog[]): BulkSuggestion {
  const proper = logs
    .filter((l) => l.diagnosis === 'properly_fermented')
    .map((l) => l.bulkDurationMinutes)
    .sort((a, b) => a - b);

  let base = proper.length > 0 ? median(proper) : BASELINE_MINUTES;
  let reasonParts: string[] = [];

  if (proper.length > 0) {
    reasonParts.push(
      `your ${proper.length} dialed-in bake${proper.length !== 1 ? 's' : ''} averaged ~${Math.round(base / 60 * 10) / 10}h`,
    );
  }

  // Course-correct off the most recent diagnosed bake: if it missed, lean
  // the suggestion away from that miss.
  const last = logs[0];
  if (last) {
    if (last.diagnosis === 'under_fermented') {
      base = Math.max(base, last.bulkDurationMinutes * 1.15);
      reasonParts.push('last bake was under-fermented, so going longer');
    } else if (last.diagnosis === 'slightly_under') {
      base = Math.max(base, last.bulkDurationMinutes * 1.08);
      reasonParts.push('last bake was a touch under, nudging longer');
    } else if (last.diagnosis === 'over_fermented') {
      base = Math.min(base, last.bulkDurationMinutes * 0.85);
      reasonParts.push('last bake was over-fermented, so pulling back');
    } else if (last.diagnosis === 'slightly_over') {
      base = Math.min(base, last.bulkDurationMinutes * 0.93);
      reasonParts.push('last bake was a touch over, nudging shorter');
    }
  }

  const tempFactor = Math.pow(2, (BASELINE_TEMP_F - tempF) / DOUBLING_DELTA_F);
  if (tempF <= BASELINE_TEMP_F - 3) {
    reasonParts.push(`${tempF}°F kitchen ferments slower`);
  } else if (tempF >= BASELINE_TEMP_F + 3) {
    reasonParts.push(`${tempF}°F kitchen ferments faster`);
  }

  const raw = base * tempFactor;
  const minutes = Math.min(720, Math.max(60, Math.round(raw / 15) * 15));

  const reason =
    reasonParts.length > 0
      ? reasonParts.join(' · ')
      : `typical dough at ${tempF}°F`;

  return { minutes, reason };
}
