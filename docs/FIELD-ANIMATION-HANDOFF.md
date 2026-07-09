# FIELD ANIMATION — Fable planning handoff

**This is a technical / graphics-engineering task, not a domain task.** It is about
getting a GPU-accelerated particle animation (`@shopify/react-native-skia`) to run
full-screen behind a translucent, frosted-glass UI on Android, and fixing a runtime
crash in the Skia ↔ reanimated bridge. Treat every element name below as an abstract
visual primitive (a mote, a ring, a filament) — there is no science to reason about
here, only pixels, shaders, worklets, and native build config.

**Audience:** a Fable session that will author the detailed implementation plan and
delegate tasks to agents. Model-routing guidance is in the last section.

**Owner is non-technical.** Every claim to the owner must be backed by evidence
(build logs, a screenshot, an on-device test), never "it should work." Two previous
sessions told the owner a fix worked before it was tested on-device; both were wrong.

---

## 1. Goal (what "done" looks like)

1. The Skia particle animation ("the Field") runs **full-screen as the app
   background**, fully visible in the gaps between UI panels, animating continuously.
2. The vector-shape fallback (`components/FermentationScene.tsx`) is **retired** once
   Skia is proven on-device — the Field replaces it, and we keep iterating on the
   detailed Skia art, not the simple shapes.
3. **Panels and buttons are translucent frosted glass**: each one blurs and tints the
   animated Field behind it, with **blur radius and tint opacity controllable
   per-panel**. Text and icons on top stay fully legible.
4. The app **launches without crashing** on the owner's Android device (the original
   bug was "Something went wrong / undefined is not a function" before any UI drew).

---

## 2. Corrected diagnosis — read this before planning anything

The previous session concluded **"Skia is fundamentally incompatible with this stack;
native compilation fails."** That conclusion is **wrong and must not be inherited.**
Here is the evidence that overturns it:

### 2a. The EAS build "failures" were a billing quota wall, not compilation
Every EAS build in the prior session failed in **~10 seconds**, at the `eas build`
step, with this in the log (run 29027291059, verified 2026-07-09):

> `This account has used its Android builds from the Free plan this month, which will
> reset in 22 days (on Sat Aug 01 2026).` → `Error: build command failed.`

That is EAS refusing to **start** a cloud build. Nothing was ever compiled. The prior
session read these 10-second quota rejections as "native compilation failures." They
are not. **EAS cloud builds are unavailable until ~Aug 1 2026** — plan all device
testing through the local Gradle workflow (see §5).

### 2b. The one real build (local Gradle) was abandoned mid-compile, logs now gone
`local-android-build.yml` (run 29028113367) ran a genuine Gradle `assembleDebug` for
**~29 minutes** (15:06→15:35) and then failed — but the prior session stopped watching
while it was still `in_progress` and never read the error. Its logs are now past
retention (HTTP 404). So the actual Gradle error is **unknown**, not "incompatible."
Re-running with logs captured (§5) is task #1.

### 2c. The "missing worklets babel plugin" hypothesis is false
The old handoff's #1 suspect was a missing `react-native-worklets/plugin`.
`babel-preset-expo@56.0.15` **auto-injects it when the package is installed**
(verified in `node_modules/babel-preset-expo/build/configs/expo.js`, lines 109-113):

```js
// Automatically add worklets or reanimated plugin when package is installed.
if (options.worklets !== false && options.reanimated !== false) {
    const workletsPluginPath = resolveModule(api, 'react-native-worklets/plugin');
    if (workletsPluginPath) { plugins.push([require(workletsPluginPath)]); }
}
```

`react-native-worklets@0.8.3` is a dependency, so the plugin is always applied.
**Do not add a `babel.config.js`** — and specifically do NOT add both
`react-native-reanimated/plugin` and `react-native-worklets/plugin` (that double-
registers the worklet transform and is its own bug). The prior session did this; it
was a dead end.

### 2d. The Skia API surface is intact in 2.6.2
Every Skia call the component makes — `Skia.Shader.MakeRadialGradient`,
`Skia.MaskFilter.MakeBlur`, `Skia.Path.Make`, `Skia.Paint`, `Skia.Color`,
`createPicture`, `useClock`, `BlurStyle`, `TileMode`, `PaintStyle`, `StrokeCap`,
`BlendMode` — exists in the installed 2.6.2 type definitions. "Renamed API" is ruled
out.

### 2e. The actual prime suspect for the runtime crash
The original crash was a **runtime** "undefined is not a function" on a build that
**did compile and install** (prior-prior sessions built installable APKs that then
crashed at launch). With the babel plugin present (2c) and the API surface intact
(2d), the remaining suspect is the **reanimated ↔ Skia cross-runtime bridge**, at
`components/SkiaFermentationScene.tsx` line ~536:

