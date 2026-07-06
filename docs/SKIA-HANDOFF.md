# SKIA HANDOFF — restore the fermentation animation without crashing on launch

**Owner is non-technical.** Explain decisions in plain language and prove things
with evidence (build logs, device tests), never "it should work."

---

## ✅ RESOLVED (July 2026) — read this before anything below

The investigation is complete; everything below is historical record. The true
root cause was found by running the app's own Babel transform on the component
and reading the output — after two plausible-but-wrong theories (documented
below so they aren't repeated).

- **TRUE ROOT CAUSE — `'worklet'` directives + forward references.** Every
  draw helper in `SkiaFermentationScene.tsx` was marked `'worklet'`, and
  `drawScene` (declared FIRST in the file) calls helpers declared AFTER it.
  Plain JS handles that via function hoisting — but the worklets Babel plugin
  rewrites each marked `function foo() {}` into a `var foo = factory({...deps})`
  whose dependencies are **captured at the declaration site**. So `drawScene`
  captured `drawAcidHaze`, `drawGluten`, … while they were still `undefined`
  (var-hoisted, unassigned). First frame → `drawAcidHaze(...)` →
  `TypeError: undefined is not a function`. Proven statically: transforming the
  file with `babel-preset-expo` (which auto-applies `react-native-worklets/plugin`)
  shows `const {drawAcidHaze,...} = this.__closure` in the emitted worklet and
  the factory capturing the forward refs. This explains **every** observed
  crash: both threads (worklet AND plain-JS `useMemo` builds crashed — the JS
  path also runs the transformed functions), and both Skia versions (2.6.2 and
  2.6.9 crashed identically — Skia was never at fault).
- **Fix (SHIPPED — device-verified July 6):** the JS-driven variant with ALL
  `'worklet'` directives removed — they were vestigial there. Verified by
  re-running the transform (0 `__closure`/`__workletHash`, `drawScene` stays a
  hoisted declaration), then **confirmed on the owner's phone: the full
  fermentation scene renders and animates** (screenshot in session). Merged
  into the shipping branch `claude/fold-notification-fixes-7j2l0y` (PR #8).
  Kept behind `SkiaErrorBoundary` (lazy-required) so any future regression
  shows its stack on-device instead of crashing the app.
- **Disproven theories (do not re-chase):** (1) "Skia 2.6.2's eval-based
  Symbol.dispose lookup breaks on the worklet runtime, fixed upstream in
  2.6.4/PR #3855" — a Skia **2.6.9** build crashed identically, and the
  JS-thread build crashed too, where that mechanism can't apply. (2) "Skia
  native module / New Architecture incompatibility" — Skia's native install and
  `createPicture` executed fine; the throw was always inside the app's own
  transformed draw callback.
- **UI-thread variant (parked on `claude/skia-ui-thread`):** likely fixable the
  same way — keep `'worklet'` directives (required there) but declare all
  helpers BEFORE their callers (leaf helpers first, `drawScene` last), so the
  factories capture initialized values. Untested; a future optimization once
  the shipped JS-driven scene is confirmed smooth enough. Its Skia-2.6.9 bump
  can also be reverted to Expo's pinned 2.6.2 — the version was never the issue.
- Rule this adds (also in CLAUDE.md spirit): with `'worklet'`-marked function
  declarations, **define before use** — the plugin breaks hoisting; and when a
  device stack shows the throw one frame inside your own callback, run the real
  Babel transform on the file and read the output before blaming libraries.

---

## TL;DR / current status (historical — superseded by RESOLVED above)

- The app was crashing on launch on Android with **"Something went wrong /
  Error: undefined is not a function"**, before any UI rendered.
- After a long (documented) misdiagnosis chain, the cause was isolated to
  **`@shopify/react-native-skia`**, used by `components/SkiaFermentationScene.tsx`,
  which renders on the timer screen (first screen shown).
- **Proof:** a build with Skia removed (and the animation swapped back to the
  pure-JS `components/FermentationScene.tsx`) **opens fine on the user's device.**
  A build that only neutralized the notification code still crashed. The last
  known-good production build (v1.1.0) had **no Skia dependency at all**.
- **Current shipping branch `claude/fold-notification-fixes-7j2l0y`** (commit
  `0b09ffc`) has Skia **removed** and all the fold-notification fixes + the
  Android alarm. It works. Do NOT regress that branch — do Skia work on a
  separate branch and only merge once it's proven on-device.

## What the crash was NOT (ruled out with evidence — don't re-investigate)

- **Not the fold-notification code.** A build that moved all notification setup
  off the startup path and wrapped every call in try/catch STILL crashed. See
  `docs/DEBUG-HANDOFF.md` for that whole (now-closed) investigation.
- **Not react-native-notify-kit / Notifee.** A build with ZERO native alarm
  modules crashed identically.
- **Not a dependency-version drift or lockfile issue.** `npm ci` uses the
  committed lock; the crash reproduced with the lock identical to `main`.

## The Skia setup as it existed (recover the code from git)

The deleted component is at **`git show 0bddefb:components/SkiaFermentationScene.tsx`**
(commit `0bddefb` is the last commit on the branch that still had it). To work on
it: `git checkout 0bddefb -- components/SkiaFermentationScene.tsx` onto a fresh
branch, then re-add the dependency and re-wire index.tsx (see "How Skia was wired"
below).

**Versions / environment (all current):**
- `expo` ~56.0.8, `react-native` 0.85.3, `react` 19.2.3
- `@shopify/react-native-skia` **2.6.2** (this is what Expo SDK 56 bundles —
  confirmed in `node_modules/expo/bundledNativeModules.json`; do not guess a
  different version)
- `react-native-reanimated` 4.3.1, `react-native-worklets` 0.8.3
- **New Architecture is mandatory** on SDK 56 / RN 0.85 (cannot be disabled).
  This is almost certainly central to the bug — Skia + New Arch + Fabric.

**How Skia was wired (what to reproduce):**
- `package.json`: `"@shopify/react-native-skia": "2.6.2"` in dependencies.
- No Skia config plugin in `app.json` (plugins were: expo-router,
  expo-notifications, react-native-notify-kit, expo-splash-screen). **Check
  whether Skia 2.6.2 on New Arch needs any config-plugin / prebuild step.**
- **There is NO `babel.config.js` in this repo.** Reanimated/worklets rely on a
  babel plugin (`react-native-worklets/plugin` for worklets 0.8.x, or via
  `babel-preset-expo`). The Skia component uses worklets (`useClock`,
  `useDerivedValue` from reanimated, feeding a Skia `<Canvas>`/`createPicture`).
  **Verify the worklets babel plugin is actually applied** — a missing/मis­ordered
  worklet plugin is a top suspect for a runtime "undefined is not a function" in
  worklet-driven Skia rendering. `metro.config.js` only wires NativeWind.
- The component imports from `@shopify/react-native-skia`: `Canvas, Picture,
  Group, Skia, createPicture, useClock, vec, BlendMode, PaintStyle, StrokeCap,
  BlurStyle, TileMode`, and uses `useDerivedValue` (reanimated) in 3 places to
  drive Skia props — i.e. it exercises the **reanimated↔Skia bridge**, the most
  fragile part on the New Architecture.
- It also depends on `model/doughState.ts` (`computeDoughState`, etc.) — pure
  JS, not a suspect, but needed for the component to compile.

**Call sites in `app/(tabs)/index.tsx`** (currently using `<FermentationScene>`;
Skia version used identical props):
```
<FermentationScene mode="autolyse" />
<FermentationScene mode="idle" />
<FermentationScene mode="bulk" fraction={sceneFraction} />
```
`SkiaFermentationScene` is a documented drop-in with the same `{mode, fraction}`
props, so swapping back is mechanical.

## Ranked hypotheses (investigate in this order)

1. **Reanimated worklets babel plugin not applied / misconfigured.** No
   `babel.config.js` exists. If `babel-preset-expo` (SDK 56) does not auto-inject
   the worklets plugin for reanimated 4 / worklets 0.8, then `useClock` /
   `useDerivedValue` worklets fail at runtime — a very plausible source of
   "undefined is not a function" the instant the Skia scene mounts. **Cheapest to
   check first**: add a proper `babel.config.js` with `babel-preset-expo` +
   `react-native-worklets/plugin` (order matters — worklets plugin last) and
   retest. Confirm against the installed reanimated 4.3.1 / worklets 0.8.3 docs.
2. **Skia 2.6.2 New-Architecture native init / Fabric incompatibility.** The Skia
   native view may fail to register under Fabric without extra setup. Check Shopify
   Skia's release notes/issues for RN 0.85 / New Arch / Expo SDK 56, and whether a
   specific 2.6.x patch or a `react-native.config.js`/prebuild step is required.
3. **Skia + Reanimated version mismatch on New Arch.** The reanimated↔Skia bridge
   (`useDerivedValue` into Skia) has version-coupling requirements. Verify 2.6.2 is
   compatible with reanimated 4.3.1 + worklets 0.8.3, or whether Skia's own
   animation hooks (`useClock`) should be used without reanimated.
4. **Something in the component's Skia API usage** (e.g., `createPicture` /
   `Skia.Shader.MakeRadialGradient` / `MaskFilter.MakeBlur`) being unavailable or
   renamed in 2.6.2. Lower priority — a bad API call usually throws on render with
   a clearer message, but worth a pass.

## The single biggest obstacle: no stack trace

On-device the ErrorBoundary shows only "undefined is not a function" — **no
component stack, no file/line.** Every diagnosis so far cost a ~20-min build.
Before iterating on fixes, INVEST in observability so each build teaches you the
exact failing call:
- Wrap ONLY the Skia scene in a dedicated error boundary that renders the caught
  `error.message` + `error.stack` + `componentStack` on screen (not the generic
  expo-router one). Then a crashing build shows you the real trace on the phone.
- Alternatively/additionally, capture `adb logcat` from the user's device during
  launch (guide the non-technical owner, or use a dev build) — the native/JS
  error with stack appears there even when the on-screen boundary is terse.
- Consider a temporary in-app debug screen that mounts `<SkiaFermentationScene>`
  behind a button, so a crash is contained to that screen instead of app launch.

## How to build & test (no local device/EAS/git creds here)

- Work on a NEW branch off `main` (or off `0b09ffc`); keep the working shipping
  branch clean.
- Build: trigger GitHub Actions workflow `eas-build.yml` via the GitHub MCP tool
  `actions_run_trigger` (method `run_workflow`, ref = your branch). It runs
  `eas build --platform android --profile preview` → an installable APK.
- Get the install URL from the job logs (`get_job_logs`, tail ~40): look for
  `https://expo.dev/accounts/donnf/projects/sourdough-timer/builds/<id>`. Each
  build has its own URL; Expo shows the build's START time in UTC (this confused
  the owner — 18:06 UTC displays as "12:06pm" for them in US Eastern).
