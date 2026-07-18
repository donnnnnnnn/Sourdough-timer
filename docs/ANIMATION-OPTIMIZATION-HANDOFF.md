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
| #23 | (prev pass) | Direct renderer (React/scene-graph/runOnUI bypass — see guide; pixel-identical, default ON, `draw` chip falls back); perf HUD + owner A/B chips; gradient-disc glow substitution (`glow` chip, default mask); 75% backing-resolution option (`res` chip, default 100%); sub-visible-alpha culling (`cull` chip, default off); grain-constants precompute + gluten live-node pool (pixel-identical). **Owner verdict: "draw direct is smoother, glow mask looks better, res 100 vs 75 no noticeable difference, cull on doesn't change visually."** |
| #24 | (prev pass) | Merged design-modernization UI overhaul (Fraunces font, AppText, DoughButton, Chip, etc.). A/B evidence collected (HUD screenshots, sim:bulk 85%). Promoted `cull: true` as default. See evidence table below. |
| #25 | (this pass) | Opaque scene surface experiment (`opaque` chip) — **FAILED**: toggling opaque off corrupts the native surface (sprites disappear, can't recover without restart). Pane-side SharedValue bypass (`pane` chip) — **FAILED**: crashes on tap; Skia 2.6.2 declarative components don't support SharedValues for `picture`/`clip` props at runtime. Both reverted in build #25a. |

### Build #24 A/B evidence (Pixel 9, sim:bulk 85%, HUD screenshots)

| Setting | fps | worst (ms) | late | hitch | js-work avg (ms) | js-work max (ms) |
|---------|-----|-----------|------|-------|-------------------|-------------------|
| draw:direct, cull:on, glow:mask, res:100% | 33–35 | 58.6 | 3–5 | 1–2 | 3.68 | 15.3 |
| draw:direct, cull:off, glow:mask, res:100% | 31 | 76.2 | 5 | 2 | 5.25 | 22.2 |
| draw:direct, cull:on, glow:grad, res:100% | 29 | 62.7 | 5 | 2 | 4.12 | 16.8 |
| draw:direct, cull:on, glow:mask, res:75% | 29 | 81.5 | 6 | 2 | 3.91 | 17.1 |
| draw:react, cull:off, glow:mask, res:100% | 17 | 115.7 | 11 | 5 | — | — |

**Conclusions:**
- **draw:direct** is the clear winner (2× fps over react path).
- **cull:on** provides a measurable improvement (+4 fps, −18ms worst, −1.6ms avg JS work) with no visible change per owner.
- **glow:grad** does NOT help — same or worse fps, and owner prefers mask's look.
- **res:75%** does NOT help — possibly compositor upscale cost offsets GPU fill savings.
- **Bottleneck**: JS work avg is only 3–5ms within a 16.7ms budget, yet fps is 29–35. The remaining gap is likely GPU-bound (render thread compositing scene + 9–10 glass panes with blur). GPU profiling (adb gfxinfo) would confirm; owner's machine lacks adb.

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

**Steps 1–4 completed in build #24.** Evidence collected, defaults promoted.

Current situation: fps is 29–35 at bulk 85% on Pixel 9 (120Hz), well below
the 60fps target. JS work is low (3–5ms avg), so the bottleneck is almost
certainly GPU-bound — the render thread is spending too long compositing the
full-resolution scene + 9–10 glass panes with MaskFilter blur.

**Build #25 tried directions #2 and #4 — both failed on-device.**
See failure details under each direction below. Build #25a reverts both.

## Ranked directions for the next pass

### ~~1. Promote winning A/B settings to defaults~~ ✓ DONE (build #24)

`cull: true` promoted. `glow: 'mask'`, `resScale: 1`, `renderer: 'direct'`
confirmed as correct defaults. Chips stay for future experiments.

### ~~2. Pane-side React/recorder bypass~~ ✗ FAILED (build #25)

**Crashed on-device.** Passing reanimated SharedValues as `picture` and
`clip` props to Skia's declarative `<Picture>` and `<Group>` components
compiled (with `as any` casts) but crashed at runtime — Skia 2.6.2's
declarative layer doesn't support AnimatedProp for SkPicture or SkRect clip
despite the type signature suggesting it (`AnimatedProp<T> = T | {value: T}`).
**Reverted.** The pane React-render cost (~90 renders/s) remains; a future
approach would need to use `SkiaPictureView` + direct JSI calls per pane
(same pattern as the scene's direct renderer) rather than declarative Canvas.

### 3. Explicit SkPicture disposal (only if HUD shows GC pressure)

Pictures churn at ~1-2/frame and are GC-reclaimed. If the HUD's gc counter
correlates with hitches: `.dispose()` the PREVIOUS published picture once no
pane can still replay it — needs a small ref-count/generation in glassStage
(panes hold the current picture; naive disposal = use-after-free crash).
Also dispose the previous slow sub-picture on rebuild (only the published
wrapper references it, and only until the next publish). Don't do this
speculatively.

### ~~4. Opaque scene surface~~ ✗ FAILED (build #25)

**Broke rendering on-device.** Setting `opaque={true}` then toggling back to
`false` corrupted the native SkiaPictureView surface — organisms disappeared
and could not be recovered without restarting the app. The `opaque` prop on
this Skia version doesn't support live toggling; the surface alpha state gets
permanently corrupted. **Reverted — the prop is no longer passed.**

### 5. Dependency upgrade (riskiest, isolate completely)

Newer `@shopify/react-native-skia` (+ possibly reanimated/worklets) may fix
the UI-thread path outright — the parked `claude/skia-ui-thread` branch
would then eliminate JS-thread contention entirely. History says this combo
is fragile; isolate in a throwaway branch + separate build.

### Already tried — do NOT re-attempt

Everything in the guide's constraint list, plus: 30fps clock gate (visible
double-judder on 120Hz), synchronized pane refresh, JS-live/frozen pane
offsets, per-pane organism redraw, blur in recorded pictures, backdrop
filters, offscreen-surface snapshot blur, **SkiaPictureView `opaque` prop**
(surface state corruption on toggle — build #25), **declarative SharedValue
`picture`/`clip` props** (runtime crash — Skia 2.6.2 doesn't support
AnimatedProp for SkPicture/SkRect clip, build #25).

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
