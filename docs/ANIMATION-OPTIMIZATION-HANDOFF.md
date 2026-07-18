# Animation Optimization Handoff — next pass

Updated July 18 2026, when build #23 shipped. Audience: a fresh session
taking **the next optimization pass at animation smoothness**.

Read `docs/ANIMATION-SESSION-GUIDE.md` FIRST (architecture + hard
constraints — including the new "direct renderer & perf HUD" section), and
`docs/SKIA-HANDOFF.md` for the full failure history. This file only adds:
where the optimization work stands, and ranked directions for the next pass.

---

## Where things stand

Owner device: **Pixel 9 (120Hz)**. Complaint history and what each build fixed:

| Build | Commit | Owner verdict / change |
|-------|--------|------------------------|
| #19 | `5a43e27` | Native counter-scroll world-anchoring — scroll alignment SOLVED, but "choppy later in bulk" |
| #20 | `928f4fa` | Staggered pane slots + progress-widening period → "improved" but "scrolling is jerky even pre-bulk" |
| #21 | `9568f1f` | Blur clipped to visible slice + scroll-time refresh halving + BASE_PERIOD 3→4 → "improved significantly", card edges confirmed good, but "still some jerkiness, even when not scrolling, especially later in bulk" |
| #22 | `27998f4` | glowOrb unit-gradient shader cache; drift/flow scratch outputs; slow/fast layer split (slow cast @30fps, @20fps late bulk; bubbles @60fps). Verdict: **"better than before, but still could be smoother, especially later in animation."** |
| #23 | (this pass) | Direct renderer (React/scene-graph/runOnUI bypass — see guide; pixel-identical, default ON, `draw` chip falls back); perf HUD + owner A/B chips; gradient-disc glow substitution (`glow` chip, default mask); 75% backing-resolution option (`res` chip, default 100%); sub-visible-alpha culling (`cull` chip, default off); grain-constants precompute + gluten live-node pool (pixel-identical). **Owner verdict pending.** |

The #23 discovery worth knowing: on this Skia (2.6.2) + reanimated combo,
EVERY declarative `<Canvas>` commit rebuilds a `ReanimatedRecorder`,
re-visits the scene graph, and dispatches a `runOnUI` worklet that re-plays
the recorder into a second picture (`sksg/Container.native.js`). The scene
was paying that + a React render/commit/effect pass 60×/s. The direct
renderer replaces all of it with two JSI calls. The glass panes still pay it
per refresh (~10/s each, staggered) — see direction 2 below.

### Build & delivery loop

- Trigger: GitHub MCP `actions_run_trigger` → workflow `local-android-build.yml`
  on the session's designated branch. Takes ~30-35 min.
- Artifact link format to post to the owner:
  `https://github.com/donnnnnnnn/Sourdough-timer/actions/runs/<RUN_ID>/artifacts/<ARTIFACT_ID>`
- The owner sideloads and reports by feel (plus screenshots). Each build
  cycle costs them real time — bundle changes, don't drip them.
- `npx tsc --noEmit` before every commit.

### The moving parts (all perf-relevant code)

| File | Role |
|------|------|
| `components/SkiaFermentationScene.tsx` | 60fps JS clock → records organism SkPicture (slow/fast split), publishes via glassStage |
| `components/GlassBackdrop.tsx` | Per-card pane: scene-sized canvas, native counter-scroll, band-clipped declarative blur, staggered refresh |
| `components/glassStage.ts` | Module pub/sub bridge: picture channel, scroll state, `isScrollActive()`, pane slots |
| `components/GlassCard.tsx` | RN wrapper, measurement, lazy require |
| `app/(tabs)/index.tsx` | Scroll wiring (native Animated.event), ~9-10 GlassCards mounted per screen |

---

## Hard constraints (violating any of these cost days — see the guide)

1. **No `'worklet'` directives** anywhere in the scene file.
2. **JS-thread clock only** — no `useClock`/`useDerivedValue` on current deps.
3. **No blur inside a recorded SkPicture**; declarative `<Group layer>` only.
4. **No JS-driven pane positioning** — native counter-scroll is settled.
5. **Owner's explicit product constraints:** don't shrink the scene, don't
   sacrifice visuals, don't pause the animation during scroll. (Slowing the
   *frost content* refresh during scroll was accepted; pausing the main
   scene was rejected.)
6. Tuner (`tools/frosted-glass-tuner.html`) parity: `TUNER_BLUR_SCALE` and
   panel inventory must stay in sync with the app.
7. Update `docs/ANIMATION-SESSION-GUIDE.md` when you learn something or
   change a perf-relevant mechanism.

---

## What build #23 already did (from the previous ranked list)

