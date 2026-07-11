# ANIMATION ENRICHMENT HANDOFF — make the fermentation scene more complex & lifelike

**Goal:** now that the Skia fermentation animation renders reliably on-device,
make it richer, more organic, and more alive — while keeping it correct to the
fermentation science and never regressing the stability that was so hard-won.

**Owner is non-technical.** Explain visual/design choices in plain language;
prove motion/look changes with on-device screenshots or screen recordings, not
"it should look better."

---

## Start here — current state (all working, device-verified July 2026)

- **File:** `components/SkiaFermentationScene.tsx` (~570 lines). Renders a
  "confocal-microscopy" scene: luminous translucent organisms glowing on pure
  black, additive-blended (`BlendMode.Plus`). Props: `{ mode: 'autolyse' |
  'idle' | 'bulk', fraction?: number }`.
- **It is GPU Skia and it WORKS.** Do not rearchitect it. Rendered + animating
  on the owner's Android phone.
- **Rendered via `SafeSkiaFermentationScene`** (`components/SkiaErrorBoundary.tsx`)
  — an error boundary + lazy require, wired into `app/(tabs)/index.tsx` at three
  call sites (autolyse / idle / bulk). Keep using that wrapper.
- **Cast today (10 draw functions):** acid haze, gluten mesh, amylase rings,
  protease lobes, LAB rod-chains, yeast (with budding), acetic flecks, CO₂
  bubbles. Each is a pure function `draw*(canvas, st, W, H, time)`.
- **Driven by** `model/doughState.ts` → `computeDoughState(progress, inputs,
  folds)` returning `st` with: `fermentation, gasVolume, glutenStrength,
  glutenDamage, acidity, microbeActivity, sugarAvail, wallIntegrity` (all 0..1)
  plus `stageName/stageDesc`. The scene only CONSUMES these — it must never
  re-derive fermentation science (that lives in doughState.ts + the books in
  `docs/references/`; see CLAUDE.md).
- **Clock:** JS-thread `requestAnimationFrame` throttled to ~30fps →
  `timeSec` → `createPicture` in `useMemo`. `st` is memoised separately so only
  the picture rebuilds per frame, not the dough math.

## 🚫 HARD CONSTRAINTS — violating any of these reverts weeks of debugging

1. **NEVER add `'worklet'` directives to the draw functions.** That is exactly
   what crashed the app for a full day: the worklets Babel plugin rewrites a
   `'worklet'`-marked `function foo(){}` into a var-assigned factory that
   captures its dependencies AT THE DECLARATION SITE, which breaks JS function
   hoisting — `drawScene` (declared first) captured its helpers while still
   `undefined`. Full writeup: `docs/SKIA-HANDOFF.md`. Keep the draw functions
   plain. If you ever move to UI-thread rendering, see that doc's parked
   `claude/skia-ui-thread` notes — but that is NOT this task.
2. **Do not bump `@shopify/react-native-skia`** (pinned 2.6.2, excluded from
   `expo install` sync in package.json). The version was never the problem; a
   bump reintroduces engine-drift risk for zero benefit here.
3. **Keep it on the JS-thread rAF clock.** At ~30fps it's smooth for this
   ambient motion. If you add enough primitives to drop frames, optimize draw
   cost (see Performance below) — do NOT reach for worklets to compensate.
4. **Keep `SafeSkiaFermentationScene` wrapping it** so any new drawing bug shows
   a stack on-device instead of crashing the app. Test WITH the boundary.
5. **Don't touch the fermentation model** (`model/doughState.ts`, `lib/bulkCoach.ts`)
   to serve the visuals. If you need a new signal, derive it inside the scene
   from existing `st` fields, or raise it for a separate science-reviewed change.

## The design source of truth (already written, mostly unimplemented)

`docs/fermentation-art-spec.md` is a full art brief with a **locked palette**
(match it exactly) and storyboards that the current scene only partially
realizes. This is your richest backlog — implement from it rather than inventing:
- **SHEET A — alternative poses** so the population doesn't look cloned: yeast
  budding/life-stage series, LAB fission/chain series, amylase/protease/acetic
  variants. (Today organisms are largely single-pose + jitter.)
- **SHEET B — interaction storyboards:** cross-feeding (amylase→microbes),
  yeast budding + CO₂, LAB fission + acidification, **protease attacks gluten**
  (the key antagonist beat), acidity activates protease.
- **SHEET C — gluten network lifecycle:** organizing → strengthening → stressed
  → degraded/collapsed, driven by `glutenStrength`/`glutenDamage`.

## Concrete ideas for "more complex & lifelike" (pick, sequence, show the owner)

