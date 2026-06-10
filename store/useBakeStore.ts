import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import sqliteStorage from './sqliteStorage';

export type CrumbType = 'Classical' | 'Honeycomb' | 'Molten' | 'Fools Crumb';
export type ShapeType = 'Full Body' | 'Sloping Shoulders' | 'Spreading';

export type Diagnosis =
  | 'under_fermented'
  | 'slightly_under'
  | 'properly_fermented'
  | 'slightly_over'
  | 'over_fermented'
  | 'weak_shaping'
  | 'fools_crumb'
  | 'oven_artifact';

export interface BakeLog {
  id: string;
  timestamp: number;
  bulkDurationMinutes: number;
  foldCount: number;
  diagnosis: Diagnosis;
  // Legacy fields from the pre-diagnosis log format; kept so old persisted logs still render.
  crumbType?: CrumbType;
  shapeType?: ShapeType;
}

interface BakeState {
  bulkStartTimestamp: number | null;
  foldIntervalMinutes: number;
  completedFolds: number;
  lastBulkDurationMinutes: number | null;
  lastFoldCount: number | null;
  bakeLogs: BakeLog[];
  startBulk: (intervalMinutes: number) => void;
  recordFold: () => void;
  endBulk: () => void;
  saveLog: (diagnosis: Diagnosis) => void;
  clearPendingLog: () => void;
}

export const useBakeStore = create<BakeState>()(
  persist(
    (set, get) => ({
      bulkStartTimestamp: null,
      foldIntervalMinutes: 30,
      completedFolds: 0,
      lastBulkDurationMinutes: null,
      lastFoldCount: null,
      bakeLogs: [],

      startBulk: (intervalMinutes) =>
        set({
          bulkStartTimestamp: Date.now(),
          foldIntervalMinutes: intervalMinutes,
          completedFolds: 0,
        }),

      recordFold: () =>
        set((state) => ({ completedFolds: state.completedFolds + 1 })),

      endBulk: () => {
        const { bulkStartTimestamp, completedFolds } = get();
        if (!bulkStartTimestamp) return;
        const durationMs = Date.now() - bulkStartTimestamp;
        const durationMinutes = Math.round(durationMs / 60000);
        set({
          bulkStartTimestamp: null,
          lastBulkDurationMinutes: durationMinutes,
          lastFoldCount: completedFolds,
          completedFolds: 0,
        });
      },

      saveLog: (diagnosis) => {
        const { lastBulkDurationMinutes, lastFoldCount, bakeLogs } = get();
        if (lastBulkDurationMinutes === null || lastFoldCount === null) return;
        const newLog: BakeLog = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: Date.now(),
          bulkDurationMinutes: lastBulkDurationMinutes,
          foldCount: lastFoldCount,
          diagnosis,
        };
        set({
          bakeLogs: [newLog, ...bakeLogs],
          lastBulkDurationMinutes: null,
          lastFoldCount: null,
        });
      },

      clearPendingLog: () =>
        set({ lastBulkDurationMinutes: null, lastFoldCount: null }),
    }),
    {
      name: 'bake-store',
      storage: createJSONStorage(() => sqliteStorage),
    }
  )
);
