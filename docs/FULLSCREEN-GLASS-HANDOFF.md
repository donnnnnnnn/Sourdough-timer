# FULLSCREEN GLASS HANDOFF — immersive Skia backdrop + frosted-glass UI

**Goal of this pass:** make the fermentation animation a true fullscreen
"microscope projection" behind the timer screen, and float the controls on top
as frosted-glass panels the animation shows *through* — the smooth, glowing,
lifelike look the owner asked for. Skia is KEPT (it was never actually the
problem — see below).

**Owner is non-technical.** Explain choices plainly and prove the look with an
on-device screenshot/recording — a green build proves nothing about how it looks.

---

## The Skia decision (read first — it reverses an earlier assumption)

An earlier handoff floated "ditch Skia." We did NOT, and shouldn't:

- The launch crash was **never Skia's fault.** Root cause was `'worklet'`
  directives breaking JS function hoisting (full writeup in
  `docs/SKIA-HANDOFF.md`). With those removed, the Skia scene renders and
  animates on the owner's device.
- Skia is what gives the smooth additive **glow** and unlocks the sophisticated
  effects (breathing, real gaussian blur) that the pure-JS `FermentationScene`
  can't do. So the enriched Skia scene (`components/SkiaFermentationScene.tsx`,
  from `claude/animation-enrichment`) is the foundation here.

### Why the frosted glass is drawn *inside* Skia (not expo-blur)

We evaluated `expo-blur` and rejected it, with evidence:

- Skia renders its canvas into an Android **TextureView** (confirmed in the
  2.6.2 native source: `SkiaBaseView` → `new SkiaTextureView`).
- `expo-blur` on Android is the Dimezis BlurView library, which **cannot blur
  TextureView content below Android 12, and never blurs SurfaceView content**
  (documented limitation). So the "frosted glass" would blur *nothing* on many
  devices — a grey smudge with no organisms showing through, discovered only
  after a 20-min build, and different per phone.
- Skia 2.6.2 can blur its OWN content deterministically. `SkCanvas.saveLayer`
  accepts a **backdrop image filter** (verified in the 2.6.2 typings), so we
  draw each glass panel *in the same canvas, after the organisms*, sampling and
  blurring exactly the pixels beneath it. Guaranteed correct compositing, and
  we control the whole glass recipe (blur + warm tint + top sheen + edge).

## What shipped this pass

1. **Fullscreen backdrop.** `app/(tabs)/index.tsx` now renders ONE
   `SafeSkiaFermentationScene` as an `absoluteFill` layer behind a transparent
   `ScrollView`. The scene mode is derived once at the screen level:
   `bulk` while active, `autolyse` while resting, else `idle`. The three old
   per-section inline scenes were removed.
2. **In-canvas frosted glass.** `drawScene` now (a) group-dims the organisms via
   a layer alpha — baked in, replacing the old declarative `<Group opacity>` —
   then (b) draws `drawGlassPanels()` on top: for each registered UI card it
   clips a rounded rect, `saveLayer` with a `MakeBlur` backdrop (radius gently
   breathes), then paints a warm espresso tint, a top-down sheen gradient, and a
   hairline bright edge. NORMAL blend (not the organisms' additive blend), so it
   mutes the glow into a legible pane.
3. **Position plumbing (`components/glassStage.ts` + `GlassCard.tsx`).** A
   `GlassCard` renders a transparent rounded container (with an RN hairline
   border as a fallback look) and registers its on-screen rect via
   `measureLayout` against the scroll content container — a scroll-INDEPENDENT
   position. `glassStage` combines it with the live scroll offset
   (`screenY = contentTop + contentY − scrollY`, `contentTop = 0` because the
   scene and the scroll content share the root origin). The scene reads
   `screenRects()` once per animation frame (~30fps), so panels track scrolling
   with **no** scroll-triggered React re-render. Re-measures on scroll-settle
   (`measureTick`) to self-correct drift.
4. **Cards converted so far:** temp coach, bulk progress, dough story (the
   text-heavy ones where legibility over the animation matters most).

## Verified here (static only — NO device yet)

- `npx tsc --noEmit` passes.
- Worklet-safety Babel check on the scene: `__closure: 0 | __workletHash: 0 |
  drawScene hoisted: true` (the hard constraint that caused the original crash).

## MUST verify on device (the whole point)

1. **Does the backdrop-blur actually blur** the organisms beneath each panel?
   This is the one real risk: the glass `saveLayer(..., backdrop)` is recorded
   inside an `SkPicture` (via `createPicture`) and replayed onto the GPU canvas.
   Backdrop filters sample the destination at *playback*, so it should work —
   but confirm on the phone. **If panels show tint+border but NO blur**, move
   the glass out of the recorded picture into declarative siblings after the
   `<Picture>`: `<BackdropBlur blur={..} clip={rrect}>` (Skia 2.6.2 exports it),
   fed the same `screenRects()`. Everything else stays.
2. **Do the glass panels line up** with the cards, at rest and while scrolling?
   Watch for vertical offset (coordinate origin wrong) or lag during fast flings
   (30fps position update). Soft edges hide small lag; a constant offset means
   the `contentTop`/`measureLayout` base is off.
3. Legibility + smoothness: is text readable over the tint? Any frame drops from
   the extra `saveLayer`s? Tune `sigma`/tint in `drawGlassPanels`, or reduce the
   number of glass cards.

## HARD CONSTRAINTS (unchanged — violating any reverts weeks of debugging)

1. **NEVER add `'worklet'` directives** to the scene's draw functions
   (`docs/SKIA-HANDOFF.md`). Re-run the Babel check after any scene edit.
2. **Do not bump `@shopify/react-native-skia`** (pinned 2.6.2).
3. **Keep the JS-thread rAF clock.** Optimize draw cost, don't reach for worklets.
4. **Keep `SafeSkiaFermentationScene`** wrapping the scene (on-device error trace).
5. **Don't edit the fermentation model** to serve visuals; derive from `st`.

## Follow-ups (next device iteration)

- Convert the remaining cards / hero timer block to `GlassCard` once the effect
  is confirmed on device (don't batch blindly — prove one, then extend).
- Consider a subtle in-canvas grain/noise shader in the glass for extra realism.
- Depth-of-field: draw a few dim, extra-blurred out-of-focus organisms behind
  the sharp ones for more "real microscope" depth (cheap, high impact).

## Pointers

- Fullscreen wiring + card conversions: `app/(tabs)/index.tsx`
- Scene + glass drawing: `components/SkiaFermentationScene.tsx` (`drawGlassPanels`)
- Glass position registry: `components/glassStage.ts`
- Glass card wrapper: `components/GlassCard.tsx`
- Why Skia/worklet rules exist: `docs/SKIA-HANDOFF.md`
- Enrichment background: `docs/ANIMATION-ENRICHMENT-HANDOFF.md`