```ts
const clock = useClock();                       // Skia's runtime
const picture = useDerivedValue(() => {         // reanimated 4's worklet runtime
  return createPicture((canvas) => { ... });    // Skia imperative draw
});
// <Picture picture={picture} />
```

This mixes **reanimated 4.3.1 / worklets 0.8.3** (`useDerivedValue`) with **Skia
2.6.2** (`useClock`, `createPicture`) across two worklet runtimes. On the New
Architecture / Fabric this is the single most fragile point, and a version-coupled
mismatch here throws exactly "undefined is not a function" the instant the animated
`<Picture>` mounts — which is the first screen, hence crash-before-UI.

---

## 3. Proposed fixes (for Fable to turn into a plan)

**Step 0 — Observability first (cheap, one build, do before any fix).**
- Wrap only the Skia canvas in a dedicated error boundary that renders
  `error.message` + `error.stack` + `componentStack` **on screen** (not the generic
  expo-router boundary).
- Add a `DEBUG_FILL` flag that draws a solid high-contrast `<Fill color="magenta"/>`
  inside the `<Canvas>`. One on-device build then distinguishes **"canvas never
  mounts"** (native Skia/Fabric init problem) from **"canvas mounts, animated Picture
  worklet throws"** (the bridge problem in 2e). This is the observability the prior
  sessions never invested in, and every blind build cost ~29 min.

**Fix A — Remove the cross-runtime bridge (most likely root cause, recommended).**
Drive all motion on **Skia's own runtime**: keep `useClock()` but build the picture
with Skia's reactive/derived values instead of reanimated's `useDerivedValue`. This
deletes the reanimated↔Skia boundary entirely. It is also the most robust foundation
for a full-screen backdrop that must never crash the app.

**Fix B — Align the Skia + reanimated + worklets versions.**
If the bridge stays, confirm Skia 2.6.2's `external/reanimated` integration targets
reanimated 4.3.1 / worklets 0.8.3. Static check: grep
`node_modules/@shopify/react-native-skia/**/reanimated*` for the worklets API names
it calls, diff against what `react-native-worklets@0.8.3` exports; a missing symbol
there is the crash. Resolve by moving to the Skia patch that officially supports
reanimated 4, or aligning the trio.

**Fix C — Skia-only render (fallback / foundation).**
Render the whole Field with zero reanimated dependency. Most defensive; also the right
architecture for a persistent background layer.

---

## 4. The architecture the owner actually wants (the real deliverable)

This is more than a crash fix — it is a re-layering of the app:

1. **Full-screen Field backdrop.** Move the Skia `<Canvas>` to a fixed, full-bleed
   background layer behind the entire app (root layout / a `<FieldBackdrop>` mounted
   in `app/_layout.tsx`), driven by a single `intensity` prop (0..1) derived from the
   timer state. It shows through every gap in the UI.
2. **Translucent UI on top.** Panels and buttons become semi-transparent views
   layered over the backdrop.
3. **Per-panel frosted glass.** Two viable techniques — Fable should pick one and
   justify it:
   - **Skia `<BackdropFilter>` + `<Blur>`** clipped to each panel's rounded rect.
     True per-panel blur of the animated backdrop, one rendering system, exact control
     of blur radius + tint. Preferred for "one coherent system."
   - **`expo-blur` `<BlurView intensity tint>`** per panel. Simpler, but blurs
     everything behind it (including sibling panels) and is less controllable.
   Either way the public API is a `<GlassPanel blur={number} tint={rgbaOrOpacity}>`
   wrapper so blur + opacity are set per panel.
4. **Legibility.** Text/icons sit above the blur+tint layer; enforce a minimum tint
   opacity / contrast so copy stays readable over a bright moving backdrop.

### ⚠️ Open item: "the tool we made" for per-panel blur/opacity
The owner referenced a tool they built for per-panel transparency + blur control (the
old handoff mentioned a `components/glassStage.ts` with a never-called
`setContentTop()`). **It does not exist in this repo or anywhere in its git history**
(searched all branches + all commits). Either it is unpushed on the owner's machine,
or it lives in another repo, or it needs to be built fresh. **Fable's plan must
resolve this first** — ask the owner to locate/push it, or scope building
`<GlassPanel>` from scratch. Do not assume it exists.

---

## 5. Build & test reality (this environment)

- **EAS cloud builds are OUT until ~Aug 1 2026** (free-tier quota, §2a). Do not burn
  turns triggering `eas-build.yml` — it fails in 10s every time.
- **Use `local-android-build.yml`** (Gradle `assembleDebug` on the GitHub runner) for
  every device build. It bypasses EAS. Trigger via the GitHub Actions API
  (`actions_run_trigger`, `run_workflow`, ref = the Skia branch). A run takes
  **~25-30 min**; wait for `completed`, do not judge it while `in_progress`.
