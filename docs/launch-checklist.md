# Launch checklist — things the app needs before public release

Project memory for gaps we know about but deliberately deferred. When a
session touches a related area, check this file; when something here gets
fixed, delete its entry. Add new entries as they're discovered.

---

## 1. iOS: real "rings until dismissed" fold alarms (deferred July 2026)

**Current state:** Android fold reminders are true alarms — Notifee schedules
them on exact `AlarmManager` triggers and the sound loops until the
notification is dismissed (`lib/foldAlarm.ts`). iOS only gets an
approximation: a burst of notifications every 8 seconds for ~1 minute, which
stops when the fold is recorded or a reminder is tapped.

**Why:** iOS has no public API that rings indefinitely from a normal
notification. The platform-blessed solution is **AlarmKit** (new in iOS 26,
WWDC 2025) — it gives third-party timer apps native Clock-style alarms that
ring until dismissed and break through Silent/Focus modes. This is the
industry best practice for timer apps as of 2026.

**Why not now:** the open-source React Native/Expo wrappers exist but were
judged too immature to adopt (checked July 2026):

- [nickdeupree/expo-alarm-kit](https://github.com/nickdeupree/expo-alarm-kit) —
  closest fit (Expo module, absolute-time scheduling, v0.1.11), but requires
  raising the **iOS deployment target to 26.0** (drops every user on iOS ≤25),
  manual App Group + Info.plist setup in Xcode, and has known broken options.
- [wael-fadlallah/rn-alarm-kit](https://github.com/wael-fadlallah/rn-alarm-kit),
  [Gautham495/react-native-nitro-ios-alarm-kit](https://github.com/Gautham495/react-native-nitro-ios-alarm-kit),
  [vall370/expo-alarm](https://github.com/vall370/expo-alarm) — same iOS 26
  floor, similarly early-stage.

**Plan for launch:**
- [ ] Re-check those wrappers' maturity; if one supports *weak-linking*
      AlarmKit (app still installs on older iOS, alarms only on 26+), adopt it
      with the current notification burst as the ≤25 fallback.
- [ ] Otherwise write a small in-repo Expo Module (Swift, `#available(iOS 26)`
      guard) around AlarmKit — roughly: `requestAuthorization()`,
      `scheduleAlarm(date, title)`, `cancelAlarm(id)` — keeping the burst
      fallback. Needs `NSAlarmKitUsageDescription` in Info.plist.
- [ ] **Do not** pursue Apple's critical-alerts entitlement as a shortcut —
      it's gated to health/safety/security apps and a baking timer won't
      qualify.
- Nice-to-have while in there: a Live Activity showing the next-fold countdown
  on the Lock Screen / Dynamic Island.

## 2. Android: verify alarm behavior on a real device

The Notifee implementation type-checks but hasn't been exercised on hardware
from this cloud environment. Before release, on a physical phone confirm:

- [ ] Fold alarm sound **loops** until the notification is swiped away /
      tapped / "I folded ✓" pressed.
- [ ] Alarms land **on time** with the phone locked ≥30 min (Doze) — this was
      the "4–5 minutes late" bug; exact `AlarmManager` triggers +
      `USE_EXACT_ALARM` should fix it.
- [ ] Recording a fold in-app silences an alarm that's mid-ring.
- [ ] Battery optimization exemption isn't needed (if reminders still drift on
      aggressive OEMs — Samsung/Xiaomi — add an in-app prompt via
      `notifee.openBatteryOptimizationSettings()`).

## 3. Play Store / App Store submission blockers

- [ ] `android.package` is `com.anonymous.sourdoughtimer` — decide the final
      application id **before** the first Play upload; it can never change
      afterwards. Set a matching `ios.bundleIdentifier` (currently unset).
- [ ] Play Console policy declaration for `USE_EXACT_ALARM` — allowed only if
      exact alarms are core functionality; this app is a timer, so declare it
      as such when prompted.
- [ ] Notification permission priming: on first "Start Bulk" the OS
      permission dialog just appears. Add a short explainer screen first
      (higher grant rates, and required context per Play guidelines).
- [ ] Privacy policy URL (both stores require one — the app uses camera/photo
      library for crumb diagnosis and stores bake history).

## 4. ML model (tracked in CLAUDE.md "Current state / next steps")

The crumb classifier still needs: working Anthropic key for curation, ≥100
images/class, training run, and wiring `crumb_classifier.tflite` into
`model/visionAnalyzer.ts`. Ship the diagnose tab behind a "beta" label if the
model isn't ready at launch.
