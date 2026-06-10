import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import sqliteStorage from './sqliteStorage';

export type Diagnosis =
  | 'under_fermented'
  | 'slightly_under'
  | 'properly_fermented'
  | 'slightly_over'
  | 'over_fermented'
  | 'weak_shaping'
  | 'fools_crumb'
  | 'oven_artifact';

export interface PendingSession {
  id: string;
  timestamp: number;
  bulkDurationMinutes: number;
  foldCount: number;
}

export interface BakeLog extends PendingSession {
  diagnosis: Diagnosis;
}

interface BakeState {
  bulkStartTimestamp: number | null;
  foldIntervalMinutes: number;
  completedFolds: number;
  defaultFoldCount: number;
  pendingSessions: PendingSession[];
  bakeLogs: BakeLog[];
  startBulk: (intervalMinutes: number) => void;
  recordFold: () => void;
  endBulk: () => void;
  saveLog: (sessionId: string, diagnosis: Diagnosis) => void;
  setDefaultFoldCount: (n: number) => void;
}

export const useBakeStore = create<BakeState>()(
  persist(
    (set, get) => ({
      bulkStartTimestamp: null,
      foldIntervalMinutes: 30,
      completedFolds: 0,
      defaultFoldCount: 3,
      pendingSessions: [],
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
        const { bulkStartTimestamp, completedFolds, pendingSessions } = get();
        if (!bulkStartTimestamp) return;
        const durationMs = Date.now() - bulkStartTimestamp;
        const durationMinutes = Math.round(durationMs / 60000);
        const newSession: PendingSession = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          timestamp: Date.now(),
          bulkDurationMinutes: durationMinutes,
          foldCount: completedFolds,
        };
        set({
          bulkStartTimestamp: null,
          completedFolds: 0,
          pendingSessions: [newSession, ...pendingSessions],
        });
      },

      saveLog: (sessionId, diagnosis) => {
        const { pendingSessions, bakeLogs } = get();
        const session = pendingSessions.find((s) => s.id === sessionId);
        if (!session) return;
        const newLog: BakeLog = { ...session, diagnosis };
        set({
          bakeLogs: [newLog, ...bakeLogs],
          pendingSessions: pendingSessions.filter((s) => s.id !== sessionId),
        });
      },

      setDefaultFoldCount: (n) => set({ defaultFoldCount: n }),
    }),
    {
      name: 'bake-store',
      storage: createJSONStorage(() => sqliteStorage),
    }
  )
);
