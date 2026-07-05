/**
 * Fold-reminder alarms, one implementation per platform.
 *
 * Android — uses Notifee (open source, by Invertase). Each remaining fold gets
 * one notification scheduled on an *exact* AlarmManager trigger (survives
 * Doze/battery deferral, which is what made expo-notifications reminders land
 * minutes late), and its sound loops until the notification is dismissed or
 * opened (`loopSound` + `FLAG_INSISTENT`) — the native-clock-alarm behavior.
 *
 * iOS — no public API rings indefinitely: that needs Apple's AlarmKit
 * (iOS 26+ only) or a critical-alerts entitlement. See
 * docs/launch-checklist.md for the launch plan. Until then the closest
 * approximation is a burst: the reminder re-fires every few seconds for about
 * a minute, and stops the moment the fold is recorded or a reminder is tapped.
 *
 * Expo Go — Notifee is a native module and isn't bundled in Expo Go, so if it
 * fails to load, Android falls back to the iOS-style burst.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Event as NotifeeEvent } from '@notifee/react-native';
import { useBakeStore } from '@/store/useBakeStore';

/** Matches the max the planned-folds stepper allows in the timer UI. */
export const MAX_PLANNED_FOLDS = 12;

// Burst mode (iOS / Expo Go): re-alert every GAP seconds, REPEATS extra times
// after the first (~1 min of noise) until the fold is recorded.
const FOLD_ALARM_GAP_SECONDS = 8;
const FOLD_ALARM_REPEATS = 7;

/** All fold notification ids start with this, so they can be found and
 *  cancelled even after an app restart loses in-memory state. */
const FOLD_ID_PREFIX = 'fold-';
const FOLD_CHANNEL_ID = 'fold-alarms';
/** iOS action category id (registered in initFoldAlarms). */
const FOLD_CATEGORY_ID = 'fold-reminder';
const FOLDED_ACTION_ID = 'folded';

// Notifee is loaded lazily so the app still runs where the native module is
// missing (Expo Go, web). `null` means "use the expo-notifications burst".
const notifeeModule: typeof import('@notifee/react-native') | null = (() => {
  if (Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@notifee/react-native');
    return mod?.default ? mod : null;
  } catch {
    return null;
  }
})();

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
 * One-time setup: notification channel, "I folded" action, and tap handlers.
 * Call from the root layout at module load so background action presses are
 * handled too.
 */
export function initFoldAlarms() {
  if (Platform.OS === 'web') return;

  if (notifeeModule) {
    const notifee = notifeeModule.default;
    const { AndroidImportance, EventType } = notifeeModule;
    notifee
      .createChannel({
        id: FOLD_CHANNEL_ID,
        name: 'Fold Alarms',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        vibrationPattern: [300, 500],
      })
      .catch(() => {});
    const onEvent = async ({ type, detail }: NotifeeEvent) => {
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === FOLDED_ACTION_ID) {
        if (detail.notification?.id) {
          notifee.cancelNotification(detail.notification.id).catch(() => {});
        }
        recordFoldFromNotification();
      }
    };
    notifee.onForegroundEvent(onEvent);
    notifee.onBackgroundEvent(onEvent);
    return;
  }

  // iOS (and Expo Go fallback): an action button on the reminder, and a
  // listener so tapping the reminder — or pressing "I folded" — silences the
  // rest of the burst.
  Notifications.setNotificationCategoryAsync(FOLD_CATEGORY_ID, [
    {
      identifier: FOLDED_ACTION_ID,
      buttonTitle: 'I folded ✓',
      options: { opensAppToForeground: true },
    },
  ]).catch(() => {});
  Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.notification.request.content.categoryIdentifier !== FOLD_CATEGORY_ID) return;
    cancelFoldAlarms();
    if (response.actionIdentifier === FOLDED_ACTION_ID) recordFoldFromNotification();
  });
}

/**
 * Schedule reminders for every fold that hasn't been recorded yet, at their
 * absolute due times. Callers re-invoke this whenever fold state changes
 * (record, late-fold reschedule, bulk start), after cancelFoldAlarms() — so a
 * recorded fold never keeps a pending reminder and timing reflects reality.
 */
export async function scheduleFoldAlarms(
  nextDueTs: number,
  doneFolds: number,
  totalFolds: number,
  intervalMins: number,
) {
  if (Platform.OS === 'web' || totalFolds === 0 || doneFolds >= totalFolds) return;
  if (notifeeModule) {
    await scheduleInsistentAlarms(nextDueTs, doneFolds, totalFolds, intervalMins);
  } else {
    await scheduleBurstAlarms(nextDueTs, doneFolds, totalFolds, intervalMins);
  }
}

/** Cancel every pending or currently-ringing fold reminder (and nothing else —
 *  the bulk-end and autolyse alerts are left alone). */
export async function cancelFoldAlarms() {
  if (Platform.OS === 'web') return;
  if (notifeeModule) {
    const notifee = notifeeModule.default;
    // Ids are deterministic (fold-1 … fold-N), so cancel the whole possible
    // range — this also silences an alarm that's ringing right now, and stale
    // ones left over from before an app restart. Cancelling a missing id is a
    // no-op.
    await Promise.all(
      Array.from({ length: MAX_PLANNED_FOLDS }, (_, i) =>
        notifee.cancelNotification(`${FOLD_ID_PREFIX}${i + 1}`).catch(() => {}),
      ),
    );
    return;
  }
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

/** Android/Notifee: one exact-time notification per fold whose sound loops
 *  until it's dismissed, opened, or the fold is recorded. */
async function scheduleInsistentAlarms(
  nextDueTs: number,
  doneFolds: number,
  totalFolds: number,
  intervalMins: number,
) {
  const notifee = notifeeModule!.default;
  const { AndroidImportance, AndroidCategory, AndroidFlags, TriggerType, AlarmType, AuthorizationStatus } =
    notifeeModule!;
  try {
    const settings = await notifee.requestPermission();
    if (settings.authorizationStatus === AuthorizationStatus.DENIED) return;
    for (let n = doneFolds + 1; n <= totalFolds; n++) {
      const dueTs = nextDueTs + (n - (doneFolds + 1)) * intervalMins * 60000;
      if (dueTs <= Date.now() + 500) continue; // never schedule a time already past
      await notifee.createTriggerNotification(
        {
          id: `${FOLD_ID_PREFIX}${n}`,
          ...reminderCopy(n, totalFolds),
          android: {
            channelId: FOLD_CHANNEL_ID,
            importance: AndroidImportance.HIGH,
            category: AndroidCategory.ALARM,
            // Loop the alert sound until the user reacts — like a real alarm.
            loopSound: true,
            flags: [AndroidFlags.FLAG_INSISTENT],
            autoCancel: true,
            pressAction: { id: 'default' },
            actions: [
              {
                title: 'I folded ✓',
                pressAction: { id: FOLDED_ACTION_ID, launchActivity: 'default' },
              },
            ],
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: dueTs,
          // Exact even in Doze — inexact scheduling is what made reminders
          // arrive minutes late.
          alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
        },
      );
    }
  } catch {}
}

/** iOS / Expo Go: the next fold nags every few seconds for ~1 min; later folds
 *  get a single reminder as an app-was-killed safety net (they're upgraded to
 *  a burst when they become the next fold, since recording a fold re-syncs). */
async function scheduleBurstAlarms(
  nextDueTs: number,
  doneFolds: number,
  totalFolds: number,
  intervalMins: number,
) {
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
        if (fireTs <= Date.now() + 500) continue;
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
