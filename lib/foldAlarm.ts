/**
 * Fold-reminder alarms.
 *
 * Uses only expo-notifications (no extra native module), so it runs anywhere
 * the app runs — including Expo Go and the New Architecture build this app
 * ships on. A native "rings until dismissed" alarm (Notifee on Android,
 * AlarmKit on iOS) was attempted but pulled: Notifee 9.x has no New
 * Architecture support and crashed the app on launch under RN 0.85. That work
 * is tracked in docs/launch-checklist.md.
 *
 * Behavior here: the reminder for the *next* fold re-fires every few seconds
 * for about a minute — a "burst" that keeps making noise until you deal with
 * it — and stops the moment the fold is recorded (in-app or via the "I folded"
 * notification action) or a reminder is tapped. Later folds get a single
 * reminder as an app-was-killed safety net; they're upgraded to a full burst
 * the moment they become the next fold, since recording a fold re-syncs.
 *
 * All scheduling is on absolute DATE triggers off nextFoldDueTimestamp, so a
 * recorded fold never keeps a pending reminder and a late-fold reschedule is
 * reflected automatically.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBakeStore } from '@/store/useBakeStore';

/** Matches the max the planned-folds stepper allows in the timer UI. */
export const MAX_PLANNED_FOLDS = 12;

// Burst: re-alert every GAP seconds, REPEATS extra times after the first
// (~1 min of noise) until the fold is recorded.
const FOLD_ALARM_GAP_SECONDS = 8;
const FOLD_ALARM_REPEATS = 7;

/** All fold notification ids start with this, so they can be found and
 *  cancelled even after an app restart loses in-memory state. */
const FOLD_ID_PREFIX = 'fold-';
const FOLD_CATEGORY_ID = 'fold-reminder';
const FOLDED_ACTION_ID = 'folded';

function reminderCopy(n: number, total: number) {
  const isLast = n === total;
  return {
    title: total === 1 ? 'Time to fold!' : `Fold ${n} of ${total}`,
    body: isLast
      ? 'Last fold — stretch and fold, then watch the dough for shape readiness.'
      : 'Stretch and fold your dough now.',
  };
}

/** Records a fold from a notification action — only if a bulk is running and a
 *  fold is actually still due (so a stale tap can't corrupt the count). */
function recordFoldFromNotification() {
  const s = useBakeStore.getState();
  if (s.bulkStartTimestamp !== null && s.nextFoldDueTimestamp !== null) s.recordFold();
}

/**
 * One-time setup: the "I folded" action button and the tap handler that
 * silences the rest of the burst. Call once at startup, from module scope, so
 * background action presses are handled even when the app wasn't already open.
 */
export function initFoldAlarms() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationCategoryAsync(FOLD_CATEGORY_ID, [
    {
      identifier: FOLDED_ACTION_ID,
      buttonTitle: 'I folded ✓',
      options: { opensAppToForeground: true },
    },
  ]).catch(() => {});
  Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.categoryIdentifier !== FOLD_CATEGORY_ID) return;
    // Tapping the reminder (or "I folded") silences the remaining burst.
    cancelFoldAlarms();
    if (response.actionIdentifier === FOLDED_ACTION_ID) recordFoldFromNotification();
  });
}

/**
 * Schedule reminders for every fold that hasn't been recorded yet, at their
 * absolute due times. Callers re-invoke this whenever fold state changes
 * (record, late-fold reschedule, bulk start), after cancelFoldAlarms().
 */
export async function scheduleFoldAlarms(
  nextDueTs: number,
  doneFolds: number,
  totalFolds: number,
  intervalMins: number,
) {
  if (Platform.OS === 'web' || totalFolds === 0 || doneFolds >= totalFolds) return;
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) {
      const req = await Notifications.requestPermissionsAsync();
      if (!req.granted) return;
    }
    for (let n = doneFolds + 1; n <= totalFolds; n++) {
      const isNext = n === doneFolds + 1;
      const dueTs = nextDueTs + (n - (doneFolds + 1)) * intervalMins * 60000;
      const repeats = isNext ? FOLD_ALARM_REPEATS : 0;
      for (let k = 0; k <= repeats; k++) {
        const fireTs = dueTs + k * FOLD_ALARM_GAP_SECONDS * 1000;
        if (fireTs <= Date.now() + 500) continue; // never schedule a time already past
        await Notifications.scheduleNotificationAsync({
          identifier: `${FOLD_ID_PREFIX}${n}-${k}`,
          content: {
            ...reminderCopy(n, totalFolds),
            sound: true,
            categoryIdentifier: FOLD_CATEGORY_ID,
            ...(Platform.OS === 'ios' && { interruptionLevel: 'timeSensitive' as const }),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: fireTs,
            ...(Platform.OS === 'android' && { channelId: 'bake-alerts' }),
          },
        });
      }
    }
  } catch {}
}

/** Cancel every pending fold reminder (and nothing else — the bulk-end and
 *  autolyse alerts are left alone). */
export async function cancelFoldAlarms() {
  if (Platform.OS === 'web') return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .map((r) => r.identifier)
        .filter((id) => id.startsWith(FOLD_ID_PREFIX))
        .map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
    );
  } catch {}
}
