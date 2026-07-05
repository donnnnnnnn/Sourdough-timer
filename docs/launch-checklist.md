# Launch checklist — things the app needs before public release

Project memory for gaps we know about but deliberately deferred. When a
session touches a related area, check this file; when something here gets
fixed, delete its entry. Add new entries as they're discovered.

---

## 1. Real "rings until dismissed" fold alarms — both platforms (deferred July 2026)

**Current state:** fold reminders use expo-notifications only (`lib/foldAlarm.ts`),
on both iOS and Android. Since a single notification can't ring indefinitely,
the *next* fold's reminder is a "burst" — it re-fires every 8s for ~1 min and
stops when the fold is recorded (in-app or via the "I folded" action) or a
reminder is tapped. This approximates, but is not, a native clock-app alarm.

**⚠️ Notifee was tried for Android and reverted — do not re-add it as-is.**
Notifee gives true `AlarmManager` + `loopSound`/`FLAG_INSISTENT` alarms, but
**Notifee 9.1.8 has no New Architecture support** (ships a legacy
`react-native.config.js` with `packageImportPath`, `codegenConfig: none`).
This app runs the New Architecture by default (RN 0.85 / Expo 56 / React 19),
so the build compiled but **crashed on launch** — its native methods resolve
to `undefined`, giving `Error: undefined is not a function` from
`initFoldAlarms()`. Lesson: a green EAS build does NOT mean the app runs;
a native module must be launched on a device before shipping (see CLAUDE.md
principle #2, "inspect outputs, don't trust exit codes").

**Options when revisiting (re-check maturity first):**
- **Android:** adopt Notifee only once it has a New-Arch-compatible release
  verified against this RN version — or use a small in-repo Expo Module that
  posts a notification with `FLAG_INSISTENT` on an exact `AlarmManager` trigger.
- **iOS:** the platform-blessed path is **AlarmKit** (new in iOS 26, WWDC 2025)
  — native Clock-style alarms that ring until dismissed and pierce Silent/Focus.
  RN/Expo wrappers exist but were immature as of July 2026 and force the iOS
  deployment target to 26.0 (drops every user on iOS ≤25):
  [expo-alarm-kit](https://github.com/nickdeupree/expo-alarm-kit) (closest, v0.1.11),
  [rn-alarm-kit](https://github.com/wael-fadlallah/rn-alarm-kit),
  [nitro-ios-alarm-kit](https://github.com/Gautham495/react-native-nitro-ios-alarm-kit),
  [expo-alarm](https://github.com/vall370/expo-alarm). Prefer one that
  *weak-links* AlarmKit so the app still installs on older iOS, with the burst
  as the ≤25 fallback. **Do not** chase Apple's critical-alerts entitlement —
  it's gated to health/safety apps; a baking timer won't qualify.
- Whichever native module is chosen, **launch it on a real device before
  shipping** — the New-Arch crash above is exactly what device testing catches.
- Nice-to-have: iOS Live Activity / Android ongoing notification showing the
  next-fold countdown on the Lock Screen.

## 2. Verify fold reminders on a real device

The burst logic type-checks but hasn't been exercised on hardware from this
cloud environment. Before release, on a physical phone confirm:

- [ ] The reminder keeps re-alerting (~1 min) until you record the fold or tap it.
- [ ] Reminders land **on time** with the phone locked ≥30 min (Doze). If they
      drift, the fix is exact alarms — which is the native-module work in §1;
      `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` are already declared in app.json.
- [ ] Recording a fold in-app cancels its pending reminders (no nag for a
      fold you've already logged — the original bug).
- [ ] Aggressive OEMs (Samsung/Xiaomi) don't kill reminders via battery
      optimization; if they do, add an in-app "allow exact alarms / disable
      battery optimization" prompt.

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
