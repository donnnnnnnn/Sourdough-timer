# Session handoff — frosted-glass timer redesign

**Purpose:** this file is the entire briefing a fresh Claude Code session needs
to keep refining the timer screen's full-bleed animated background and
frosted-glass panels, without replaying prior conversation. It is a **living
document** — see "Keeping this doc current" below.

**Last updated:** 2026-07-06, end of the session that shipped the full-bleed
background + Glass panels (`32fb1f9`).

**Note:** there is a *different* `docs/SESSION_HANDOFF.md` on the sibling
branch `claude/fold-tracking-notifications-panel-bhjcxd`, covering unrelated
work (notification panel, app icon concepts). That branch and this one
diverged before either had a handoff doc, so the two docs don't know about
each other yet. Don't conflate them — merge/reconcile only if a session
actually merges those branches.

## Branch & PR state

- All work described here is on `claude/microbial-animation-background-5p7qf7`
  in `donnnnnnnn/Sourdough-timer`, pushed and up to date with origin.
- **No PR exists yet** (checked `list_pull_requests` — empty, both open and
  closed). Before opening one, re-check, since this doc will go stale the
  moment that changes.
- Branched from `origin/main` at the PR #9 merge (crumb-diagnosis feature);
  `main` has not moved since, so no rebase conflict expected yet.

## The goal (owner's own words, paraphrased)

Now that the microbial fermentation animation runs on an engine that supports
transparency, make it fill the **entire background of the timer screen**, with
**frosted-glass** buttons/text panels over it — legible, but with the microbes
and gluten network "shining through just enough." The owner explicitly
expects the animation to keep growing more complex/lifelike, and wants a fast
way to re-tune the glass without a full dev-build round-trip each time.

## Key finding from this session (don't re-investigate)

There are **five** fermentation-animation branches/implementations in this
repo. Only **one** can render with a transparent background:

| Branch | Engine | Transparent? |
|---|---|---|
| `origin/main` / this branch — `components/FermentationScene.tsx` | pure-JS `View`s, translucent `rgba()` fills + `boxShadow` glow, `pointerEvents="none"`, no background fill | **Yes** — this is the one in use |
| `claude/animation-enrichment` | Skia, JS-thread clock | No — hardcoded `backgroundColor: 'black'`, additive `BlendMode.Plus` |
| `claude/skia-fix` | Skia, JS-thread clock | No — same |
| `claude/skia-ui-thread` | Skia, UI-thread worklets | No — same |
| `claude/microbial-animation-visuals-cgn6eh` | Skia, UI-thread worklets | No — same |

All four Skia branches bake in "additive glow over pure black" as the house
style (see `docs/fermentation-art-spec.md`) — making them transparent isn't a
config flip, it's a rewrite of every draw call's blend model. **Do not try to
adopt a Skia branch for this feature.** If the Skia crash ever gets fixed
(`docs/SKIA-HANDOFF.md`) and someone wants its richer motion *and*
transparency, that's a new art-direction effort, not a swap-in.

## What shipped this session

### 1. Full-bleed background (`app/(tabs)/index.tsx`)

`FermentationScene` now mounts **once**, absolutely-positioned behind the
entire screen (idle, autolyse, and bulk states alike), instead of once per
section. Mode is computed centrally:

```ts
const bgMode: SceneMode = isActive ? 'bulk' : autolyseRunning ? 'autolyse' : 'idle';
...
<FermentationScene mode={bgMode} fraction={isActive ? sceneFraction : 0} />
```

placed as the first child inside the screen's outer `flex:1` `View`, before
the `ScrollView` — later siblings paint on top in RN, and the scene's own
`pointerEvents="none"` lets touches pass through to the ScrollView content
below it.

### 2. `components/Glass.tsx` — reusable frosted panel

```ts
<Glass variant="hero" | "folds" | "progress" | "caption" style={...}>
  {children}
</Glass>
```

Wraps `expo-blur`'s `<BlurView>` + a tint `View` + an optional border, keyed
by a `variant` that looks up `glass` tokens in `components/theme.ts`. Any new
panel just needs a `Glass` wrapper and a variant name — see below for adding
one.

### 3. `glass` tokens in `components/theme.ts`

Values below were tuned **by the owner's own hand** in the design tool (see
next section), then read off and ported verbatim:

| Variant | Used for | Tint | Blur px (tuner) | `intensity` (expo-blur) |
|---|---|---|---|---|
| `hero` | timer digits | `rgba(23,18,16,0)` (none) | 0 | 0 |
| `folds` | fold-status card (all 3 states) | `rgba(23,18,16,0.40)` | 2 | 7 |
| `progress` | bulk-progress card | `rgba(23,18,16,0.03)` | 4 | 13 |
| `caption` | phase science/sensory notes | `rgba(23,18,16,0.04)` | 9 | 30 |

- Tint color `rgb(23,18,16)` is exactly `C.bg` (`#171210`) — the app's
  espresso ground.
- Border is exactly `C.cardBorder` (`rgba(255,228,196,0.10)`) for all
  variants except `hero`, which has **no border and no top-edge sheen** — the
  owner explicitly asked for the timer to read as "a clean opening onto the
  colony," not a framed panel.
- **The `intensity` conversion is an unverified guess**:
  `intensity = round(blur_px / 30 * 100)`, because the tuner's blur slider
  ran 0–30 (a CSS `backdrop-filter: blur(Npx)` value) and expo-blur's
  `BlurView` takes a 0–100 `intensity` that isn't the same unit or curve as a
  CSS blur radius. **This has never been seen on a real device.** If the
  glass looks too sharp or too smeared once the owner runs a dev build, this
  formula — not just the raw tuned numbers — is the first thing to revisit.

