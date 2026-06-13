# Sourdough Fermentation — Alternative Poses & Interaction Storyboards

A generation spec for ChatGPT (image model). This expands the existing
specimen sheet into (A) alternative poses so a population doesn't look cloned,
(B) interaction storyboards between organisms, and (C) a gluten-network
lifecycle from organizing → strengthening → stressed → degraded.

---

## 0. House style — MUST match the existing sheet exactly

Everything is rendered as **fluorescence-microscopy / confocal imaging**:
luminous, semi-translucent specimens that glow from within, fine filamentous
internal structure, soft bloom around bright edges, subtle specular highlights.

NON-NEGOTIABLE technical constraints (the app composites these additively):

- **Pure black background (#000000).** No gradients, no vignette, no dark-grey
  haze, no border. Black must be *truly* black because the engine uses additive
  blending (`globalCompositeOperation = "lighter"`) — any non-black background
  will show up as a glowing rectangle.
- **One specimen per grid cell, centered,** with empty black margin around it so
  it can be sliced cleanly. Do NOT let glow from one cell bleed into the next —
  leave a dark gutter (~8–10% of cell width) between specimens.
- **Square canvas, 3 columns** unless a sheet says otherwise. Tell me the exact
  pixel grid you used so I can calibrate the slicer.
- Keep the established palette per organism (below). Same hue, same glow.

### Palette (locked)

| Organism | Color | Notes |
|---|---|---|
| Yeast (S. cerevisiae) | warm **amber/gold** (#F0B95A core, white-hot highlights) | ovoid cell, visible nucleus/vacuole, granular cytoplasm |
| LAB rods (Lactobacillus) | **violet/magenta** (#C9A8D6 → #9b59ff) | bead-like rods in chains, bright poles |
| Amylase (enzyme) | **teal/cyan** (#6FB8A8 → #14e0c8) | toroidal/ring molecule, knobby surface |
| Protease (enzyme) | **red/crimson** (#E58C76 → #ff3b30) | lobed globular enzyme, clustered subunits |
| Acetic acid (molecule) | **yellow-green** (#9FB36B → #c8ff3b) | small ball-and-stick molecule |
| Gluten network | **orange/amber** (#E8A33D) | filamentous strands, glowing junction nodes |

---

## SHEET A — Alternative poses (so the population isn't obviously cloned)

3-column grid. Generate these cells. Each is a single specimen on black.

### Yeast (amber) — a budding/life-stage series
1. **Quiescent single** — one plump ovoid, calm even glow, one faint bud scar.
2. **Early bud** — a small daughter cell bulging from one pole, neck still
   narrow, both lit.
3. **Mother + daughter pair** — daughter nearly full size, bright cytoplasmic
   bridge between them, a couple of ring-shaped bud scars on the mother.
4. **Budding cluster** — 3–4 cells in a small grape-like clump at different bud
   stages (this is what a thriving colony looks like at peak).
5. **Late / starved cell** — slightly shrunken, dimmer, more granular, a vacuole
   enlarged — reads as "past its prime." Same hue, lower brightness.

### LAB rods (violet) — a fission/chain series
6. **Single rod** — one bean, bright poles.
7. **Doublet** — two rods end-to-end (already have this; regenerate to match).
8. **Triplet** — three rods (already have this).
9. **Long chain** — 4–5 rods, gently curved, the classic active-colony look.
10. **Mid-division rod** — one rod with a visible constriction/septum pinching
    the middle (binary fission caught in the act).

### Amylase (teal)
11. **Resting toroid** — the ring, calm glow (already have).
12. **Active toroid** — brighter, faint cyan sugar-specks being flung off its
    rim (it's cleaving starch into sugar).

### Protease (red)
13. **Resting blob** — compact, lobed (already have).
14. **Hyperactive protease** — larger, more lobes splayed open, hotter core —
    this is the late-stage, acid-activated form that shreds gluten.

### Acetic acid (yellow-green)
15. **Single molecule** — ball-and-stick (already have).
16. **Acid burst** — a small tight cluster of 3–4 molecules with a shared glow,
    used where acidity is concentrating.

---

## SHEET B — Interaction storyboards (2–4 panels each, read left→right)

Each storyboard is a short horizontal strip. Keep each panel a clean black
square so panels can also be sliced individually if needed. These show RELATIONS
between specimens — the cooperative and antagonistic chemistry of the dough.

### B1. Cross-feeding: amylase → microbes (the food chain)
The cooperative heart of sourdough. Amylase frees sugar from starch; yeast and
LAB eat it.
- Panel 1: a teal **amylase** docked against a pale, chalky **starch granule**
  (dim grey-blue lobed mass — the ONLY non-pure-color object; keep it low-glow).
- Panel 2: amylase rim flares; tiny **gold maltose specks** spray off into the
  black.
- Panel 3: a gold **yeast** and a violet **LAB rod** on the right side, sugar
  specks drifting toward them, their cores brightening as they take up the sugar.

### B2. Yeast budding + CO₂ (leavening)
- Panel 1: single amber yeast, calm.
- Panel 2: a daughter bud swelling at one pole; a few faint **CO₂ micro-bubbles**
  (thin-rimmed dark circles with a bright edge) releasing nearby.
- Panel 3: mother + full daughter; a small cloud of CO₂ bubbles rising — this is
  the gas that inflates the gluten.

### B3. LAB fission + acidification
- Panel 1: a violet rod with a central septum.
- Panel 2: it has split into two; faint **yellow-green acid molecules** budding
  off the chain.
- Panel 3: a longer chain, with a thin yellow-green haze beginning to tint the
  surrounding field (pH dropping).

### B4. Protease attacks gluten (the antagonist — KEY STORYBOARD)
- Panel 1: a taut, bright orange **gluten strand** running across frame; a red
  **protease** approaching from below.
- Panel 2: protease **clamped onto the strand**; the strand's glow dims right at
  the contact point (a junction node going dark).
- Panel 3: the strand **severed** — two frayed, recoiling ends with sparks/loose
  filaments where the bond broke; protease drifting to the next strand.

### B5. Acidity activates protease (why late fermentation falls apart)
- Panel 1: a calm, dim red protease in a neutral (un-tinted) field.
- Panel 2: yellow-green acid haze washes in; the protease brightens and its lobes
  open (waking up at low pH).
- Panel 3: now-hyperactive protease moving toward a gluten strand — links the
  acid cause to the gluten-damage effect.

---

## SHEET C — Gluten network lifecycle (the dough's structure over time)

This is its own sheet — a 4-stage progression of the SAME patch of network, so
the app can crossfade between them. Wide cells (network is horizontal-ish).
Orange/amber filaments with brighter glowing **junction nodes** where strands
cross-link. Render on pure black.

### C1. Organizing (early autolyse / start of bulk)
Loose, tangled, dim filaments — a disordered web. Few junction nodes, weak glow.
Some slack/wavy strands. Reads as "hydrated but not yet developed."

### C2. Strengthening (active fermentation — the network at its best)
Strands have **aligned into a lattice**, noticeably thicker and brighter.
Junction nodes glow hot (cross-links forming). A few **CO₂ bubbles inflating
cells** within the mesh — the strands stretch taut around them but HOLD; the
network is springy and gas-tight. This is peak structure. Acidity has tightened
it (subtle: a faint cool tint at the strands is fine).

### C3. Stressed (late fermentation — protease starts winning)
The lattice is still mostly intact but under attack: a few **protease (red)
enzymes docked on strands**, junction nodes near them **dimmed or dark**, some
strands **thinning** and starting to fray. One or two bubbles have grown large
and pushed strands into a sagging, over-stretched arc. A yellow-green acid haze
pervades the field. Reads as "still standing but starting to give."

### C4. Degraded / over-fermented (collapse)
The network has lost integrity: strands **snapped and recoiled**, frayed loose
filaments everywhere, junction nodes mostly extinguished, the lattice slumped and
disconnected. A big bubble has **ruptured/coalesced** (the gas escaped — no more
lift). Several protease enzymes scattered through the wreckage, still glowing
hot. Overall dimmer and warm-red-tinted (acidic, slack, sticky dough). This is
the visual of an over-proofed loaf that won't hold its shape.

---

## Output format requested

1. **Sheet A** as one square PNG, 3 columns, pure black bg, one specimen per
   cell, dark gutters. Tell me the pixel grid.
2. **Sheet B** as five separate horizontal strip PNGs (B1–B5), or one tall PNG
   with each storyboard on its own row — either is fine, just keep panels on
   pure black with dark gutters and tell me the layout.
3. **Sheet C** as one PNG, the four stages in a row (or 2×2), wide cells, pure
   black bg.

If a specimen is hard to fit the "pure black, one-per-cell, no bleed" rule,
prefer MORE black margin over a tighter crop — I can always trim, but I can't
recover specimens whose glows have merged.
