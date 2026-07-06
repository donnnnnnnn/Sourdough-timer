# Design handoff: main app icon — concept exploration

For: Claude Design session
From: the session on branch `claude/fold-tracking-notifications-panel-bhjcxd`

## The ask

Design the **main app icon** for Sourdough Timer and deliver **6–8 distinct
concept options** for the owner to choose from. The current icon
(`assets/images/icon.png`) is a placeholder — a flat amber disc on black — so
this is a from-scratch identity, not a refinement.

Three of the eight concepts below are **already implemented as rendered
1024px PNGs** (in `assets/images/app-icon-concepts/`) to make the
fermentation-storyboard direction concrete. Treat those as *starting points to
push further*, not finished art. The other five are written directions for you
to explore and render.

## What the app is (so the mark means something)

A calm, science-literate companion for timing sourdough bulk fermentation. Its
signature in-app visual is a **fluorescence-microscopy fermentation scene**
(`components/SkiaFermentationScene.tsx`, spec in
`docs/fermentation-art-spec.md`): luminous, semi-translucent microorganisms
glowing from within on espresso-black, composited with additive light —
**amber budding yeast**, **violet Lactobacillus rod-chains**, teal amylase,
red protease, rising **CO₂ bubbles**, and a glowing **gluten network**. The
brand feeling is **warm, artisan, calming — never clinical or "techy,"** even
though the imagery is microscopic.

The fermentation storyboard has named phases the icon can evoke: Autolyse →
Levain In → First Rise → **The Bloom** → **The Sweet Spot** → The Knife's Edge.

## Non-negotiable constraints for a *main app icon*

These differ from a notification icon — read carefully.

- **iOS** (`icon.png`): exactly **1024×1024**, **no transparency** (opaque
  square), **no rounded corners, no drop shadow** — the system masks to a
  squircle itself. Full-bleed art. Keep essential content out of the extreme
  corners (they get clipped).
- **Android adaptive** (`android-icon-foreground.png` +
  `android-icon-background.png`): two layers. The launcher masks the result to
  a circle / squircle / rounded-square **and** applies parallax, so **all
  meaningful content must sit inside the centre ~66% safe zone**; the outer
  ring is croppable margin. Provide foreground and background separately.
- **Android monochrome** (`android-icon-monochrome.png`): a **single-color
  silhouette** for Android 13+ themed icons. This is a real filter on concepts
  — the glow-heavy directions (Specimen, Bloom) **do not reduce cleanly to one
  flat shape**, while the literal ones (Jar, Boule, Wheat, Droplet) do. For any
  glow concept that wins, plan a simplified silhouette companion for this layer.
- **Legibility at 48–60px.** It ships on a home screen. Check every concept
  downscaled to ~48px (see the note on the Specimen below) and masked to a
  circle. Bold silhouette + strong value contrast survive; fine filaments
  don't.
- **Palette**: the warm artisan set in `components/theme.ts` /
  `fermentation-art-spec.md` — espresso `#171210`, honey/amber `#E8A33D`
  (core `#F0B95A`), cream `#F2E8DC`, violet LAB `#C9A8D6→#9b59ff`. Additive
  glow on near-black for the luminous concepts.
- **Cross-surface family:** the notification panel already uses a Cambro-tub
  "fold wheel" (`assets/images/fold-wheel/`). Bonus if the app icon rhymes
  with it, but it must stand on its own at 48px.

## The eight concepts

### Implemented (rendered previews in `assets/images/app-icon-concepts/`)

**1 — The Specimen** · `specimen.png`
Peak fermentation under the microscope: one hero **budding yeast cell**
(mother + daughter, bright membrane, white-hot nucleus) centre-frame, a
supporting colony of smaller cells, violet LAB rod-chains, rising CO₂ bubbles,
and faint organic gluten filaments behind. The purest expression of the app's
own visual language. *Strength:* gorgeous, unmistakably "living culture,"
detail-rich. *Watch-out:* at 48px the fine detail melts into a warm glow (see
`contact-sheet.png`) — it reads as a beautiful amber smudge rather than a
crisp mark. Best if the hero cell is pushed even larger/bolder, or reserved for
splash/about art with a simplified sibling for the home screen.