- ~~0. Evidence before surgery~~ → **perf HUD shipped** (guide § "The direct
  renderer & perf HUD"). The owner can now screenshot fps/worst/late/hitch/
  js-work/GC and A/B every experiment live. adb commands below stay useful
  for render-thread (GPU) truth.
- ~~1. Bypass React for the per-frame redraw~~ → **done for the SCENE**
  (`renderer: 'direct'`, default). Panes NOT done — see direction 2.
- ~~2. MaskFilter glows~~ → **shipped behind the `glow` chip** (default
  mask). Rings/strands keep MaskFilter (no cheap closed form for a blurred
  annulus).
- ~~3. Reduced backing resolution~~ → **shipped behind the `res` chip**
  (default 100%).
- ~~4. Invisible-detail culling~~ → **shipped behind the `cull` chip**
  (default off; ~1.2% alpha floor ≈ ≤3/255 per draw).
- ~~5. Stragglers~~ → grain constants precomputed (killed a per-cell
  per-frame RNG closure), gluten live-node pool. The per-frame path now
  allocates only the 1-2 `createPicture` closures + the picture objects
  themselves.

## Next-pass workflow (owner in the loop)

1. Get the owner's verdict on #23 defaults (= #22 pixels, new plumbing).
2. Have them try the chips ONE AT A TIME (glow → res → cull), noting for
   each: smoother? look acceptable? HUD numbers before/after (screenshots).
3. Read the evidence:
   - HUD clean (fps ~60, no hitches) but eye sees jank → GPU-bound → the
     `glow`/`res` chips are exactly the levers; if they fix it, promote the
     accepted setting to the default in `perfFlags.ts` DEFAULTS.
   - `worst` spikes, `js work` low, `gc` ticking → allocation/GC → direction
     3 (picture disposal).
   - `js work` high late bulk → recording cost → widen the slow-layer
     cadence further (slowEvery 3→4 at progress ≥0.75), or split the slow
     cast into two staggered sub-pictures.
   - Jank ONLY while scrolling → pane-side → direction 2.
4. Whatever the owner accepts becomes the new default; drop the losing
   branch of each A/B in a cleanup commit (keep the HUD).

## Ranked directions for the next pass

### 1. Promote winning A/B settings to defaults (trivial, do first)

One-line changes in `components/perfFlags.ts` DEFAULTS once the owner has
picked. Delete no code yet — the chips stay until two consecutive builds
without regressions.

### 2. Pane-side React/recorder bypass (JS thread, medium risk)

Each GlassBackdrop refresh is still a React render + scene-graph re-visit +
`ReanimatedRecorder` rebuild + `runOnUI` dispatch (~9 panes × ~10/s ≈ 90/s
aggregate — now MORE machinery per second than the scene itself pays).
The pane's blur must stay declarative (constraint 3), so the fix is
different from the scene's: pass the changing values as reanimated
**SharedValues** (`picture`, and the clip rect) instead of plain props.
With shared values, `Container.native.js` registers a persistent mapper
ONCE and per-update only runs `applyUpdates + replay` on the UI thread — no
React, no SG visit, no recorder rebuild. Our files stay worklet-free
(setting `sv.value` from JS is plain code; the worklets live inside the
library and ALREADY run per refresh today via `runOnUI`). Risks: SharedValue
props are the reanimated↔Skia bridge the guide warns about — prototype on
one pane first, keep the current path behind a flag exactly like
`renderer`, and note that `useSharedValue` import in GlassBackdrop must not
break web (GlassCard already skips panes on web).

### 3. Explicit SkPicture disposal (only if HUD shows GC pressure)

Pictures churn at ~1-2/frame and are GC-reclaimed. If the HUD's gc counter
correlates with hitches: `.dispose()` the PREVIOUS published picture once no
pane can still replay it — needs a small ref-count/generation in glassStage
(panes hold the current picture; naive disposal = use-after-free crash).
Also dispose the previous slow sub-picture on rebuild (only the published
wrapper references it, and only until the next publish). Don't do this
speculatively.

### 4. Opaque scene surface (GPU, one-line experiment, needs on-device proof)

`SkiaPictureView` accepts `opaque`. The scene surface currently composites
with alpha over a black RN view — a full-screen blend the compositor pays
every frame for nothing (the scene background is opaque black anyway).
`opaque` on Android switches the surface mode; given this device's history
of surface-stacking surprises (BackdropBlur rendering above the app's UI),
treat it as an experiment: behind a perfFlags chip, owner confirms the glass
cards still render above the scene and nothing z-fights.

### 5. Dependency upgrade (riskiest, isolate completely)

Newer `@shopify/react-native-skia` (+ possibly reanimated/worklets) may fix
the UI-thread path outright — the parked `claude/skia-ui-thread` branch
would then eliminate JS-thread contention entirely. History says this combo
is fragile; isolate in a throwaway branch + separate build.

### Already tried — do NOT re-attempt

Everything in the guide's constraint list, plus: 30fps clock gate (visible
double-judder on 120Hz), synchronized pane refresh, JS-live/frozen pane
offsets, per-pane organism redraw, blur in recorded pictures, backdrop
filters, offscreen-surface snapshot blur.

## adb evidence commands (owner copy-paste, optional but gold for GPU truth)

The HUD sees the JS thread; `gfxinfo` sees the render thread. With the phone
plugged in and USB debugging on (Settings → Developer options):

```
adb shell dumpsys gfxinfo com.anonymous.sourdoughtimer reset
```
…then look at the timer screen for ~30 seconds (ideally with `sim` set to
`bulk 97%`), then:
```
adb shell dumpsys gfxinfo com.anonymous.sourdoughtimer
```
Paste back the block from "Stats since" through the "HISTOGRAM" line —
the useful numbers are `Janky frames`, and the `90th`/`95th`/`99th`
percentile frame times. >16ms percentiles with a clean HUD = GPU-bound.
```
adb logcat -v time | grep -iE "hermes.*gc|gc.*pause"
```
…while watching the screen correlates visible hitches with GC events
(Ctrl-C to stop). If nothing prints in 60s, GC logging isn't exposed on
this build — rely on the HUD's gc counter instead.
