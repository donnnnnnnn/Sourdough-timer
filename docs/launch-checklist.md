# Launch checklist — things the app needs before public release

Project memory for gaps we know about but deliberately deferred. When a
session touches a related area, check this file; when something here gets
fixed, delete its entry. Add new entries as they're discovered.

---

## 1. Real "rings until dismissed" fold alarms (iOS still deferred, July 2026)

**Current state (`lib/foldAlarm.ts`):**
- **Android** uses [`react-native-notify-kit`](https://github.com/marcocrupi/react-native-notify-kit)
  — the actively-maintained New-Architecture (TurboModule) fork of the archived
  Notifee — for true alarms: exact `AlarmManager` triggers (survive Doze) whose
  sound loops until dismissed/opened/recorded (`loopSound` + `FLAG_INSISTENT`).
- **iOS / Expo Go / any native failure** falls back to an expo-notifications
  "burst": the next fold re-fires every 8s for ~1 min, stopping when the fold is
  recorded or a reminder is tapped. The native path is fully guarded — any throw
  flips the module to the burst, so it can never crash startup.

**⚠️ History — do NOT re-add plain `@notifee/react-native`.** Notifee 9.1.8 has
no New Architecture support (legacy `react-native.config.js`,
`codegenConfig: none`). This app is New-Arch-only (RN 0.85 / Expo 56 / React 19;
New Arch is mandatory from RN 0.82 / Expo SDK 55 — it cannot be disabled), so
Notifee compiled but **crashed on launch** with `undefined is not a function`.
notify-kit is the drop-in that fixes exactly this (verified: it ships
`codegenConfig: {type:'modules'}`, a TurboModule spec, and an Expo config
plugin). Lesson: a green EAS build does NOT mean the app runs — launch a native
module on a device before trusting it (CLAUDE.md principle #2).

**Remaining work — iOS:** the platform-blessed path is **AlarmKit** (new in
iOS 26, WWDC 2025) — native Clock-style alarms that ring until dismissed and
pierce Silent/Focus. RN/Expo wrappers existed but were immature as of July 2026
and force the iOS deployment target to 26.0 (drops every user on iOS ≤25):
[expo-alarm-kit](https://github.com/nickdeupree/expo-alarm-kit) (closest, v0.1.11),
[rn-alarm-kit](https://github.com/wael-fadlallah/rn-alarm-kit),
[nitro-ios-alarm-kit](https://github.com/Gautham495/react-native-nitro-ios-alarm-kit),
[expo-alarm](https://github.com/vall370/expo-alarm). Prefer one that
*weak-links* AlarmKit so the app still installs on older iOS, with the burst as
the ≤25 fallback. **Do not** chase Apple's critical-alerts entitlement — it's
gated to health/safety apps; a baking timer won't qualify.
- Nice-to-have: iOS Live Activity / Android ongoing notification showing the
  next-fold countdown on the Lock Screen.

## 2. Verify fold alarms on a real device

Verified from the cloud env: type-checks, notify-kit's config plugin evaluates
and registers native mods, API/enum names are correct. NOT verifiable here:
that the native module runtime-links and rings. Before release, on a physical
phone confirm:

- [ ] **Android:** the fold alarm sound **loops** until the notification is
      swiped away, tapped, or "I folded ✓" is pressed (true insistent alarm).
- [ ] **Android:** if notify-kit ever fails to link, the app still runs and
      reminders fall back to the burst (guarded — should never crash).
- [ ] Reminders land **on time** with the phone locked ≥30 min (Doze) —
      `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` are declared in app.json.
- [ ] Recording a fold in-app cancels its pending reminders / silences a
      ringing alarm (no nag for a fold you've already logged — the original bug).
- [ ] **iOS:** the burst re-alerts (~1 min) until recorded or tapped.
- [ ] Aggressive OEMs (Samsung/Xiaomi) don't kill reminders via battery
      optimization; if they do, add an in-app prompt (notify-kit exposes
      `openPowerManagerSettings()`).

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
