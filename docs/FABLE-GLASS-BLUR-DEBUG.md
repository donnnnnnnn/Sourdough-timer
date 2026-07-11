# Glass Blur Rendering Issue — Fable Debug Handoff

## Problem Statement

On-device (Pixel 9), the frosted-glass panel blur is not rendering. The animated particle scene renders directly on top of UI buttons with **zero translucency or blur** — as if the glass panel overlay logic is broken or the image filter never executes.

Expected: Three frosted-glass UI cards (opaque containers with blurred particle scene visible through them).
Actual: Particle scene renders at full opacity on top of buttons; cards are invisible or fully opaque.

## Architecture

```
SkiaFermentationScene (1314-line Skia picture)
├── drawParticles()    ← animated point cloud
├── drawGlow()         ← radiant background
└── drawGlassPanels()  ← glass overlay + blur — **NOT WORKING**

GlassCard.tsx (×3)
├── Measures itself on-screen
└── Registers position with glassStage module-level registry

glassStage.ts
├── screenRects()      ← returns {x, y, w, h, radius, tint, blur} per card
└── Called each frame by Skia scene
```

## Files

| File | Purpose |
|------|---------|
| `components/SkiaFermentationScene.tsx` | Skia GPU scene. `drawGlassPanels()` at ~line 699. |
| `components/GlassCard.tsx` | React wrapper that measures & registers cards. |
| `components/glassStage.ts` | Module registry: cards write positions, scene reads them. |
| `app/(tabs)/index.tsx` | Three GlassCard instances with `tint`/`blur` props. |

## The Blur Implementation (drawGlassPanels, ~line 699)

```typescript
const sigma = g.blur !== null
  ? g.blur
  : 8 + Math.sin((time * TAU) / 7 + g.x * 0.01) * 1.5;

// Forward image filter approach (NOT backdrop filter):
const blurPaint = Skia.Paint();
blurPaint.setImageFilter(
  Skia.ImageFilter.MakeBlur(sigma, sigma, Skia.TileMode.Clamp)
);

canvas.save();
canvas.clipRRect(
  Skia.RRectXY(
    Skia.XYWHRect(g.x, g.y, g.w, g.h),
    g.radius,
    g.radius
  )
);

// Open a layer with the forward blur filter
canvas.saveLayer(blurPaint, null);

// Redraw the particle scene clipped to this panel
// (drawParticles & drawGlow calls here — omitted for brevity)

canvas.restore(); // restore the layer
canvas.restore(); // restore the clip
```

## Device Failure Symptom

The particles render **above** the glass cards instead of **behind** them with blur applied. The blur filter either:
1. Never executes (image filter is null or invalid)
2. Executes on an empty layer (particles aren't inside the saveLayer call)
3. Renders behind the UI native view instead of in front

## Critical Constraints (DO NOT VIOLATE)

1. **NO `'worklet'` directives** — the Babel plugin breaks function hoisting; helpers referenced later become `undefined`.
2. **JS-thread animation only** — requestAnimationFrame → `createPicture` in `useMemo`. NO `useClock` + reanimated worklets (crashes on Skia 2.6.2 + reanimated 4.3).
3. **NO backdrop filters** — `<BackdropBlur>`, offscreen SkSurface snapshots, and `saveLayer` with destination-sampling all made the native surface render above UI. The forward filter approach is the only one that worked in testing.

## What to Debug

1. **Is `screenRects()` returning valid panel positions?**
   - Log `g.x`, `g.y`, `g.w`, `g.h` in `drawGlassPanels()`.
   - Verify they're in screen-pixel coordinates (not NaN or off-screen).

2. **Is the clip/layer setup correct?**
   - Try omitting the blur filter entirely: `canvas.saveLayer(null, null)` and redraw particles inside.
   - If particles appear *inside* the panel bounds with no blur, the layer is working and the filter is the culprit.
   - If particles still render on top, the clipping or layer nesting is broken.

3. **Is the image filter valid?**
   - Try a different filter: `MakeColorFilter`, `MakeDropShadow`.
   - Log whether `Skia.ImageFilter.MakeBlur()` returns null.

4. **Is particle rendering inside or outside the saveLayer call?**
   - The `drawParticles()` and `drawGlow()` calls must happen *between* `canvas.saveLayer()` and `canvas.restore()`.
   - Check the call order in `drawGlassPanels()`.

5. **Coordinate system:**
   - `screenY = contentTop + contentY - scrollY` (verify `setContentTop()` was called in `index.tsx`).
   - If contentTop is wrong, panel positions will be off-screen and the layer will be empty.

## Repo State

- Branch: `claude/sourdough-fullscreen-animation-afn6am`
- Build: APK built successfully; installed on device.
- Animation: Particles render; glass cards measure correctly; blur does not execute.
- TypeScript: `npx tsc --noEmit` passes.

## Test Procedure

1. Install APK on a Pixel/Android device.
2. Open the timer screen (tab 1).
3. Verify three glass cards are visible: Kitchen temperature, Bulk progress, Dough story.
4. Check if the particle scene behind them is blurred/translucent or sharp/opaque.
5. Add debug logs or swap blur strategy as needed.

---

**Non-biological element names for this handoff:**
- Organisms → particles
- Fermentation glow → background radiance
- Crumb structure → scene geometry
- Bulk stage → scene state
- Kitchen temp / Bulk progress / Dough story → Panel 1 / Panel 2 / Panel 3
