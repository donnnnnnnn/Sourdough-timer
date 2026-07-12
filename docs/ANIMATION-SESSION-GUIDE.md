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
| `components/SkiaFermentationScene.tsx` | Organisms/glow scene. Records one SkPicture per frame, draws it, and publishes it via `glassStage.publishScenePicture`. |
| `components/GlassBackdrop.tsx` | The frosted pane inside a card: opaque black base → blurred replay of the scene picture (declarative `Group layer` blur) → tint → sheen. Updates on every 2nd published frame (~30fps). |
| `components/GlassCard.tsx` | RN `<View>` wrapper; lazy-`require()`s GlassBackdrop (never a static Skia import — module-eval crash history) behind a silent error boundary, measures its scroll-content position for the slice offset. |
| `components/glassStage.ts` | Module-level bridge (not React state): `contentTop`/`scrollY` setters+getters and the scene-picture pub/sub channel. No re-render storm on scroll. |
| `components/SkiaErrorBoundary.tsx` | Error boundary + lazy `require()` so a scene crash never kills the app. |
| `components/theme.ts` | Shared palette: `C.glassBorder`, `C.glassSheen`, etc. |
| `tools/frosted-glass-tuner.html` | Standalone design tool — open in browser, sliders for per-panel opacity + blur, phone mockup with a canvas scene. |
| `docs/SKIA-HANDOFF.md` | Full investigation history: worklet crash, every failed glass-blur approach. |

---

## Critical constraints (do NOT violate)

### 1. No `'worklet'` directives

The worklets Babel plugin rewrites `function foo(){}` into a var-assigned
factory, breaking JS function hoisting. Every draw helper in the scene is a
plain hoisted function that references helpers defined later in the file.
Adding `'worklet'` crashed the app for a full day. Full story in
`docs/SKIA-HANDOFF.md`.

### 2. JS-thread animation only

The scene uses `requestAnimationFrame` → `createPicture` in `useMemo`. Do NOT
switch to Skia's `useClock` + reanimated `useDerivedValue` (UI-thread worklet)
— that crashed on this Skia 2.6.2 + reanimated 4.3 / worklets 0.8 combo.
A UI-thread variant is parked on branch `claude/skia-ui-thread` if someone
wants to revisit it later with a newer Skia.

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
- **Organisms are recorded once per frame** into `orgPicture`, then replayed
  (`canvas.drawPicture`) for the full-canvas pass AND inside each glass
  panel's blur layer. Never call `drawOrganisms` per panel — with 3 panels
  that quadruples JS recording work.
- **`progress` is quantized to 0.5% steps** before feeding `computeDoughState`
  / `buildLayout`. The `fraction` prop ticks every second (the timer clock);
  unquantized it rebuilt the entire organism layout every second — a visible
  once-per-second hitch.
- **The clock runs at 60fps** with a `FRAME_MS - 1` epsilon. The old 30fps
  gate double-juddered on a 120Hz display (frames landed 33 or 42ms apart).
- **Pane updates are capped: ~20fps when visible, zero when off-screen**
  (July 13 2026, on-device: "choppiness, especially in later stages of
  bulk"). With ~8 panes mounted during bulk, per-pane React/GPU updates at
  30fps competed with the 60fps scene recording — whose cost itself grows
  through bulk as the organism cast fills out. Behind the blur, 20fps is
  indistinguishable; off-screen panes (checked against the LIVE offset and
  `getSceneHeight()`, with a 120px margin) skip updates outright.
- **Glass panes hold their scene OFFSET during scroll** (July 2026,
  on-device: blur was "very choppy when scrolling"). Native scrolling moves
  the cards on the UI thread; repositioning the pane content from a JS
  scrollY that lags by 1–2 frames reads as stutter inside the glass. While
  `glassStage.isScrolling()` is true, `GlassBackdrop` keeps drawing fresh
  animation frames (owner wants the organisms alive mid-scroll) but at a
  HELD offset, re-syncing on settle. `index.tsx` tracks motion with a
  begin-drag / end-drag / momentum handshake. Do not "fix" the held offset
  by updating it live from onScroll — that IS the stutter.

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
