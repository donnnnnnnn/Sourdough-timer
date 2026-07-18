# Animation Session Guide

Reference for any session working on the fullscreen Skia fermentation scene,
glass panels, or the frosted-glass tuner. Read this BEFORE touching animation
code — it records hard-won constraints that cost real build cycles to learn.

---

## Architecture overview (glass-in-card, July 12 2026)

```
app/(tabs)/index.tsx
├── SafeSkiaFermentationScene   ← error boundary + lazy require
│     └── SkiaFermentationScene ← organisms only; publishes its per-frame
│                                  SkPicture via glassStage
├── GlassStageProvider          ← context with contentNode + measureTick
│     └── GlassCard (×3)        ← hosts its OWN small canvas...
│           └── GlassBackdrop   ← ...that replays the published picture
│                                  through a declarative layer blur
└── ScrollView (onScroll → setScrollY)
```

The glass pane lives INSIDE each card, so native scrolling moves card and
glass together — alignment is structural, not synchronized. The fullscreen
scene knows nothing about panels anymore. The measured card position + live
scroll offset only choose WHICH slice of the scene shows through the blur
(stale values there are imperceptible in a blurred abstract field; they can
no longer misplace the pane).

### File map

| File | What it does |
|------|-------------|
| `components/SkiaFermentationScene.tsx` | Organisms/glow scene. Records one SkPicture per frame and publishes it via `glassStage.publishScenePicture`. Two renderer paths: `direct` (default — hands the picture to the native Skia view imperatively, zero React per frame) and `react` (build #22 declarative fallback). See "The direct renderer" below. |
| `components/GlassBackdrop.tsx` | The frosted pane inside a card: opaque black base → blurred replay of the scene picture (declarative `Group layer` blur) → tint → sheen. Staggered/widening refresh (~8-15fps per pane). |
| `components/GlassCard.tsx` | RN `<View>` wrapper; lazy-`require()`s GlassBackdrop (never a static Skia import — module-eval crash history) behind a silent error boundary, measures its scroll-content position for the slice offset. |
| `components/glassStage.ts` | Module-level bridge (not React state): `contentTop`/`scrollY` setters+getters and the scene-picture pub/sub channel. No re-render storm on scroll. |
| `components/perfFlags.ts` | Module-level store for the perf A/B toggles (renderer / glow / resScale / cull / sim) + the frame-pacing stats the scene loop writes. |
| `components/PerfHud.tsx` | Hidden dev overlay: fps/worst-tick/late/hitch/js-work/GC readout + live A/B chips. Toggled by long-pressing the faint "· perf ·" label at the very bottom of the timer screen. |
| `components/SkiaErrorBoundary.tsx` | Error boundary + lazy `require()` so a scene crash never kills the app. |
| `components/theme.ts` | Shared palette: `C.glassBorder`, `C.glassSheen`, etc. |
| `tools/frosted-glass-tuner.html` | Standalone design tool — open in browser, sliders for per-panel opacity + blur, phone mockup with a canvas scene. |
| `docs/SKIA-HANDOFF.md` | Full investigation history: worklet crash, every failed glass-blur approach. |
| `docs/ANIMATION-OPTIMIZATION-HANDOFF.md` | Optimization-pass state: what each build changed, owner verdicts, ranked next directions. |

---

## The direct renderer & perf HUD (July 18 2026, build #23)

### Why the declarative path was expensive (measured from library source)

On Skia 2.6.2 with reanimated installed, EVERY commit to a declarative
`<Canvas>` runs `sksg/Container.native.js → NativeReanimatedContainer.redraw()`:
it re-builds a `ReanimatedRecorder`, re-visits the whole scene-graph, and
dispatches a `runOnUI` worklet that replays the recorder into a second
picture before `setJsiProperty(nativeId, 'picture', …)` hands it to the
view. The scene was paying that machinery — plus a full React render +
commit + effect pass — 60×/s just to swap one picture prop on a tree whose
shape never changes.

### What the direct path does instead

`SkiaFermentationScene` now mounts a bare `<SkiaPictureView>` (exported by
RN Skia; it's the same native component `<Canvas>` uses) and its rAF loop
does, per frame:

```
record SkPicture (slow/fast split, unchanged)
SkiaViewApi.setJsiProperty(view.nativeId, 'picture', pic)   // JSI call
SkiaViewApi.requestRedraw(view.nativeId)                    // JSI call
glassStage.publishScenePicture(pic)
```

— the exact two calls `SkiaPictureView` itself makes internally, zero React,
zero scene-graph, zero runOnUI. The React/declarative pipeline is kept whole
behind `perfFlags.renderer = 'react'` (HUD chip "draw"), and the scene
auto-falls-back to it if the direct loop ever throws (the throw happens
outside React, where SkiaErrorBoundary can't see it, so the loop try/catches
everything and calls `noteDirectFallback`). Glass panes are untouched: their
blur NEEDS the declarative `Group layer` path (blur inside a recorded
picture doesn't render on this device — constraint 3).

### The perf HUD (owner-facing evidence tool)

Long-press the faint **"· perf ·"** label at the very bottom of the timer
screen (600ms) to toggle a small overlay showing, once per second:

- `fps` — accepted 60fps-gate ticks per second (JS thread health)
- `worst` — worst tick-to-tick gap in the last second
- `late/s`, `hitch/s` — ticks >20ms / >34ms (a hitch = visibly dropped frame)
- `js work` — ms spent recording+publishing per frame (avg / max)
- `gc +N/s` — Hermes GC collections per second, when the runtime exposes them
- session totals for late/hitch

How to read it: **numbers clean but the eye sees jank → GPU-bound** (flip
the `glow`/`res` chips); **worst-tick spikes with low js work → GC or other
JS-thread work** (check the gc counter); **js work itself high → recording
cost** (the slow/fast split needs another turn of the screw). A screenshot
of the HUD is a complete profiling report.

Chips (each flips a `perfFlags` value live, no rebuild):

| Chip | Values | What it tests |
|------|--------|---------------|
| `draw` | direct / react | React-bypass renderer vs build #22 pipeline. Pixel-identical output; direct should feel smoother or equal. |
| `glow` | mask / grad | MaskFilter halos vs cached radial-gradient discs (NOT pixel-identical — owner judges look + smoothness). |
| `res` | 100% / 75% | Scene canvas backing resolution (NOT pixel-identical — sharp specks are the tell; ~44% less GPU fill at 75%). |
| `cull` | on / off | Skip draws below ~1.2% alpha (≤ ~3/255 per pixel — sub-visible, confirmed by owner). **Default ON since build #24** (evidence: +4 fps, −18ms worst, no visual difference). |
| `sim` | live / bulk 85% / bulk 97% | Forces the scene to a late-bulk cast immediately — test the worst case without a 5-hour bake. Also un-dims the idle field while active. |

The `sim` chip only affects the SCENE (organism density/progress feeding
pane refresh periods); the real timer, captions and cards stay live.

---

## Critical constraints (do NOT violate)

### 1. No `'worklet'` directives

The worklets Babel plugin rewrites `function foo(){}` into a var-assigned
factory, breaking JS function hoisting. Every draw helper in the scene is a
plain hoisted function that references helpers defined later in the file.
Adding `'worklet'` crashed the app for a full day. Full story in
`docs/SKIA-HANDOFF.md`.

### 2. JS-thread animation only

The scene clock is `requestAnimationFrame` on the JS thread; recording is
`createPicture` (in the direct loop by default, in a `useMemo` on the react
fallback path). Do NOT switch to Skia's `useClock` + reanimated
`useDerivedValue` (UI-thread worklet) — that crashed on this Skia 2.6.2 +
reanimated 4.3 / worklets 0.8 combo. A UI-thread variant is parked on branch
`claude/skia-ui-thread` if someone wants to revisit it later with a newer
Skia. (Calling `SkiaViewApi.setJsiProperty` from the JS thread is NOT a
violation of this rule — it's the first-class path `SkiaPictureView` itself
uses from its constructor, no worklets involved.)

### 2½. Every non-pixel-identical change goes behind a perfFlags toggle

Owner's standing rule. If a proposed optimization changes ANY pixel (glow
substitution, resolution scaling, culling thresholds, dropped passes), wire
it to `components/perfFlags.ts`, surface a chip in `PerfHud`, and default it
to the pixel-identical setting unless the owner has already accepted the
trade. Never ship a look change as a fait accompli inside a perf build.

**Already owner-accepted** (safe to default ON): `cull` (build #24 evidence).
**Owner-rejected** (keep default OFF/original): `glow: 'grad'` (no fps gain,
owner prefers mask look), `resScale: 0.75` (no improvement on Pixel 9).

### 3. No blur inside a recorded SkPicture — and no backdrop filters

**Blur recorded inside `createPicture()` does not render on the Pixel 9,
period.** Confirmed empirically across saveLayer-with-image-filter (even
with the panel blacked out first, build #13) and offscreen-surface
snapshots. Glass blur must use the DECLARATIVE path: a `<Group
layer={<Paint><Blur .../></Paint>}>` in a normal `<Canvas>` scene graph —
that is what `GlassBackdrop.tsx` does. The pre-existing bans below still
hold too:

Three approaches were tried and confirmed broken on a Pixel 9:

1. **Declarative `<BackdropBlur>`** — made the Skia native surface render
   ABOVE the rest of the app's native UI (buttons vanished underneath).
2. **Offscreen `SkSurface` → snapshot → `drawImage` through blur** — no
   visible blur on-device (SkImage from a second GPU surface replayed inside
   a recorded SkPicture is a rare code path).
3. **`saveLayer` with backdrop image filter sampling the destination** —
   same native-surface-above-UI problem as #1.

**What works:** `canvas.saveLayer(paintWithImageFilter, null)` — a forward
image filter, NOT a backdrop read. Clip to the panel's rounded rect, open a
layer with `ImageFilter.MakeBlur`, redraw organisms into that layer (Skia
rasterizes just this clipped region and blurs during composite-back), restore.
See `drawGlassPanels()` at ~line 699.

### 4. Keep the per-frame path allocation-free (smoothness)

The scene re-records an SkPicture on the JS thread every frame, so anything
allocated inside a draw function happens hundreds of times per frame. The
owner reported visible choppiness on a Pixel 9; the causes and their fixes
(July 11 2026) — do not reintroduce them:

- **Primitives must not allocate.** `additivePaint()` returns one module-level
  scratch paint (reset per call), `col()` returns a slot from a rotating
  Float32Array pool, `blurMask()` caches MaskFilters by quantized sigma, and
  gluten strands reuse `SCRATCH_PATH`. This is safe because Skia draw calls
  snapshot paint/path state into the recording. Previously every call
  allocated Paint + parsed-string Color (+ MaskFilter) — tens of thousands of
  short-lived objects per second, and the GC pauses read as stutter.
  Two more allocation classes were flushed out July 13 2026 (build #21
  on-device: "still has some jerkiness, even when not scrolling"):
  `glowOrb` built a fresh `MakeRadialGradient` (+ `vec()`) per call — now it
  caches UNIT gradients keyed by color pair + alphas quantized to 1/64 and
  places them with a canvas transform (radial gradients are
  scale-invariant); and `drift()`/`flow()` returned fresh `{dx,dy}` objects
  per organism per frame — now module scratches (consume into locals before
  the next call to the same helper).
- **Recording is split by motion speed.** Everything except bubbles moves
  ~0.2px/frame (5-8px drift amplitudes over 4-7s periods), so the slow cast
  is recorded into a sub-picture every 2nd clock tick (every 3rd once
  progress ≥ 0.5, when the cast is biggest) and each frame's published
  picture replays it (native, cheap) then records bubbles (~2.3px/frame,
  visibly steps below 60fps) on top. The slow picture rebuilds immediately
  when st/layout/size/dim change — cadence alone would replay a stale cast
  after a progress step. This roughly halves-to-thirds per-frame JS
  recording cost, and the saving grows exactly where the jank did: late
  bulk, where the slow cast is the part that grows.
- **The published picture is recorded once per frame**, then replayed
  (`canvas.drawPicture`) for the full-canvas pass AND inside each glass
  pane's blur layer. Never re-draw organisms per pane — with ~9 panes that
  multiplies JS recording work.
- **`progress` is quantized to 0.5% steps** before feeding `computeDoughState`
  / `buildLayout`. The `fraction` prop ticks every second (the timer clock);
  unquantized it rebuilt the entire organism layout every second — a visible
  once-per-second hitch.
- **The clock runs at 60fps** with a `FRAME_MS - 1` epsilon. The old 30fps
  gate double-juddered on a 120Hz display (frames landed 33 or 42ms apart).
- **Pane updates are staggered and widen through bulk; off-screen panes
  update zero times** (July 13 2026, two rounds on-device — first "choppy
  later in bulk" persisted even after a flat 20fps/off-screen-skip cap).
  Root cause: every pane gated on the SAME `tick % period` condition, so
  all ~7-8 mounted panes redrew — each re-rasterizing + re-blurring a
  full-viewport layer — on the SAME published scene frame: a periodic
  multi-pane GPU burst, worse as the organism cast (hence each redraw's
  cost) grows through bulk. Fixed two ways, NEITHER of which shrinks a
  pane or changes what it draws:
  1. Each pane owns a stable slot (`glassStage.nextPaneSlot()`, assigned via
     a `useState` lazy initializer — NOT `useRef(nextPaneSlot())`, which
     would call the mutating counter every render) and only redraws on
     `tick % period === mySlot % period` — spreads the redraw cost evenly
     across frames instead of bursting it.
  2. The period itself widens with `glassStage.getSceneProgress()` (4
     scene-ticks ≈ 15fps early bulk → 7 ≈ 8.5fps late bulk), holding each
     pane's total GPU time roughly constant as its redraw cost grows.
  Off-screen panes (checked against the LIVE offset and `getSceneHeight()`,
  120px margin) still skip updates outright regardless of turn.
- **Each pane's blur layer is clipped to its visible scene slice, and pane
  refreshes halve while a scroll is in flight** (July 13 2026, build #20
  on-device: "scrolling is jerky even in the pre bulk screen"). The pane
  canvas is scene-sized, but only a card-height sliver shows through the
  card's overflow clip — yet an un-clipped `<Group layer={blur}>` made every
  redraw rasterize + Gaussian-blur the ENTIRE scene (~9 pre-bulk panes ×
  15-20fps ≈ 200 full-screen blur passes/sec, continuously; a static screen
  hid the dropped frames, scrolling exposed them). Two fixes, no visual
  change:
  1. The blur group is wrapped in `<Group clip={sliceRect}>` — the visible
     slice + `BLUR_CLIP_MARGIN` (160px) of scroll drift, recomputed from
     live values on each redraw. Skia limits the saveLayer to the clip, so
     blur cost drops from scene-sized to card-band-sized. The opaque base
     and tint fills stay UNCLIPPED on purpose: a fling that outruns the
     margin degrades to plain glass (organisms briefly missing at a card
     edge, behind frost, in motion), never to the sharp scene leaking
     through a transparent canvas region.
  2. `glassStage.isScrollActive()` (a scroll event arrived <150ms ago — no
     begin/end bookkeeping, momentum included) doubles every pane's update
     period while true. Pane POSITION is native-driven and unaffected; only
     the frost content's refresh drops, invisible while the screen is
     moving. This is NOT the rejected "pause the animation during scroll":
     the main scene never throttles and world-anchoring is untouched.
- **Glass panes are world-anchored via NATIVE counter-scroll** (July 2026,
  after two failed JS-driven designs, both confirmed on-device): live JS
  offsets lag native card motion by 1–2 frames → "very choppy when
  scrolling"; frozen offsets drag the sprites along with the card and snap
  on settle → "totally breaks the illusion of frosted glass". The working
  design: each pane hosts a SCENE-SIZED canvas counter-translated by an RN
  `Animated` transform bound (useNativeDriver) to the ScrollView's scroll
  value (`glassStage.getScrollAnim()`), so the world stays pixel-locked
  under the glass in the same UI-thread frame as the scroll. Do not move
  this back to JS in any form. The card-anchored sheen lives in a separate
  static card-sized canvas.
- **Tuner scene parity:** the tuner's Before-bulk screen previews the app's
  dim idle field (progress 0, brightness ×0.28) — tuning pre-bulk glass
  over a lively scene made values look far darker in the real app.

---

## Glass panel system — how it works

The pane is a Skia `<Canvas>` INSIDE each GlassCard (`GlassBackdrop.tsx`),
painted in four passes: opaque black base → blurred replay of the scene's
organism picture → espresso tint → top sheen. The RN View's `overflow:
'hidden'` + `borderRadius` clip it to the card shape; the RN border supplies
the hairline edge.

### Coordinate model (content slice only)

```
sceneY = contentTop + contentY - scrollY   // which slice shows through
```

- `contentTop` — content container's Y relative to the ROOT view the scene
  canvas fills (NOT the window — window coords include the status bar +
  header and misplace the slice). Computed in `index.tsx` by measuring both
  and differencing, plus the scroll offset at measure time.
- `contentY` — a card's Y within the scroll content (scroll-independent);
  measured via `measureLayout` against the content container ref (the ref
  itself — a `findNodeHandle` number fails silently on the New Architecture).
- `scrollY` — live scroll offset, written to `glassStage` from `onScroll`.

These values ONLY pick the scene slice shown through the blur. The pane
itself is a child of the card and cannot misalign.

### Per-card tint + blur props

`<GlassCard tint={n} blur={b}>` — `tint` is the final espresso-overlay
alpha (0..0.92), identical to the tuner readout (it was once a ×0.44
multiplier; that unit mismatch shipped panels ~56% lighter than tuned).
`blur` is in TUNER units: `GlassBackdrop` multiplies it by
`TUNER_BLUR_SCALE` (0.5) before handing Skia the sigma, because the tuner's
CSS-px blur rendered visibly ~2× stronger on the Pixel 9 (device pixel
density + different Gaussian). Re-tune in the tuner, paste readout values
straight into the props; re-calibrate globally only via `TUNER_BLUR_SCALE`.

### Panel inventory (owner-tuned July 13 2026 — everything glassed except the timer)

| Panel | tint/blur | Notes |
|-------|-----------|-------|
| Timer hero (big clock) | — | Intentionally bare |
| "Your last bake" banner | 0.09/7 | Keeps accent border via style override |
| Kitchen temp | 0.13/16 | |
| Autolyse picker box + pill | 0.08/11 | |
| Alert chips 30/45/60 | 0.00/6 | Active chip: accent border + accentSoft overlay inside |
| Expected bulk time | 0.16/12 | |
| Planned folds | 0.16/9 | |
| Start Bulk CTA | 0.46/14 | Glassed; accent border + accent text (was solid amber) |
| Phase caption | 0.00/13 | |
| Bulk progress | 0.12/11 | |
| Next-fold trio | 0.13/12 | |
| Folds-completed CTA | 0.00/7 | Glassed; accentBorder kept |
| Dough story | 0.26/9 | |
| Dough rise tracker | 0.08/11 | |
| End Bulk & Shape CTA | 0.00/9 | Glassed; red border + red text kept |
| Modals (autolyse sheet, late-fold confirm) | — | Overlay surfaces, not over the scene |

When re-tuning, keep the tuner's `PANELS` defaults and its "Current app
values" preset in sync with this table.

---

## The frosted-glass tuner (`tools/frosted-glass-tuner.html`)

A zero-dependency standalone HTML page. Open it directly in a browser — no dev
server needed. Rewritten July 2026 as a WYSIWYG mirror of the app:

- The mockup screen is exactly 411 CSS px wide (= the app's 411 dp), panes
  use the exact `GlassBackdrop` compositing recipe, and the preview applies
  the same `TUNER_BLUR_SCALE` (0.5) the app does — **the constant in the
  tuner's `<script>` must be kept equal to the one in `GlassBackdrop.tsx`**.
- Two screens matching `index.tsx` panel-for-panel: "Before bulk"
  (banner, kitchen temp, autolyse pill, alert chips, expected bulk, planned
  folds, Start CTA) and "During bulk" (bare timer, phase caption, progress,
  next fold, fold CTA, dough story, rise tracker, End CTA).
- Every panel has its own opacity + blur sliders; the three amber CTAs have
  a frosted-glass ⇄ solid toggle for deciding that look both ways.
- Presets: "Current app values" (keep in sync with the shipped props),
  "All windows open", "Uniform frost".
- A live readout of paste-ready values (raw tuner units).

### How to apply tuner values to the real app

1. Opacity → set `tint` prop on each `<GlassCard>` in `app/(tabs)/index.tsx`
   (used verbatim as the overlay alpha in `drawGlassPanels` — 1:1 with the
   tuner readout)
2. Blur → set the `blur` prop on each `<GlassCard>` (per-panel sigma), or
   change the shared animated base sigma in `drawGlassPanels` (~line 711)
3. Glass hue → change the `rgba(22,16,13,...)` in the tintPaint (~line 734)
4. Edge stroke → change the `rgba(255,238,212,0.22)` in the edgePaint (~line 752)

The tuner's canvas scene is a simplified port of the real organisms — it's for
judging GLASS legibility over a busy background, not a pixel-match.

---

## Open work / known gaps

- **Glass blur — device-tested July 11 2026 (run #12 APK).** Results and the
  two follow-up fixes, in order:
  1. **Registration fix confirmed** — slabs finally drew, with visible tint
     (before this, `measureLayout` was given a `findNodeHandle` number, which
     the New Architecture rejects via the previously-empty failure callback;
     no card ever registered, no slab was ever drawn).
  2. **Slabs were offset ~a header-height below their cards** — `contentTop`
     had been wired to the content container's WINDOW Y, but the Skia canvas
     starts below the status bar + tab header. Fixed: measure the content
     container AND the root view (which the canvas fills) and use the
     difference, plus the live scroll offset at measure time.
  3. ~~Compositing theory~~ — build #13 black-filled the panel before the
     blurred redraw and STILL showed no blur, and panels detached from cards
     during scroll. Conclusion: blur inside a recorded SkPicture simply does
     not render on this device, and fullscreen-canvas panels can never track
     natively-scrolled cards. Both fixed structurally July 12 2026 by the
     **glass-in-card architecture** (see Architecture overview):
     `GlassBackdrop` inside each card, declarative layer blur, scene
     publishes its picture via `glassStage`. Awaiting device test.
- ~~**`contentTop` is never wired up**~~ **Done.** `onContentRef` in
  `index.tsx` now calls `measureInWindow` and feeds the result to
  `setContentTop()`.
- ~~**No per-panel blur**~~ **Done.** `GlassRegistration` and
  `GlassScreenRect` now carry an optional `blur` field. `GlassCard` accepts a
  `blur` prop. `drawGlassPanels` uses `g.blur` when set, falling back to the
  shared animated sigma.
- ~~**Tint values not yet dialled**~~ **Done.** GlassCards in `index.tsx` now
  carry per-panel `tint` and `blur` values from the tuner's
  "Legibility-tuned" preset: Kitchen temp (0.36/14), Bulk progress (0.36/14),
  Dough story (0.54/16).
- **Tint unit mismatch fixed (July 11 2026):** those preset numbers were
  originally pasted into a prop that MULTIPLIED a 0.44 base opacity, so
  panels rendered ~56% lighter than tuned. `tint` is now the final overlay
  opacity itself (1:1 with the tuner readout); the pasted values became
  correct without changing them. Any device test of the glass should judge
  darkness against the tuner's "Legibility-tuned" preset.

---

## Branch history (for context, not action)

| Branch | Status | What |
|--------|--------|------|
| `claude/fullscreen-animation-skia-n05wo4` | **active** | Fullscreen scene + glass panels + tuner |
| `claude/microbial-animation-background-5p7qf7` | merged concepts | Original tuner + full-bleed experiment |
| `claude/animation-enrichment` | merged into active | Richer organism visuals |
| `claude/skia-fix` | merged into main | The worklet crash fix |
| `claude/skia-ui-thread` | parked | UI-thread worklet variant (crashes on current deps) |