- `npm ci` sometimes fails transiently with `ECONNRESET` (exit 152) — just re-run.
- **A green build ≠ a working app.** Both crashing builds compiled fine. Only a
  device launch counts. Do not tell the owner a fix works before they test it —
  that mistake was made repeatedly in the prior session.

## Constraints of this environment

- Cannot run an emulator/device or `require` the RN/Expo TS sources here.
- Static checks that DO work: `npx tsc --noEmit`; grepping
  `node_modules/@shopify/react-native-skia/**` for the real 2.6.2 export/API
  shapes; `node -e` on `node_modules/expo/bundledNativeModules.json`;
  `npx expo config --type prebuild --json` to validate config plugins.

## Acceptance criteria

1. On the owner's Android device, the app launches (no "undefined is not a
   function"), and the Skia fermentation animation renders on the timer screen in
   all three modes (autolyse / idle / bulk) with motion.
2. The fold-notification fixes and Android alarm from the shipping branch are
   preserved (don't lose them when merging Skia work).
3. Root cause written down here (replace the hypotheses section with the
   confirmed cause + the exact fix), so it can't recur.
4. If Skia genuinely can't be made to work on this stack yet, document why with
   evidence and keep the pure-JS `FermentationScene` as the shipping fallback.

## Pointers

- Working shipping branch: `claude/fold-notification-fixes-7j2l0y` @ `0b09ffc`
  (Skia removed, app works).
- Last commit WITH Skia: `0bddefb` (recover `SkiaFermentationScene.tsx` from here).
- Removal commit (what to study/undo): `0b09ffc`.
- Pure-JS fallback still in tree: `components/FermentationScene.tsx`.
- Prior (closed) crash investigation: `docs/DEBUG-HANDOFF.md`.
- Project norms / references: `CLAUDE.md`.
