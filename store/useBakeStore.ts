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
  /** Clock time of each recorded fold — feeds the dough-story timeline. */
  foldTimestamps: number[];
  defaultFoldCount: number;
  /** Expected total bulk length in minutes; drives the progress bar and end alert. */
  targetDurationMinutes: number;
  /** Kitchen/dough temperature °F — drives the suggested bulk time. */
  doughTempF: number;
  /** Latest user-marked dough rise, as % growth from start (0 = none). */
  risePercent: number;
  pendingSessions: PendingSession[];
  bakeLogs: BakeLog[];
  startBulk: (intervalMinutes: number, targetMinutes: number) => void;
  recordFold: () => void;
  endBulk: () => void;
  saveLog: (sessionId: string, diagnosis: Diagnosis) => void;
  setDefaultFoldCount: (n: number) => void;
  setTargetDuration: (minutes: number) => void;
  setDoughTemp: (tempF: number) => void;
  setRisePercent: (pct: number) => void;
}

export const useBakeStore = create<BakeState>()(
  persist(
    (set, get) => ({
      bulkStartTimestamp: null,
      foldIntervalMinutes: 30,
      completedFolds: 0,
      foldTimestamps: [],
      defaultFoldCount: 3,
      targetDurationMinutes: 240,
      doughTempF: 76,
      risePercent: 0,
      pendingSessions: [],
      bakeLogs: [],

      startBulk: (intervalMinutes, targetMinutes) =>
        set({
          bulkStartTimestamp: Date.now(),
          foldIntervalMinutes: intervalMinutes,
          targetDurationMinutes: targetMinutes,
          completedFolds: 0,
          foldTimestamps: [],
          risePercent: 0,
        }),

      recordFold: () =>
        set((state) => ({
          completedFolds: state.completedFolds + 1,
          foldTimestamps: [...state.foldTimestamps, Date.now()],
        })),

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
          foldTimestamps: [],
          risePercent: 0,
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

      setTargetDuration: (minutes) => set({ targetDurationMinutes: minutes }),

      setDoughTemp: (tempF) => set({ doughTempF: tempF }),

      setRisePercent: (pct) => set({ risePercent: pct }),
    }),
    {
      name: 'bake-store',
      storage: createJSONStorage(() => sqliteStorage),
    }
  )
);
