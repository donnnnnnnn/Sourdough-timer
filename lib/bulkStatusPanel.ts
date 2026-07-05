/**
 * Persistent "bulk at a glance" panel in the phone's pull-down notification
 * shade. This file is the no-op fallback for iOS and web; the real
 * implementation lives in bulkStatusPanel.android.ts (Metro picks the
 * .android file automatically on Android).
 *
 * iOS note: the equivalent surface there is a Live Activity, which needs a
 * native widget extension — a future project, tracked in the README of this
 * feature's PR.
 */

/** Everything the shade panel needs to describe the current bulk. */
export interface BulkPanelState {
  /** Folds recorded so far. */
  completedFolds: number;
  /** Total folds planned for this bake (0 = none planned). */
  plannedFolds: number;
  /** When the next fold is due, or null once all folds are recorded. */
  nextFoldDueTimestamp: number | null;
  /** Planned end of bulk — the target shaping time. */
  targetEndTimestamp: number;
}

export async function syncBulkPanel(_state: BulkPanelState): Promise<void> {}

export async function clearBulkPanel(): Promise<void> {}
