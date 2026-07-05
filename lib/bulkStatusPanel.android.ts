/**
 * Android implementation of the persistent bulk-ferment panel: a single
 * silent, ongoing notification pinned in the pull-down shade for the whole
 * bulk, like the system timer apps.
 *
 * What it shows while folds remain:
 *  - a live countdown to the next fold (the OS renders the chronometer in the
 *    notification header, so it keeps ticking even while the app sleeps)
 *  - a fold progress wheel (pre-rendered honey-ring artwork, one frame per
 *    twelfth of progress) plus a progress bar
 *  - the target shaping time as a clock time
 *
 * Once every fold is recorded it shrinks to one calm line counting down to
 * shaping time.
 *
 * Nothing here makes sound or vibrates — the loud "time to fold!" alerts stay
 * with expo-notifications in the timer screen. This panel is ambient.
 *
 * Because no JavaScript runs while the app is asleep, the moment-of-truth
 * flips ("fold is due now", "bulk time is up") are pre-scheduled with Notifee
 * trigger notifications that reuse the same notification id, so the OS swaps
 * the panel's content at the right minute on its own.
 */
import notifee, {
  AndroidImportance,
  TriggerType,
  type Notification,
  type TimestampTrigger,
} from '@notifee/react-native';
import type { BulkPanelState } from './bulkStatusPanel';

const PANEL_ID = 'bulk-panel';
const CHANNEL_ID = 'bulk-panel';
const HONEY = '#E8A33D';

// The fold wheel, rendered in twelfths by tools/generate_notification_icons.mjs.
// require() must be static, so the frames are enumerated by hand.
const WHEEL_FRAMES = [
  require('../assets/images/fold-wheel/wheel-0.png'),
  require('../assets/images/fold-wheel/wheel-1.png'),
  require('../assets/images/fold-wheel/wheel-2.png'),
  require('../assets/images/fold-wheel/wheel-3.png'),
  require('../assets/images/fold-wheel/wheel-4.png'),
  require('../assets/images/fold-wheel/wheel-5.png'),
  require('../assets/images/fold-wheel/wheel-6.png'),
  require('../assets/images/fold-wheel/wheel-7.png'),
  require('../assets/images/fold-wheel/wheel-8.png'),
  require('../assets/images/fold-wheel/wheel-9.png'),
  require('../assets/images/fold-wheel/wheel-10.png'),
  require('../assets/images/fold-wheel/wheel-11.png'),
  require('../assets/images/fold-wheel/wheel-12.png'),
];

function wheelFrame(completed: number, planned: number) {
  const frac = planned > 0 ? Math.min(1, completed / planned) : 1;
  return WHEEL_FRAMES[Math.round(frac * (WHEEL_FRAMES.length - 1))];
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function ensureChannel() {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Bulk ferment panel',
    description: 'The quiet always-there bulk fermentation status card.',
    importance: AndroidImportance.LOW, // present in the shade, never makes a sound
    vibration: false,
    badge: false,
  });
}

/** Shared bones of every panel variant: silent, pinned, taps open the app. */
function basePanel(state: BulkPanelState): Notification {
  return {
    id: PANEL_ID,
    android: {
      channelId: CHANNEL_ID,
      // Drawable generated at prebuild from the expo-notifications plugin
      // config in app.json — the bread silhouette, tinted honey by `color`.
      smallIcon: 'notification_icon',
      color: HONEY,
      largeIcon: wheelFrame(state.completedFolds, state.plannedFolds),
      ongoing: true,
      autoCancel: false,
      onlyAlertOnce: true,
      showTimestamp: true,
      showChronometer: true,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  };
}

/** Counting down to the next fold, wheel + bar showing folds done. */
function foldCountdownPanel(state: BulkPanelState): Notification {
  const base = basePanel(state);
  return {
    ...base,
    title: `Fold ${state.completedFolds + 1} of ${state.plannedFolds} coming up`,
    body: `Shape around ${formatClock(state.targetEndTimestamp)}`,
    android: {
      ...base.android,
      chronometerDirection: 'down',
      timestamp: state.nextFoldDueTimestamp ?? Date.now(),
      progress: { max: state.plannedFolds, current: state.completedFolds },
    },
  };
}

/** The fold's moment has arrived — chronometer now counts how long it's been waiting. */
function foldDuePanel(state: BulkPanelState): Notification {
  const base = basePanel(state);
  return {
    ...base,
    title: `Time for fold ${state.completedFolds + 1} of ${state.plannedFolds}`,
    body: `A gentle stretch and fold, then rest again · shape around ${formatClock(state.targetEndTimestamp)}`,
    android: {
      ...base.android,
      chronometerDirection: 'up',
      timestamp: state.nextFoldDueTimestamp ?? Date.now(),
      progress: { max: state.plannedFolds, current: state.completedFolds },
    },
  };
}

/** All folds done: one quiet line counting down to shaping time. */
function restingPanel(state: BulkPanelState): Notification {
  const base = basePanel(state);
  return {
    ...base,
    title: `Dough rising — shape around ${formatClock(state.targetEndTimestamp)}`,
    android: {
      ...base.android,
      chronometerDirection: 'down',
      timestamp: state.targetEndTimestamp,
    },
  };
}

/** Target bulk time has passed — invite a check, still calm. */
function bulkUpPanel(state: BulkPanelState): Notification {
  const base = basePanel(state);
  return {
    ...base,
    title: 'Your dough should be about ready',
    body: 'Look for a domed, airy dough that pulls from the bowl.',
    android: {
      ...base.android,
      chronometerDirection: 'up',
      timestamp: state.targetEndTimestamp,
    },
  };
}

/**
 * Bring the shade panel in line with the current bulk state, and pre-arm the
 * next OS-side content flip. Call on every state change (start, fold
 * recorded, target adjusted) — it fully replaces what's there.
 */
export async function syncBulkPanel(state: BulkPanelState): Promise<void> {
  try {
    await notifee.requestPermission();
    await ensureChannel();
    // Drop any previously armed flip; we re-derive it below.
    await notifee.cancelTriggerNotification(PANEL_ID);

    const now = Date.now();
    const folding =
      state.plannedFolds > 0 &&
      state.nextFoldDueTimestamp !== null &&
      state.completedFolds < state.plannedFolds;

    let current: Notification;
    let flip: Notification | null = null;
    let flipAt = 0;

    if (folding) {
      if (state.nextFoldDueTimestamp! > now) {
        current = foldCountdownPanel(state);
        flip = foldDuePanel(state);
        flipAt = state.nextFoldDueTimestamp!;
      } else {
        current = foldDuePanel(state);
      }
    } else if (state.targetEndTimestamp > now) {
      current = restingPanel(state);
      flip = bulkUpPanel(state);
      flipAt = state.targetEndTimestamp;
    } else {
      current = bulkUpPanel(state);
    }

    await notifee.displayNotification(current);

    if (flip) {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: flipAt };
      await notifee.createTriggerNotification(flip, trigger);
    }
  } catch {
    // The panel is a nicety — never let it break the timer itself.
  }
}

/** Take the panel down (bulk ended or was undone into a fresh state). */
export async function clearBulkPanel(): Promise<void> {
  try {
    await notifee.cancelTriggerNotification(PANEL_ID);
    await notifee.cancelNotification(PANEL_ID);
  } catch {}
}
