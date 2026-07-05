# DEBUG HANDOFF — app crashes on launch: "Error: undefined is not a function"

**Status:** unresolved. Branch `claude/fold-notification-fixes-7j2l0y`.
**Symptom:** on a real Android device, the app shows the expo-router
ErrorBoundary screen immediately on open — "Something went wrong / Error:
undefined is not a function". No stack trace is shown on-device. Crashes
before any UI renders → the failing code runs at **module load / startup**.

## The one thing we know for certain (isolation result)

Three EAS builds were tested on-device; the crash is identical in all that
contain this branch's JS, regardless of native alarm module:

| Build commit | Native alarm module | Result on device |
|---|---|---|
| main (`fdf7ff2`, shipped v1.1.0) | none | **works** (has the original notification bug, but opens) |
| `cb566f0` / `5e47520` | @notifee/react-native 9.1.8 | crash |
| `90346b5` (diagnostic) | **NONE — pure expo-notifications** | **crash** |
| `48c6b46` (HEAD) | react-native-notify-kit 10.4.6 | crash |

**Conclusion: the native alarm module is NOT the cause.** The earlier
"Notifee has no New-Arch support" diagnosis was wrong (or at most a second,
masked problem). The crash is in the **shared JS/config this branch adds on
top of main**, which runs at startup. Do not spend more time on the native
modules until the startup crash is fixed.

Verified NOT the cause:
- `package.json` at `90346b5` is **identical to main**; `git diff origin/main..90346b5 -- package-lock.json` shows **0 changed dependency versions**. So it is not a dependency-version drift from the various npm install/uninstall cycles.
- typecheck passes (`npx tsc --noEmit`), so it's a runtime-only failure.

## Prime suspect (unconfirmed) — please verify first

The only thing this branch adds to the **module-scope startup path** is a call
to `initFoldAlarms()` in `app/_layout.tsx` (runs at import time, before React
renders). See `lib/foldAlarm.ts` → `initFoldAlarms()`. It calls, at module
scope, with NO surrounding try/catch:

```ts
Notifications.setNotificationCategoryAsync(FOLD_CATEGORY_ID, [...]).catch(() => {});
Notifications.addNotificationResponseReceivedListener((response) => { ... });
```

Hypothesis: one of these **throws synchronously** (not an async rejection, so
`.catch()` does NOT protect it), taking down startup. Evidence:
- `expo-notifications@56.0.18` implements `addNotificationResponseReceivedListener`
  via `new LegacyEventEmitter(NotificationsEmitterModule)` (see
  `node_modules/expo-notifications/build/NotificationsEmitter.js`). `LegacyEventEmitter`
  from `expo-modules-core` is deprecated under the New Architecture (mandatory
  on RN 0.85 / Expo SDK 56) and is a plausible source of an `undefined`
  method call.
- `main` never called either API, which is why it doesn't crash.

**This is a hypothesis, not confirmed.** The device shows no stack trace, and
this environment cannot run the app (see constraints). Confirm before trusting.

## What to actually do

1. **Confirm the culprit.** Options, cheapest first:
   - Read `expo-notifications@56.0.18` release notes / changelog for
     `addNotificationResponseReceivedListener` and `setNotificationCategoryAsync`
     signature or removal changes in SDK 55/56. The API may have been renamed
     (e.g. to a hook `useLastNotificationResponse`, or an `EventSubscription`
     change).
   - Bisect by feature flag: ship a build where `initFoldAlarms()` is a no-op
     and confirm the crash disappears; then re-enable each call one at a time.
     (Each test = one EAS build, ~20 min — see build instructions below.)
2. **Fix defensively regardless of which call it is:** wrap the entire
   `initFoldAlarms()` body in try/catch, and wrap the per-call scheduling too,
   so a startup notification-API problem can NEVER crash the app — worst case
   it silently disables reminders. A crash-on-open is far worse than missing
   reminders. The current code guards the *native* path this way but NOT the
   base expo-notifications calls — close that gap.
3. If `addNotificationResponseReceivedListener` is the problem, the modern
   replacement in this SDK is likely the `useLastNotificationResponse()` hook
   (call inside a React component, not module scope) — verify against the
   installed version's `build/*.d.ts` and use whatever it actually exports.
4. Rebuild and have the human test on-device (only real verification).

## Environment constraints (important)

- **Cannot run the app here.** No Android emulator/device, no Expo Go; Node
  can't `require` the RN/Expo TS sources directly. Verification of runtime
  behavior only happens by building via EAS and installing on the human's
  phone. Do NOT claim a fix works without a device test — that mistake was
  made twice already.
- **A green EAS build ≠ a working app.** Both crashing builds compiled fine.
- Static checks that DO work here: `npx tsc --noEmit`, grepping
  `node_modules/expo-notifications/build/*.d.ts` for real export names/shapes,
  `npx expo config --type prebuild --json` to validate config plugins.

## How to build & read logs (no local git/EAS creds; use GitHub MCP tools)

- Push to `claude/fold-notification-fixes-7j2l0y` (or a `claude/diag-*` branch).
- Trigger: GitHub Actions workflow `eas-build.yml` via
  `mcp__github__actions_run_trigger` (method `run_workflow`, ref = branch).
  It runs `eas build --platform android --profile preview` (internal-dist APK).
- Poll: `mcp__github__actions_list` (list_workflow_jobs on the run id).
- Get the install URL: `mcp__github__get_job_logs` (return_content, tail ~40) —
  look for `https://expo.dev/accounts/donnf/projects/sourdough-timer/builds/<id>`.
  Each build has its OWN url; Expo shows the build's *start* time (UTC), which
  confused the human earlier (looked "old" in local time).
- `npm ci` can fail with transient `ECONNRESET` (exit 152) — just re-run.

## Context: what the feature is supposed to do

Original bug report (v1.1.0): the fold push-notification (1) fired even after
the user recorded that fold, (2) arrived 4–5 min late, (3) only buzzed once
instead of ringing until dismissed. The intended fixes:
- Reactive scheduling off `nextFoldDueTimestamp`/`completedFolds` so a recorded
  fold never keeps a pending reminder (in `app/(tabs)/index.tsx` sync effect +
  `lib/foldAlarm.ts`). This logic is fine and worth keeping.
- Persistent "alarm": Android via a native module (loopSound/FLAG_INSISTENT +
  exact AlarmManager); iOS via a notification "burst" (AlarmKit deferred — see
  `docs/launch-checklist.md`). **Secondary — get the app not crashing first.**

## Files this branch touches

- `app/_layout.tsx` — adds module-scope `initFoldAlarms()` call (**suspect**).
- `lib/foldAlarm.ts` — new; `initFoldAlarms` / `scheduleFoldAlarms` /
  `cancelFoldAlarms` (**suspect: the expo-notifications calls in initFoldAlarms**).
- `app/(tabs)/index.tsx` — reactive fold-scheduling effect (runs in a component,
  less likely to be the startup crash but check its effect body too).
- `app.json` — added SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM perms; notify-kit plugin.
- `eas.json` — `cli.appVersionSource: "remote"`; version bumped to 1.2.0.
