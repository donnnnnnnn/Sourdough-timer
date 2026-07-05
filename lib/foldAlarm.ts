/**
 * Fold-reminder alarms.
 *
 * Android gets a true "rings until dismissed" alarm via react-native-notify-kit
 * — the actively-maintained, New-Architecture (TurboModule) fork of the now-
 * archived Notifee, and the fork its README points to. Each remaining fold is
 * scheduled on an exact AlarmManager trigger (survives Doze), and its sound
 * loops until the notification is dismissed, opened, or the fold is recorded
 * (`loopSound` + `FLAG_INSISTENT`).
 *
 * Everything else — iOS, Expo Go, or *any* failure to load / call the native
 * module — falls back to an expo-notifications "burst": the next fold's
 * reminder re-fires every few seconds for ~1 min and stops when the fold is
 * recorded or a reminder is tapped.
 *
 * HARD RULE (learned from two crashes): NOTHING in this module may be able to
 * crash app startup — not the native path, and not the base expo-notifications
 * calls either. One crash came from calling an old-architecture library whose
 * native method was `undefined`; a second came from running initFoldAlarms()
 * at module scope, where a synchronous throw from an expo-notifications call
 * escaped a `.catch()` (promise .catch() cannot intercept a sync throw) and
 * took the app down before any UI. Every native touch is now inside try/catch,
 * init runs from a React effect instead of import time, and any native-alarm
 * throw permanently flips this module to the burst fallback.
 *
 * Scheduling is always on absolute times off nextFoldDueTimestamp, so a
 * recorded fold never keeps a pending reminder and a late-fold reschedule is
 * reflected automatically.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBakeStore } from '@/store/useBakeStore';

/** Matches the max the planned-folds stepper allows in the timer UI. */
export const MAX_PLANNED_FOLDS = 12;

// Burst fallback tuning: re-alert every GAP seconds, REPEATS extra times after
// the first (~1 min of noise) until the fold is recorded.
const FOLD_ALARM_GAP_SECONDS = 8;
const FOLD_ALARM_REPEATS = 7;

/** All fold notification ids start with this, so they can be found and
 *  cancelled even after an app restart loses in-memory state. */
const FOLD_ID_PREFIX = 'fold-';
const FOLD_CHANNEL_ID = 'fold-alarms';
const FOLD_CATEGORY_ID = 'fold-reminder';
const FOLDED_ACTION_ID = 'folded';

// Lazily loaded native alarm module (Android only). `nativeAndroidAlarm` starts
// true only if the module loads AND its key methods are actually functions; any
// later throw flips it to false so we self-heal onto the burst fallback.
let nk: typeof import('react-native-notify-kit') | null = null;
let nativeAndroidAlarm = false;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-notify-kit') as typeof import('react-native-notify-kit');
    if (
      mod?.default &&
      typeof mod.default.createTriggerNotification === 'function' &&
      typeof mod.default.onForegroundEvent === 'function' &&
      typeof mod.default.onBackgroundEvent === 'function'
    ) {
      nk = mod;
      nativeAndroidAlarm = true;
    }
  } catch {
    nk = null;
    nativeAndroidAlarm = false;
  }
}

/** Disable the native path for the rest of the session and log why. */
function disableNativeAlarm(err: unknown) {
  nativeAndroidAlarm = false;
  if (__DEV__) console.warn('[foldAlarm] native alarm disabled, using burst fallback:', err);
}

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

/** The one place a fold-notification response is acted on. Deduped by response
 *  identity because the same physical tap can reach us twice: once via the
 *  live listener and once via the cold-start getLastNotificationResponse()
 *  check in initFoldAlarms(). */
let lastHandledResponseKey: string | null = null;
function handleFoldResponse(response: Notifications.NotificationResponse) {
  if (response.notification.request.content.categoryIdentifier !== FOLD_CATEGORY_ID) return;
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (key === lastHandledResponseKey) return;
  lastHandledResponseKey = key;
  // Tapping the reminder (or "I folded") silences the remaining burst.
  cancelFoldAlarms();
  if (response.actionIdentifier === FOLDED_ACTION_ID) recordFoldFromNotification();
}

/**
 * One-time setup: notification category + action + tap handlers. Called from a
 * React effect in the root layout (app/_layout.tsx), NOT at module scope.
 *
 * WHY NOT MODULE SCOPE (this crashed the app): the previous revision ran this
 * at import time of the root layout. `setNotificationCategoryAsync(...).catch()`
 * and `addNotificationResponseReceivedListener(...)` were assumed safe because
 * of the `.catch()` — but `.catch()` only handles *async rejections*. A
 * SYNCHRONOUS throw from either call (e.g. a native-module method that comes
 * back `undefined` before the runtime is fully initialized) escaped uncaught at
 * module load and took the whole app down on launch, before any UI. Two rules
 * now apply to everything reachable from here:
 *   1. Nothing on the startup path may throw uncaught — every native touch is
 *      inside try/catch. Worst case is silently-degraded reminders, never a
 *      crash-on-open.
 *   2. Registration happens post-mount (React effect), when the native runtime
 *      is verifiably up. Cold-start taps that launched the app before the
 *      listener existed are recovered via getLastNotificationResponse() below.
 */
