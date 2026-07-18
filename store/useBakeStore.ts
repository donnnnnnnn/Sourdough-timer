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

/** One user-logged rise observation during bulk. */
export interface RiseMark {
  /** Minutes since bulk start when the mark was logged. */
  atMinutes: number;
  /** Observed rise, % growth from start. */
  pct: number;
}

export interface PendingSession {
  id: string;
  timestamp: number;
  bulkDurationMinutes: number;
  foldCount: number;
  // Captured at endBulk() since v2 — optional so pre-migration rows still load.
  doughTempF?: number;
  risePercent?: number;
  foldTimestamps?: number[];
}

export interface BakeLog extends PendingSession {
  diagnosis: Diagnosis;
  /** Crumb photo persisted into the app's documents dir (since v2). */
  photoUri?: string;
  notes?: string;
}

/** Snapshot of active-bulk state taken at endBulk(), so a mistaken tap can be undone. */
export interface EndedBulkSnapshot {
  sessionId: string;
  bulkStartTimestamp: number;
  foldIntervalMinutes: number;
  completedFolds: number;
  foldTimestamps: number[];
  targetDurationMinutes: number;
  nextFoldDueTimestamp: number | null;
  risePercent: number;
  riseMarks: RiseMark[];
}

interface BakeState {
  bulkStartTimestamp: number | null;
  /** When an autolyse rest was started (flour+water, pre-levain), or null. */
  autolyseStartTimestamp: number | null;
  /** Chosen autolyse length in minutes. */
  autolyseDurationMinutes: number;
  foldIntervalMinutes: number;
  completedFolds: number;
  /** Clock time of each recorded fold — feeds the journey timeline. */
  foldTimestamps: number[];
  /** When the next fold is due, or null once all planned folds are recorded. */
  nextFoldDueTimestamp: number | null;
  defaultFoldCount: number;
  /** Expected total bulk length in minutes; drives the journey and end alert. */
  targetDurationMinutes: number;
  /** Kitchen/dough temperature °F — always stored in °F; display converts. */
  doughTempF: number;
  /** Display unit for temperatures. */
  tempUnit: 'F' | 'C';
  /** Latest user-marked dough rise, as % growth from start (0 = none). */
  risePercent: number;
  /** All rise observations this bulk — the corridor chart's actual line. */
  riseMarks: RiseMark[];
  pendingSessions: PendingSession[];
  bakeLogs: BakeLog[];
  /** Most recent endBulk() call, kept around so it can be undone. */
  lastEndedBulk: EndedBulkSnapshot | null;
  startAutolyse: (minutes: number) => void;
  cancelAutolyse: () => void;
  startBulk: (intervalMinutes: number, targetMinutes: number) => void;
  /** keepSchedule=true keeps the next due time on the original fixed cadence
   *  (interval from the missed due time); otherwise it restarts the interval
   *  from now. */
  recordFold: (opts?: { keepSchedule?: boolean }) => void;
  endBulk: () => void;
  undoEndBulk: () => void;
  saveLog: (
    sessionId: string,
    diagnosis: Diagnosis,
    extras?: { photoUri?: string; notes?: string },
  ) => void;
  setDefaultFoldCount: (n: number) => void;
  setTargetDuration: (minutes: number) => void;
  setDoughTemp: (tempF: number) => void;
  setTempUnit: (unit: 'F' | 'C') => void;
  setRisePercent: (pct: number) => void;
  /** Log a rise observation "now" (during an active bulk). */
  addRiseMark: (pct: number) => void;
}