Lifelike motion (cheap, high impact):
- Vary per-organism phase/speed/scale more (less uniform drift); add subtle
  easing and secondary motion (a cell drifts AND slowly rotates AND breathes at
  different periods). Use deterministic per-index seeds so it's frame-stable.
- Budding as a real life-cycle: a daughter cell swells, pinches off, drifts
  away — timed off `microbeActivity` and `time`, not random per frame.
- CO₂ bubbles with varied size/wobble/rise-speed and occasional coalescence;
  more bubbles as `gasVolume` climbs.
- Flow field / very slow current so the whole population drifts cohesively
  instead of each dot doing its own thing.
- Twinkle/opacity shimmer on glows so specimens feel alive under the "scope".
Complexity that tells the fermentation story (ties visuals to state):
- Make the gluten mesh visibly organize then fray as `glutenDamage` rises
  (Sheet C) — this is the most legible "the dough is changing" beat.
- Protease lobes visibly nibbling gluten strands when `acidity` is high (B4/B5).
- Density/among-species balance shifting across the bulk: yeast-led early,
  LAB/acetic rising late.
- Per-`mode` distinct feels: autolyse = calm/sparse, bulk = building activity
  scaled by `fraction`, idle = gentle ambient.

## Performance (so richer ≠ jankier)

- Every draw call is CPU work rebuilding the SkPicture each frame. Budget it.
- Precompute per-organism constants (positions, seeds, palette colors) in
  `useMemo` keyed on `st`/size — NOT per frame inside the draw loop.
- Reuse `Skia.Paint()`/shader objects where possible instead of allocating per
  primitive per frame.
- If frames drop on a mid-range Android, reduce organism counts at high
  densities or drop to 24fps before touching the architecture.
- Measure honestly on a real device (screen-record, watch for stutter); a green
  build proves nothing about smoothness.

## How to work / build / test

- **Branch:** start from `claude/fold-notification-fixes-7j2l0y` (has the
  working scene + everything merged) OR from `main` once PR #8 is merged. Do
  enrichment on a NEW branch, e.g. `claude/animation-enrichment`.
- **Type-check:** `npx tsc --noEmit`.
- **Static sanity for the worklet trap:** after editing the scene, run the app's
  Babel transform and confirm no worklet machinery crept in:
  `node -e "const b=require('./node_modules/@babel/core'); b.transformAsync(require('fs').readFileSync('components/SkiaFermentationScene.tsx','utf8'),{filename:process.cwd()+'/components/SkiaFermentationScene.tsx',presets:[require.resolve('./node_modules/babel-preset-expo')],caller:{name:'metro',platform:'android',engine:'hermes'}}).then(r=>console.log('__closure:',(r.code.match(/__closure/g)||[]).length,'| drawScene hoisted:',/function drawScene\(/.test(r.code)))"`
  Expect `__closure: 0 | drawScene hoisted: true`.
- **Build (native, required — this env has no device/EAS creds):** trigger the
  GitHub Actions workflow `eas-build.yml` via the GitHub MCP tool
  `actions_run_trigger` (method `run_workflow`, ref = your branch). Get the
  install URL from the job logs (`get_job_logs`, tail ~30):
  `https://expo.dev/accounts/donnf/projects/sourdough-timer/builds/<id>`.
  ~20 min/build; `npm ci` sometimes fails transient ECONNRESET (exit 152) → just
  re-run. Expo shows the build's START time in UTC (owner is US Eastern).
- **Iterate visibly:** this is visual work — after each meaningful change, get a
  build to the owner for a look, or capture the intent in a quick web/CanvasKit
  sketch first. Don't batch 10 changes into one blind build.

## Acceptance

1. Noticeably richer/more organic motion and more of the art-spec cast/poses,
   confirmed on the owner's device (screenshot or recording).
2. Still launches cleanly, still smooth (no new jank), still behind the error
   boundary, still driven only by `doughState.ts`.
3. No `'worklet'` directives, no Skia version bump, no fermentation-model edits.
4. Update `docs/fermentation-art-spec.md` checkboxes / this doc as poses land.

## Pointers

- Scene: `components/SkiaFermentationScene.tsx`
- Safety wrapper: `components/SkiaErrorBoundary.tsx`
- Wiring: `app/(tabs)/index.tsx` (3 `<SafeSkiaFermentationScene>` sites)
- State engine (consume, don't edit): `model/doughState.ts`
- Art brief: `docs/fermentation-art-spec.md`
- Why the worklet rule exists: `docs/SKIA-HANDOFF.md`
- Project norms: `CLAUDE.md`