**2 — The Culture Jar** · `culture-jar.png`
A translucent **Cambro tub** with its lid, half-filled with slack domed dough,
the glowing microbe colony (yeast, violet LAB chains, CO₂, gluten) living
*inside* the dough. Directly ties the icon to the notification fold-wheel.
*Strength:* holds a recognizable silhouette even at 48px (the vessel shape
survives); on-brand and literal enough to be legible. *Watch-out:* the dough
body wants to be brighter/warmer so it reads as dough, not shadow; the vessel
outline is currently a little thin for a launcher mask.

**3 — The Bloom** · `bloom.png`
The most abstract: a warm bright core low-centre throwing an upward **fan of
CO₂ bubbles** — the "Bloom" phase distilled to pure energy and warmth.
*Strength:* calm, minimal, iconic; reads at any size. *Watch-out:* currently
the bubbles float a touch disconnected from the core — tie them together with a
faint rising motion/gradient so it reads as one gesture.

> Reproduce/iterate these with `node tools/generate_app_icon_concepts.mjs`
> (zero dependencies — additive float-buffer renderer, same light model as the
> Skia scene). Tweak the concept functions; it re-renders all three plus the
> legibility contact sheet in ~1.5s.

### Written directions (for you to render)

**4 — The Scored Boule**
The most literal, appetite-forward mark: a round loaf seen 3/4 or top-down with
a single honey-lit **scoring ear** curling open, warm crust gradient, a dusting
of flour. The "obviously a bread app" choice; reduces beautifully to a
monochrome silhouette. Risk: generic if not given a distinctive scoring
signature — make the ear/curl the memorable bit.

**5 — The Rising Dome** (fold-wheel promoted)
Take the notification panel's domed dough + honey progress ring and refine it
into the app icon for total cross-surface consistency. Risk: a progress ring is
odd on a *static* icon (it implies a fixed state), and it may read as
duplicate of the notification — consider dropping the ring to a full honey
halo, keeping just the domed dough in its vessel.

**6 — Wheat & Culture monogram**
A single curved **wheat stalk** embracing a glowing **culture droplet** — marries
craft (grain, the baker's craft) with science (the living microbe). Distinctive
asymmetric silhouette, works in monochrome, unlike anything else on a home
screen. Risk: two ideas fighting; keep one dominant.

**7 — The Sweet Spot droplet**
Extreme reduction, the Apple-minimal route: one perfect **honey droplet** with a
single interior CO₂ bubble and a glint of gluten highlight. One idea, stated
once. Scales to any size, monochromes trivially. Risk: could read as a generic
"water/honey" app — the interior bubble is what makes it fermentation.

**8 — Starter Surface (macro)**
A top-down macro of an **active starter's bubbling surface** — a warm, pocked
crater-field of gas holes catching honey light. Texture-forward, organic,
appetizing, and very different from the glowing-specimen concepts. Risk: at
48px a texture field can turn to mush — needs a few hero craters with strong
value contrast, not uniform stipple.

## Deliverables per chosen direction

For whichever concepts advance, produce the full launcher set and show them
*masked*:

- `icon.png` — 1024×1024, opaque, full-bleed (iOS).
- `android-icon-foreground.png` + `android-icon-background.png` — content in
  the centre 66% safe zone.
- `android-icon-monochrome.png` — single-color silhouette (Android 13+ themed).
- A **preview sheet** showing each concept masked to circle **and** squircle
  **and** rounded-square, at **1024px and at ~48px**, on both light and dark
  home-screen backdrops. The owner is non-technical — let them choose by
  looking, per the project's "show real output" rule (CLAUDE.md).

## Validation checklist (per CLAUDE.md)

- [ ] Show the owner rendered options (masked + at 48px) before finalizing.
- [ ] Each finalist reads at 48px and as a flat monochrome silhouette.
- [ ] Palette matches `theme.ts` / `fermentation-art-spec.md`; warm, not techy.
- [ ] No transparency in `icon.png`; safe-zone respected in the Android layers.
- [ ] Commit whatever generator/source produces the art, so it stays
      reproducible.