### 4. Windows converted to `Glass` (and which weren't, on purpose)

Converted: the hero timer block, `PhaseCaption` (shared by both the autolyse
and bulk phase-note cards), the bulk-progress card, and all three branches of
the fold-status card (`foldsComplete` / `foldIsLate` / next-fold countdown).

**Deliberately left opaque `C.card`** (out of scope this pass, not an
oversight):
- The honey-accent "tap to record a fold" CTA (`Springy`) and the red "End
  Bulk & Shape" button — these are solid, saturated call-to-action buttons,
  a different design role than an information window over the colony.
- "Dough story" card, `RiseTracker`.
- On the idle/autolyse screens: the "Kitchen temp" coach card, the autolyse
  duration picker card, the "Autolyse first" pill. These now sit in front of
  the full-bleed scene (it runs behind them) but are still fully opaque — if
  the owner wants the frosted look consistent across the whole screen, these
  are the next candidates, using the same `Glass` component and picking (or
  tuning) a variant for each.

### 5. `expo-blur` dependency

Added at `~56.0.3` — confirmed via `npm view expo-blur versions` to be the
newest **stable** release in the SDK 56 line (56.0.4+ only exists as
canary/prerelease, don't use those). No config plugin needed (it's a pure
view wrapper, confirmed by the absence of `app.plugin.js` in the installed
package). **Like the notification panel, the blur effect only renders in a
dev build — it will not appear in Expo Go.**

## The design tool — `tools/frosted-glass-tuner.html`

A standalone, zero-dependency HTML file (open directly in any browser, no
build step) that's a **faithful mockup, not the real engine**: a phone-frame
preview of the bulk-fermenting timer with a **canvas reimplementation** of the
organism cast (yeast, LAB rods, amylase, gluten lattice, CO₂ bubbles) running
full-bleed, and the same four frosted panels with live sliders.

**Controls:** per-window opacity + blur sliders (one row per variant above),
shared edge-stroke and tint-warmth controls, a ferment-phase scrubber (drag
to preview the colony from calm → peak → collapsed), a brightness slider, and
three presets. The **readout box** prints exact tint/blur/border values to
port into `theme.ts`.

**Reopen this whenever the real animation grows busier and the glass needs
re-judging.** Workflow: adjust sliders while watching the ferment-phase
scrubber at its busiest, copy the readout, paste the four lines into a
message, and a session can port them into `components/theme.ts` in under a
minute (see the table above for the direct mapping — tint alpha is used
as-is, blur px needs the `/30*100` intensity conversion, or a corrected
formula once verified on-device).

### ⚠️ Known gap: the tuner's gluten lattice was never ported to the real engine

Mid-session, the owner said the gluten network "looked scattershot" in the
tuner. It was rebuilt there as an **imperfect scaffolding lattice** — nodes on
a jittered 5×9 grid, linked horizontally/vertically with ~10% of strands
missing and sparse diagonal cross-braces, organizing/fraying with ferment
phase. **This fix only exists in `tools/frosted-glass-tuner.html`'s canvas
code.** The real app's gluten rendering — `GLUTEN_MESH` array and
`GlutenStrand` component in `components/FermentationScene.tsx` (search those
two names) — is **untouched** and still uses its original hand-placed strand
list. If the owner likes the scaffolding-lattice look in the tuner and wants
the real app's gluten to match, that's separate follow-up work: port the
grid-generation approach (or something inspired by it) into
`FermentationScene.tsx`'s actual React Native rendering, not just the web
preview.

## Validation status

- `npx tsc --noEmit` passes clean (verified this session, after a fresh
  `npm install` — this repo's `node_modules` isn't checked in and wasn't
  present at session start).
- **Not verified:** actual on-device appearance. No screenshots, no dev-build
  run. Per this project's own hard-earned lesson (see CLAUDE.md and
  `docs/SKIA-HANDOFF.md`), a green type-check is not evidence of a working
  feature — the owner needs to run a dev build and look at the real screen
  before this is "done." Flag this explicitly; don't claim it looks right.

## Open questions for the owner, worth asking early in a new session

1. Did you get a chance to run a dev build? Does the blur intensity feel
   equivalent to what you tuned in the HTML preview, especially on
   `progress` (0.03 tint) and `caption` (0.04 tint) — the two panels relying
   almost entirely on blur, not tint, to stay legible?
2. Do you want the remaining opaque cards (dough story, rise tracker, the
   idle/autolyse cards) brought into the frosted treatment too, or left as
   solid panels on purpose?
3. Do you want the real gluten network in `FermentationScene.tsx` updated to
   match the scaffolding-lattice look now living only in the tuner?

## Keeping this doc current — protocol for every session

**Any session working in this repo** must do the following whenever the
owner asks to "hand off," "hand off to a new session," or similar:

1. Update this file — rewrite the sections above to reflect current reality:
   what shipped, what's mid-flight, what decisions are still open, current
   branch/PR state. Don't just append — edit stale sections so the doc never
   grows into a changelog.
2. Commit the updated doc with the rest of the session's work (don't leave it
   as an uncommitted dangling edit) and push.
3. Keep this file lean — a state snapshot, not a full design history. Cut a
   section once it's no longer relevant rather than appending a correction.

This protocol is also stated in `CLAUDE.md` — if the two ever disagree, trust
this file for design-specific detail and `CLAUDE.md` for the general rule.
