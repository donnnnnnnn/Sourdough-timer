# Animation Optimization Handoff — next pass

Written July 2026, immediately after build #22 shipped. Audience: a fresh
session taking **one more optimization pass at animation smoothness**.

Read `docs/ANIMATION-SESSION-GUIDE.md` FIRST (architecture + hard
constraints), and `docs/SKIA-HANDOFF.md` for the full failure history. This
file only adds: where the optimization work stands, and ranked directions
for the next pass.

---

## Where things stand

Owner device: **Pixel 9 (120Hz)**. Complaint history and what each build fixed:

| Build | Commit | Owner verdict / change |
|-------|--------|------------------------|
| #19 | `5a43e27` | Native counter-scroll world-anchoring — scroll alignment SOLVED, but "choppy later in bulk" |
| #20 | `928f4fa` | Staggered pane slots + progress-widening period → "improved" but "scrolling is jerky even pre-bulk" |
| #21 | `9568f1f` | Blur clipped to visible slice + scroll-time refresh halving + BASE_PERIOD 3→4 → "improved significantly", card edges confirmed good, but "still some jerkiness, even when not scrolling, especially later in bulk" |
| #22 | `27998f4` | glowOrb unit-gradient shader cache; drift/flow scratch outputs; slow/fast layer split (slow cast @30fps, @20fps late bulk; bubbles @60fps). **Owner verdict pending at handoff time.** |

So: scroll jank is (probably) beaten; the last reported issue was
steady-state hitching that worsens late in bulk, and #22 attacked its two
likeliest causes (Hermes GC pauses from per-call JSI allocations, and the
60fps JS re-record cost of a growing cast). **First step of the next pass:
get the owner's verdict on #22 before optimizing anything.**

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

## Ranked directions for the next pass

### 0. Evidence before surgery

Every fix so far was reasoned from first principles because we can't profile
from the cloud. If jank persists after #22, STOP GUESSING and get data via
the owner (they're non-technical — give exact copy-paste commands):

- `adb shell dumpsys gfxinfo <package> framestats` after ~30s on the timer
  screen → frame-time percentiles, and whether misses are on the UI/Render
  thread (GPU-bound) or come in bursts (GC-shaped).
- `adb logcat -s HermesGC` (or grep logcat for `GC`) while watching the
  screen → correlate visible hitches with collection events. If #22's
  allocation work landed, major GCs should be rare.
- Cheapest option, no adb: a dev-only frame-pacing HUD — measure rAF deltas
  in the scene's existing loop, render worst-frame/1s and dropped-frame
  count as a tiny text overlay behind a `__DEV__`-ish flag. JS-side deltas
  distinguish "JS thread late" from "JS fine but display janks" (= GPU).

### 1. Bypass React for the per-frame redraw (JS thread, medium risk, big win)

The scene calls `setTimeSec()` 60×/s → full React render + `useMemo` +
commit just to hand Skia a new picture. Each GlassBackdrop `force()`s a
React re-render for every content refresh (~9 panes × 8-15fps). None of
this reconciliation buys anything — the tree shape never changes.

RN Skia canvases can be redrawn imperatively: keep a `Picture` node whose
picture is swapped via a ref/`useCanvasRef().redraw()`-style path (check the
2.6.2 API: `SkiaDomView.redraw()`, or a `notifyChange`d value feeding
`<Picture>`), so a new frame = record picture + one native call, zero React.
Do the scene first (60 renders/s saved), panes second (~9 × 12/s commits).
Keep the React path as fallback behind a flag in case 2.6.2's imperative
path misbehaves on-device.

### 2. Main-scene GPU cost: MaskFilter glows (GPU, needs owner A/B, big win late bulk)

`halo()`/`ring()`/`drawStrand()` attach a Gaussian `MaskFilter` to hundreds
of draws per frame. The filter objects are cached (JS-side), but the GPU
still evaluates a blur per draw. The gradient-cache pattern from #22 extends
naturally: a blurred disc ≈ a radial gradient with a flat core and soft
falloff (cacheable exactly like `unitGlowShader`); a blurred ring/stroke is
harder — consider keeping MaskFilter for rings but replacing disc halos
(the bulk of the calls). ⚠️ This is the first proposal that ISN'T
pixel-identical — build it behind a toggle and have the owner A/B two APKs
(or a debug switch) before committing to it.

### 3. Scene canvas at reduced backing resolution (GPU, medium risk)

The main canvas renders at full physical resolution (~1080×2340) at 60fps;
content is soft additive glow — the definition of downscale-tolerant. Render
the scene canvas at ~0.75× (or 0.5×) logical size and scale it back up with
a View transform. Fill-rate drops ~44% (75%). Panes are unaffected (the
published picture is resolution-independent; pane canvases stay as they
are). Sharp elements (bubble rim highlights, yeast specular dots) are the
tell — owner judges. Cheap to prototype, easy to revert.

### 4. Invisible-detail culling (JS+GPU, near-zero risk)

Tighten skip thresholds on things that literally cannot be seen: grains/
scars/specks whose radius lands < ~0.7px on screen, draws whose final alpha
< ~0.015 (current floors are 0.002-0.03 and inconsistent). Late bulk the
cast is biggest and dimmest-per-element, so this culls most exactly when
needed. Not a visual sacrifice if the threshold is genuinely sub-visible —
be honest about the cutoff, verify against screenshots.

### 5. Sweep the stragglers (JS, zero risk, small)

- `drawGluten` builds a fresh `live` array of node objects per frame — pool it.
- `drawLAB`'s septum branch and others still call `additivePaint()` +
  `col()` per bead — fine (pooled), but check nothing else allocates in a
  loop: audit with a grep for `Skia\.`, `new `, `\[\]`, `\{` returns inside
  the draw functions.
- The pane-side `useEffect` cascade on refresh: profile whether
  `getScenePicture()` pulls during render vs a subscription would matter.

### 6. Riskier / only with fresh evidence

- **Dependency upgrade**: newer `@shopify/react-native-skia` (+ possibly
  reanimated/worklets) may fix the UI-thread path outright — the parked
  `claude/skia-ui-thread` branch would then eliminate JS-thread contention
  entirely. History says this combo is fragile; isolate in a throwaway
  branch + separate build.
- **Explicit SkPicture disposal**: pictures churn at ~1.5/frame and are
  GC-reclaimed. If GC logs still show pressure, `.dispose()` the previous
  published picture — but ONLY after all panes have stopped replaying it
  (panes hold the current one; naive disposal = use-after-free crash).
  Requires a small ref-count in glassStage. Don't do this speculatively.

### Already tried — do NOT re-attempt

Everything in the guide's constraint list, plus: 30fps clock gate (visible
double-judder on 120Hz), synchronized pane refresh, JS-live/frozen pane
offsets, per-pane organism redraw, blur in recorded pictures, backdrop
filters, offscreen-surface snapshot blur.