let initialized = false;
export function initFoldAlarms() {
  if (initialized || Platform.OS === 'web') return;
  initialized = true;

  // The expo-notifications category powers the burst-fallback "I folded" button
  // and its tap handler. Registered on every platform; harmless when unused.
  try {
    Notifications.setNotificationCategoryAsync(FOLD_CATEGORY_ID, [
      {
        identifier: FOLDED_ACTION_ID,
        buttonTitle: 'I folded ✓',
        options: { opensAppToForeground: true },
      },
    ]).catch(() => {});
  } catch (err) {
    // Sync throw (see doc comment). Without the category the burst reminders
    // still fire — they just lose the inline "I folded" button.
    if (__DEV__) console.warn('[foldAlarm] category registration failed:', err);
  }

  try {
    Notifications.addNotificationResponseReceivedListener(handleFoldResponse);
    // If a fold notification's tap is what launched the app, the response
    // happened before the listener above existed — pick it up here.
    const launchResponse = Notifications.getLastNotificationResponse();
    if (launchResponse) handleFoldResponse(launchResponse);
  } catch (err) {
    if (__DEV__) console.warn('[foldAlarm] response listener failed:', err);
  }

  if (nativeAndroidAlarm && nk) {
    try {
      const notifee = nk.default;
      const { AndroidImportance, EventType } = nk;
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
      const onEvent = async (event: { type: number; detail: any }) => {
        const { type, detail } = event;
        if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
          // Any interaction silences the still-ringing insistent alarm.
          const id: string | undefined = detail?.notification?.id;
          if (id) notifee.cancelNotification(id).catch(() => {});
          if (detail?.pressAction?.id === FOLDED_ACTION_ID) recordFoldFromNotification();
        }
      };
      notifee.onForegroundEvent(onEvent);
      notifee.onBackgroundEvent(onEvent);
    } catch (err) {
      disableNativeAlarm(err);
    }
  }
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
  if (nativeAndroidAlarm && nk) {
    try {
      await scheduleNativeAndroid(nextDueTs, doneFolds, totalFolds, intervalMins);
      return;
    } catch (err) {
      disableNativeAlarm(err);
      // fall through to the burst so this fold still gets reminders
    }
  }
  await scheduleBurst(nextDueTs, doneFolds, totalFolds, intervalMins);
}

/** Cancel every pending/ringing fold reminder (native and expo) — and nothing
 *  else, so the bulk-end and autolyse alerts are left alone. */
export async function cancelFoldAlarms() {
  if (Platform.OS === 'web') return;
  if (nk) {
    // Ids are deterministic (fold-1 … fold-N); cancel the whole possible range.
    // cancelNotification stops a displayed insistent alarm AND its pending
    // trigger. Cancelling a missing id is a no-op.
    try {
      await Promise.all(
        Array.from({ length: MAX_PLANNED_FOLDS }, (_, i) =>
          nk!.default.cancelNotification(`${FOLD_ID_PREFIX}${i + 1}`).catch(() => {}),
        ),
      );
    } catch (err) {
      disableNativeAlarm(err);
    }
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

/** Android/notify-kit: one exact-time notification per fold whose sound loops
 *  until it's dismissed, opened, or the fold is recorded. */
async function scheduleNativeAndroid(
  nextDueTs: number,
  doneFolds: number,
  totalFolds: number,
  intervalMins: number,
) {
  const notifee = nk!.default;
  const { AndroidImportance, AndroidCategory, AndroidFlags, TriggerType, AlarmType, AuthorizationStatus } = nk!;
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
          loopSound: true,
          flags: [AndroidFlags.FLAG_INSISTENT],
          autoCancel: true,
          pressAction: { id: 'default' },
          actions: [
            { title: 'I folded ✓', pressAction: { id: FOLDED_ACTION_ID, launchActivity: 'default' } },
          ],
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: dueTs,
        alarmManager: { type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE },
      },
    );
  }
}

/** iOS / Expo Go / native-unavailable: the next fold nags every few seconds for
 *  ~1 min; later folds get a single reminder as an app-was-killed safety net
 *  (they're upgraded when they become the next fold, since recording re-syncs). */
async function scheduleBurst(
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
