# Animation Session Guide

Reference for any session working on the fullscreen Skia fermentation scene,
glass panels, or the frosted-glass tuner. Read this BEFORE touching animation
code — it records hard-won constraints that cost real build cycles to learn.

---

## Architecture overview

```
app/(tabs)/index.tsx
├── SafeSkiaFermentationScene   ← error boundary + lazy require
│     └── SkiaFermentationScene ← the real 1 314-line scene
│           └── reads glassStage.screenRects() each frame
├── GlassStageProvider          ← context with contentNode + measureTick
│     └── GlassCard (×3)        ← each measures itself → glassStage registry
└── ScrollView (onScroll → setScrollY)
```

### File map

| File | What it does |
|------|-------------|
| `components/SkiaFermentationScene.tsx` | Full scene: organisms, glow, glass blur. 1 314 lines. |
| `components/GlassCard.tsx` | React Native `<View>` wrapper that measures itself relative to the scroll content container and registers its position + `tint` prop into `glassStage`. |
| `components/glassStage.ts` | Module-level registry (not React state). Cards write positions, scene reads `screenRects()` each frame. No re-render storm on scroll. |
| `components/SkiaErrorBoundary.tsx` | Error boundary + lazy `require()` so a scene crash never kills the app. |
| `components/theme.ts` | Shared palette: `C.glassBorder`, `C.glassSheen`, etc. |
| `tools/frosted-glass-tuner.html` | Standalone design tool — open in browser, sliders for per-panel opacity + blur, phone mockup with a canvas scene. |
| `docs/SKIA-HANDOFF.md` | Full investigation history: worklet crash, glass-blur attempts #1–#4. |

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

### 3. No backdrop filters for glass blur

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

---

## Glass panel system — how it works

### Coordinate model (all in screen / Skia-canvas pixels)

```
screenY = contentTop + contentY - scrollY
```

- `contentTop` — screen Y where the scroll content's origin sits. Set via
  `setContentTop()` in `glassStage.ts`. **Currently always 0** — relies on
  the Skia canvas and ScrollView sharing the same parent origin. If a header
  or inset is ever added, wire this up or panels will silently misplace.
- `contentY` — a card's Y within the scroll content (scroll-independent);
  measured via `measureLayout` against the content container ref.
- `scrollY` — live vertical scroll offset, updated from `onScroll`.

### Per-card tint prop

Each `<GlassCard tint={n}>` sets the espresso-brown overlay opacity
**directly** — `tint` IS the final alpha, the same number the tuner's
readout shows (this used to be a ×0.44 multiplier; the unit mismatch made
every panel render ~56% lighter than tuned, so the multiplier was removed):

```typescript
// SkiaFermentationScene.tsx ~line 734
tintPaint.setColor(Skia.Color(`rgba(22,16,13,${clamp(g.tint, 0, 0.92)})`));
```

- `tint=0` → fully transparent panel (the big timer clock)
- `tint=0.44` (default) → medium glass
- values are capped at 0.92

The GlassCards in `index.tsx` carry the tuner's "Legibility-tuned" preset:
Kitchen temp `0.36/14`, Bulk progress `0.36/14`, Dough story `0.54/16`
(tint/blur). Re-tune in the tuner, then paste its readout values straight
into the props — the units match 1:1.

### Blur (sigma)

Shared across all panels, animated:

```typescript
// SkiaFermentationScene.tsx ~line 711
const sigma = 8 + Math.sin((time * TAU) / 7 + g.x * 0.01) * 1.5;
```

Base 8, oscillates ±1.5. No per-panel blur control in the live app.

---

## The frosted-glass tuner (`tools/frosted-glass-tuner.html`)

A zero-dependency standalone HTML page. Open it directly in a browser — no dev
server needed. It provides:

- A phone mockup with 4 glass panels (timer, fold buttons, progress, phase
  notes), each with its own opacity + blur slider
- A canvas-based mock fermentation scene behind the panels
- Shared controls: edge stroke opacity, glass hue (espresso/honey/slate)
- Presets: "Legibility-tuned" (default), "All windows open", "Uniform frost"
- A live readout of the tuned values to port into the app code

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

- **Glass blur awaiting device test:** Build #6 (commit `d38c62b`) shipped
  the `saveLayer` approach, but **no build before July 11 2026 ever actually
  drew a glass panel** — card registration silently failed because
  `measureLayout` was given a `findNodeHandle` number, which the New
  Architecture rejects via the (previously empty) failure callback. The
  owner-visible symptom was "organisms draw over the panels": the cards are
  transparent, the missing Skia slab is the glass. Fixed by passing the
  container View ref itself; the next build is the FIRST real test of the
  saveLayer blur. See `docs/SKIA-HANDOFF.md` for the full chain.
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
