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

Each `<GlassCard tint={n}>` scales the espresso-brown overlay opacity:

```typescript
// SkiaFermentationScene.tsx ~line 730
tintPaint.setColor(Skia.Color(`rgba(22,16,13,${clamp(0.44 * g.tint, 0, 0.92)})`));
```

- `tint=0` → fully transparent panel (the big timer clock)
- `tint=1` (default) → medium glass (0.44 opacity)
- `tint=1.5` → heavy glass (0.66 opacity, capped at 0.92)

Currently **none of the GlassCards in `index.tsx` pass a tint prop** — they
all use the default of 1. The tuner tool has per-window presets that were
designed before the cards shipped.

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
   (maps to the `0.44 * g.tint` multiplier in `drawGlassPanels`)
2. Blur → change the base sigma in `drawGlassPanels` (~line 711)
3. Glass hue → change the `rgba(22,16,13,...)` in the tintPaint (~line 730)
4. Edge stroke → change the `rgba(255,238,212,0.22)` in the edgePaint (~line 750)

The tuner's canvas scene is a simplified port of the real organisms — it's for
judging GLASS legibility over a busy background, not a pixel-match.

---

## Open work / known gaps

- **Glass blur awaiting device test:** Build #6 (commit `d38c62b`) shipped
  the `saveLayer` approach. As of this writing it has not been confirmed
  on-device. See `docs/SKIA-HANDOFF.md` → "If build #6 STILL shows no blur"
  for next-step instructions if it fails.
- **`contentTop` is never wired up:** `setContentTop()` exists in
  `glassStage.ts` but is never called. Works today because the Skia canvas
  and ScrollView share a parent origin. A future layout change (status bar
  inset, header) will silently break panel positioning.
- **No per-panel blur:** The tuner supports per-panel blur, but the live app
  uses a single shared sigma. To add per-panel blur, store it in
  `GlassRegistration` (like `tint`) and read `g.blur` in `drawGlassPanels`.
- **Tint values not yet dialled:** All three GlassCards use the default
  `tint=1`. The tuner's presets suggest different values per panel — port them
  once the blur is confirmed working on-device.

---

## Branch history (for context, not action)

| Branch | Status | What |
|--------|--------|------|
| `claude/fullscreen-animation-skia-n05wo4` | **active** | Fullscreen scene + glass panels + tuner |
| `claude/microbial-animation-background-5p7qf7` | merged concepts | Original tuner + full-bleed experiment |
| `claude/animation-enrichment` | merged into active | Richer organism visuals |
| `claude/skia-fix` | merged into main | The worklet crash fix |
| `claude/skia-ui-thread` | parked | UI-thread worklet variant (crashes on current deps) |
