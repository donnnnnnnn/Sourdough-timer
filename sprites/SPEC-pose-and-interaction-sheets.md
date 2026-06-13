# Sprite Sheets: Organisms, Poses, and Gluten Parts

## Three source sheets:

### 1. **sheet.png** (1254×1254, organisms & biochemistry)
- **Row 1:** yeast, LAB rod chain-2, LAB rod chain-3
- **Row 2:** amylase enzyme, protease enzyme, acetic acid molecules
All painted as fluorescent confocal microscopy subjects on pure black background, additively composited.

### 2. **sheet2.png** (1254×1254, alternative poses & states)
Same 6 entities in different orientations/internal states for variety and animation frame-blending.

### 3. **gluten_parts.png** (1254×1254, gluten network)
**Row 1:**
- *Cell 1:* Healthy junction node — gold/amber starburst, bright core, 6–8 radial filaments
- *Cell 2:* Strand segment — straight, tube-like, orange/amber glow, uniform brightness
- *Cell 3:* Frayed/snapped end — intact filament + dissolving wisps, shows tension/breaking

**Row 2:**
- *Cell 1:* CO₂ bubble — cyan-rim sphere, dark interior, thin bright edge like gas inclusion
- *Cell 2:* Starch granule — lobed ovoid, dim grey-blue, low glow, chalky surface
- *Cell 3:* Stressed junction node — same as healthy but 2–3 radial filaments dimmed, core slightly orange-red

## Usage in seamless engine

Each sprite is extracted as a fractional rectangle from its sheet and blitted onto one of two 720×480 canvases:

- **Left canvas:** interactive — scrub a slider to freeze at any fermentation stage (t=0→1), organisms still drift in real time
- **Right canvas:** 2-minute auto-loop of the full t=0→1 cycle

All motion is **continuous** and **persistent**:
- Population is generated once at startup with seeded random, each entity has a fixed birth time and role
- Everything is driven by a single unified fermentation clock (t)
- No frame-swaps or animation states — smoothstep easing on alpha/scale/position
- Gluten network builds from junction nodes + strand connectors that render under all organisms
- Protease emerges late, damages junctions on schedule, strands fray crossfading between intact↔severed sprites
- CO₂ bubbles inflate then pop; starch fades as amylase consumes it; acid haze reddens the background
- Six organism types (yeast, 2×LAB, amylase, protease, acetic acid) each with lifespan and emergence timing

## Technical details

- All backgrounds pure black (#000000) for clean compositing
- Additive blending (`globalCompositeOperation: 'lighter'`) — glows layer naturally
- Fractional region coordinates allow sub-pixel accuracy without re-exporting
- Persistent random seed ensures the same population layout every session
- Wall-clock time (requestAnimationFrame) keeps organisms drifting smoothly independent of the fermentation-stage slider