- **Harden that workflow before relying on it** (task #1):
  - Run Gradle with `--stacktrace --info` and **upload the full log as an artifact
    even on failure** (`if: always()`), so an error is never lost to retention again.
  - Give Gradle adequate memory (`org.gradle.jvmargs=-Xmx4g` or more) — a 29-min
    failure with no log is consistent with an OOM during Skia's native C++ compile on
    the runner. Consider limiting to a single ABI (`arm64-v8a`) to cut compile time
    and memory.
- **A green build ≠ a working app.** Both original crashing builds compiled fine. Only
  an on-device launch by the owner counts as proof.
- Static checks that DO work here: `npx tsc --noEmit`; grepping
  `node_modules/@shopify/react-native-skia/**` for real 2.6.2 API shapes; reading
  `node_modules/babel-preset-expo/build/configs/expo.js`.

---

## 6. Neutral vocabulary (rename the biology out — task for the first agent)

The restored component `components/SkiaFermentationScene.tsx` uses domain names that
mislead tooling into treating this as a science task. **Rename everything to the
abstract visual vocabulary below**, in the component, its props, and the driving model
it imports. Keep this animation framed as a pure generative **particle field**.

| Legacy name (remove)        | Neutral name (use)          | What it is visually            |
|-----------------------------|-----------------------------|--------------------------------|
| `SkiaFermentationScene`     | `FieldScene` / `SkiaField`  | the whole animated canvas      |
| yeast                       | **mote**                    | amber glowing orb              |
| LAB / rod-chain / bacteria  | **filament**                | violet linked chain            |
| amylase                     | **ring**                    | teal ring/halo                 |
| protease                    | **lobe**                    | coral soft blob                |
| acetic                      | **fleck**                   | chartreuse speck               |
| CO₂ bubble                  | **bubble**                  | rising translucent bubble      |
| acid haze                   | **haze**                    | soft fog wash                  |
| gluten / lattice            | **lattice** / **mesh**      | amber connective web           |
| dough / fermentation state  | **field state**             | the computed driver struct     |
| fraction / fermentation     | **intensity** (0..1)        | master progress input          |
| microbeActivity             | **activity**                | scalar 0..1                    |
| gasVolume                   | **volume**                  | scalar 0..1                    |
| glutenStrength / Damage     | **meshStrength / meshWear** | scalars 0..1                   |
| acidity                     | **density**                 | scalar 0..1                    |
| sugarAvail                  | **fuel**                    | scalar 0..1                    |
| modes: autolyse / bulk      | **warmup / active** (idle stays) | animation intensity presets |

The driver currently lives in `model/doughState.ts` (pure math, no rendering). Rename
its exported symbols to the neutral scalars above (or wrap it behind a neutral
`fieldState.ts` adapter) so no rendering code imports biology terms. The math itself is
just easing curves over `intensity` — treat it as animation parameters, nothing more.

---

## 7. Suggested model routing (for the Fable-authored plan)

- **Fable 5 (`claude-fable-5`)** — owns this: authors the implementation plan,
  sequences the work, sets the animation art direction, and decides the frosted-glass
  technique (§4.3). The orchestrator.
- **Opus 4.8 (`claude-opus-4-8`)** — the hard reasoning tasks, one at a time:
  root-causing the reanimated↔Skia crash from the Step-0 on-device evidence; designing
  the full-screen backdrop layering and the `<GlassPanel>` / `<BackdropFilter>`
  architecture; the native/Gradle build hardening. Do not hand these to a small model
  — the prior session's small-model debugging produced a confidently wrong "give up"
  conclusion (§2), which is the cautionary example for this routing.
- **Sonnet 5 (`claude-sonnet-5`)** — the bulk, well-specified implementation:
  building `<GlassPanel>`, wiring `<FieldBackdrop>` into the root layout, converting
  remaining vector shapes to Skia primitives, and the CI workflow edits from §5.
- **Haiku 4.5 (`claude-haiku-4-5`)** — cheap mechanical only: the §6 rename sweep,
  prop plumbing, doc updates, regenerating icon/asset variants. **Not debugging.**

---

## 8. Pointers

- Skia component restored on this branch: `components/SkiaFermentationScene.tsx`
  (still uses legacy biology names — §6 renames it). Also recoverable from commit
  `0bddefb`.
- Pure-JS fallback (currently the wired, shipping default): `components/FermentationScene.tsx`.
- Driver math: `model/doughState.ts`.
- Timer screen / call sites: `app/(tabs)/index.tsx` (3× `<FermentationScene>` today).
- Build workflows: `.github/workflows/local-android-build.yml` (USE THIS),
  `.github/workflows/eas-build.yml` (dead until ~Aug 1).
- Superseded, do-not-trust conclusion: the "Investigation Results" table in
  `docs/SKIA-HANDOFF.md` (kept for history; §2 here corrects it).