export const useBakeStore = create<BakeState>()(
  persist(
    (set, get) => ({
      bulkStartTimestamp: null,
      autolyseStartTimestamp: null,
      autolyseDurationMinutes: 20,
      foldIntervalMinutes: 30,
      completedFolds: 0,
      foldTimestamps: [],
      nextFoldDueTimestamp: null,
      defaultFoldCount: 3,
      targetDurationMinutes: 240,
      doughTempF: 76,
      tempUnit: 'F',
      risePercent: 0,
      riseMarks: [],
      pendingSessions: [],
      bakeLogs: [],
      lastEndedBulk: null,

      startAutolyse: (minutes) =>
        set({ autolyseStartTimestamp: Date.now(), autolyseDurationMinutes: minutes }),

      cancelAutolyse: () => set({ autolyseStartTimestamp: null }),

      startBulk: (intervalMinutes, targetMinutes) =>
        set({
          bulkStartTimestamp: Date.now(),
          autolyseStartTimestamp: null,
          foldIntervalMinutes: intervalMinutes,
          targetDurationMinutes: targetMinutes,
          completedFolds: 0,
          foldTimestamps: [],
          nextFoldDueTimestamp: Date.now() + intervalMinutes * 60000,
          risePercent: 0,
          riseMarks: [],
          lastEndedBulk: null,
        }),

      recordFold: (opts) =>
        set((state) => {
          const completedFolds = state.completedFolds + 1;
          const allDone = state.defaultFoldCount > 0 && completedFolds >= state.defaultFoldCount;
          let nextFoldDueTimestamp: number | null = null;
          if (!allDone) {
            const due = state.nextFoldDueTimestamp ?? Date.now();
            nextFoldDueTimestamp = opts?.keepSchedule
              ? due + state.foldIntervalMinutes * 60000
              : Date.now() + state.foldIntervalMinutes * 60000;
          }
          return {
            completedFolds,
            foldTimestamps: [...state.foldTimestamps, Date.now()],
            nextFoldDueTimestamp,
          };
        }),

      endBulk: () => {
        const {
          bulkStartTimestamp,
          completedFolds,
          foldTimestamps,
          pendingSessions,
          foldIntervalMinutes,
          targetDurationMinutes,
          nextFoldDueTimestamp,
          doughTempF,
          risePercent,
          riseMarks,
        } = get();
        if (!bulkStartTimestamp) return;
        const durationMs = Date.now() - bulkStartTimestamp;
        const durationMinutes = Math.round(durationMs / 60000);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const newSession: PendingSession = {
          id,
          timestamp: Date.now(),
          bulkDurationMinutes: durationMinutes,
          foldCount: completedFolds,
          doughTempF,
          risePercent,
          foldTimestamps,
        };
        set({
          bulkStartTimestamp: null,
          completedFolds: 0,
          foldTimestamps: [],
          nextFoldDueTimestamp: null,
          risePercent: 0,
          riseMarks: [],
          pendingSessions: [newSession, ...pendingSessions],
          lastEndedBulk: {
            sessionId: id,
            bulkStartTimestamp,
            foldIntervalMinutes,
            completedFolds,
            foldTimestamps,
            targetDurationMinutes,
            nextFoldDueTimestamp,
            risePercent,
            riseMarks,
          },
        });
      },

      undoEndBulk: () => {
        const { lastEndedBulk, pendingSessions } = get();
        if (!lastEndedBulk) return;
        set({
          bulkStartTimestamp: lastEndedBulk.bulkStartTimestamp,
          foldIntervalMinutes: lastEndedBulk.foldIntervalMinutes,
          completedFolds: lastEndedBulk.completedFolds,
          foldTimestamps: lastEndedBulk.foldTimestamps,
          targetDurationMinutes: lastEndedBulk.targetDurationMinutes,
          nextFoldDueTimestamp: lastEndedBulk.nextFoldDueTimestamp,
          risePercent: lastEndedBulk.risePercent,
          riseMarks: lastEndedBulk.riseMarks ?? [],
          pendingSessions: pendingSessions.filter((s) => s.id !== lastEndedBulk.sessionId),
          lastEndedBulk: null,
        });
      },

      saveLog: (sessionId, diagnosis, extras) => {
        const { pendingSessions, bakeLogs, lastEndedBulk } = get();
        const session = pendingSessions.find((s) => s.id === sessionId);
        if (!session) return;
        const newLog: BakeLog = { ...session, diagnosis, ...extras };
        set({
          bakeLogs: [newLog, ...bakeLogs],
          pendingSessions: pendingSessions.filter((s) => s.id !== sessionId),
          lastEndedBulk: lastEndedBulk?.sessionId === sessionId ? null : lastEndedBulk,
        });
      },

      setDefaultFoldCount: (n) => set({ defaultFoldCount: n }),

      setTargetDuration: (minutes) => set({ targetDurationMinutes: minutes }),

      setDoughTemp: (tempF) => set({ doughTempF: tempF }),

      setTempUnit: (unit) => set({ tempUnit: unit }),

      setRisePercent: (pct) => set({ risePercent: pct }),

      addRiseMark: (pct) => {
        const { bulkStartTimestamp, riseMarks } = get();
        if (!bulkStartTimestamp) return;
        const atMinutes = Math.max(0, (Date.now() - bulkStartTimestamp) / 60000);
        // One mark per moment: replace any mark within the same minute so
        // dragging the chart doesn't spray duplicates.
        const kept = riseMarks.filter((m) => Math.abs(m.atMinutes - atMinutes) >= 1);
        set({
          riseMarks: [...kept, { atMinutes, pct }].sort((a, b) => a.atMinutes - b.atMinutes),
          risePercent: pct,
        });
      },
    }),
    {
      name: 'bake-store',
      version: 2,
      // v1 → v2 added optional fields (tempUnit, riseMarks, per-session
      // temp/rise/foldTimestamps, photoUri/notes). All additive: old rows
      // simply lack the fields, and initial-state merge supplies defaults.
      migrate: (persisted) => persisted as BakeState,
      storage: createJSONStorage(() => sqliteStorage),
    }
  )
);
