# Session handoff — app design (notification panel, icons, visual identity)

**Purpose:** this file is the entire briefing a fresh Claude Code session needs
to keep working on the app's visual design — the persistent notification
panel, its artwork, and the main app icon — without replaying prior
conversation. It is a **living document**: see "Keeping this doc current"
below for the update protocol.

**Last updated:** 2026-07-06, end of the app-icon-concepts commit
(`6a3db9f`), by the session that built the notification panel.

## Pasteable prompt to start a new session

Copy this verbatim as the first message to a fresh Claude Code session (in
this repo, on branch `claude/fold-tracking-notifications-panel-bhjcxd`) to
resume this thread of work:

> Read `docs/SESSION_HANDOFF.md` in full before doing anything else — it's
> the complete briefing for the app-design thread (notification panel, icons,
> visual identity). Also skim `CLAUDE.md`'s "Handoff protocol" section. Once
> you've read both, summarize back to me in a couple of sentences what's
> shipped and what's still an open decision, then wait for my instructions —
> don't start making changes yet.

Keep this prompt in sync with the file it points to — if `SESSION_HANDOFF.md`
ever gets renamed or the branch changes, update this block in the same
commit.

## Branch & PR state

- All work described here is on `claude/fold-tracking-notifications-panel-bhjcxd`
  in `donnnnnnnn/sourdough-timer`, pushed and up to date with origin.
- **PR #6** was opened for this branch and **closed without merging**
  (closed ~10s after creation — looks accidental/automated, not a real
  rejection). No PR is currently open. Before opening a new one, check
  `mcp__github__list_pull_requests` for this branch's current state, since
  this doc will go stale the moment that changes.
- `main` is far ahead in commit count on unrelated work (CI/EAS config) —
  this branch was cut from `main` before that, so expect a routine merge
  conflict-free rebase/merge later, not a rewrite.

## What exists today

### 1. Persistent Android notification panel (shipped, code complete)

A silent, ongoing notification pinned in the pull-down shade for the whole
bulk ferment — like a system timer app. Lives at:

- `lib/bulkStatusPanel.ts` — no-op interface (iOS/web fallback)
- `lib/bulkStatusPanel.android.ts` — real implementation, built on
  `@notifee/react-native` (expo-notifications can't do progress bars or
  live chronometers)
- Wired into `app/(tabs)/index.tsx` via a `useEffect` that calls
  `syncBulkPanel()` on bulk-state changes

Behavior: shows a live countdown to the next fold + a fold-progress wheel
(honey ring, described below) + target shaping time. Once all folds are
recorded it collapses to one line: "Dough rising — shape around [time]."
OS-side trigger notifications pre-arm the "fold is due" / "bulk time is up"
content flips so they land on time even if the app is asleep.

**Needs a dev build to test** (`npx expo run:android` — Notifee doesn't load
in Expo Go). Nobody has run this on a physical/emulated device yet — the
type-checker passes but the actual notification behavior (chronometer
rendering, progress bar, trigger timing) is unverified in a real Android
environment.

### 2. Fold-wheel notification artwork (shipped, v2 — replaced once already)

13 PNGs (`wheel-0.png` … `wheel-12.png`, 384×384) at
`assets/images/fold-wheel/`, showing fold progress 0/12 → 12/12 as a honey
ring filling around a small illustration.

- **v1** (this session's own first attempt) was rejected by the owner: it
  looked like an already-shaped boule with bubbles floating outside the
  dough, wrong for the bulk-ferment stage it represents.
- **v2** (current, shipped) came from a separate Claude Design session
  fed the handoff at `docs/design-handoff-fold-wheel-icon.md`: a translucent
  Cambro tub with lid, dough rising and doming inside it, a living colony
  (gluten mesh, amber yeast, violet LAB chains) visible inside the dough.
  This is the version currently in the repo and it's approved — no known
  open complaints about it.
- Generator: `tools/generate_notification_icons.mjs`. **Needs node-canvas**
  (`npm i canvas`) — does not run in this cloud sandbox (native build
  fails here), so re-runs must happen on the owner's machine or wherever
  node-canvas can compile.

### 3. Main app icon (in progress — concept stage, no decision yet)

The current `assets/images/icon.png` /
`assets/images/android-icon-*.png` are **placeholders**: a flat amber disc,
not a real design.

This session produced an exploration, not a final answer:

- `docs/design-handoff-app-icon.md` — the brief for a Claude Design session:
  8 concept directions (3 rendered, 5 written), plus the real technical
  constraints for a *launcher* icon (opaque 1024px iOS, Android adaptive
  safe zone, monochrome themed-icon layer, 48px legibility) which differ
  from the notification-icon constraints.
- `assets/images/app-icon-concepts/{specimen,culture-jar,bloom}.png` — three
  1024px renders of the fermentation-storyboard concepts, plus
  `contact-sheet.png` (96px legibility check).
- Generator: `tools/generate_app_icon_concepts.mjs` — **zero dependencies**
  (a hand-rolled additive-glow float-buffer renderer, not node-canvas), runs
  fine in any Node environment including this sandbox. Re-run after editing
  any `concept*()` function; takes ~1.5s for all three plus the contact sheet.

**Owner's read on the three renders**, for whoever picks this up:
- *Culture Jar* holds a recognizable silhouette at 48px — the strongest
  home-screen candidate so far.
- *Specimen* is the most beautiful at full size but melts into a soft glow
  when shrunk to icon size — better suited to splash/about art unless pushed
  bolder.
- *Bloom* is calm and abstract; bubbles currently read a little disconnected
  from the core glow.
- **No concept has been chosen yet.** The owner has not said which direction
  (if any) to pursue further, and hasn't yet decided whether to route this
  through an actual Claude Design session or keep iterating the Node
  renderer here.

**Open question for the owner, worth asking early in a new session:** did
you run this through Claude Design yet, and if so, what came back? If not,
does the direction still feel right, or should the exploration widen (e.g.
into the 5 written-only concepts: Scored Boule, Rising Dome, Wheat & Culture
monogram, Sweet Spot droplet, Starter Surface macro)?

## Design language reference (don't rediscover this — read it)

- `components/theme.ts` — the app's color tokens (espresso bg `#171210`,
  honey accent `#E8A33D`, cream text `#F2E8DC`, etc.) and fonts. Every new
  asset should draw from this palette, not invent new colors.
- `docs/fermentation-art-spec.md` — the full spec for the in-app
  fluorescence-microscopy fermentation scene (amber yeast, violet LAB rods,
  teal amylase, red protease, glowing gluten network, additive blending on
  pure black). This is the visual "house style" any new icon/illustration
  should feel related to.
- `components/SkiaFermentationScene.tsx` — the live animated version of that
  scene; read its header comment for the rendering approach (additive
  BlendMode.Plus, luminous specimens).

## Tools inventory (so nothing gets reinvented)

| Script | Purpose | Dependency | Runs in this sandbox? |
|---|---|---|---|
| `tools/generate_notification_icons.mjs` | fold-wheel 13-frame set | node-canvas | No — needs owner's machine |
| `tools/generate_app_icon_concepts.mjs` | app-icon concept renders + contact sheet | none (hand-rolled) | Yes |

## Validation notes for whoever continues this

- `npx tsc --noEmit` passes as of `6a3db9f`. Re-run after any `.ts`/`.tsx` edit.
- The notification panel's actual on-device behavior is **unverified** — flag
  this clearly to the owner rather than claiming it works; it needs a real
  Android dev build to confirm chronometer/progress-bar/trigger behavior.
- Per CLAUDE.md: show the owner rendered images, not just "it ran
  successfully," before calling any visual asset done.

## Keeping this doc current — protocol for every session

**Any session working in this repo** must do the following whenever the
owner asks to "hand off," "hand off to a new session," or similar:

1. Update this file (`docs/SESSION_HANDOFF.md`) — rewrite the sections above
   to reflect current reality: what shipped, what's mid-flight, what
   decisions are still open, what the owner said about any rendered
   options, current branch/PR state. Don't just append — edit stale
   sections so the doc never grows into a changelog. It should always read
   as "here's where things stand today," not "here's the history."
2. If new concept-specific handoff docs were created for a Claude Design
   session (following the `docs/design-handoff-*.md` naming pattern), link
   them from this file and summarize their outcome once known.
3. Commit the updated doc(s) with the rest of the session's work (don't
   leave it as an uncommitted dangling edit) and push.
4. Keep this file itself lean — it's a state snapshot, not a full design
   history. If a section is no longer relevant (e.g. a concept was
   rejected and superseded), cut it rather than appending a correction.

This protocol itself is also mirrored in `CLAUDE.md` under "Handoff
protocol" — if the two ever disagree, trust this file for design-specific
detail and CLAUDE.md for the general rule.
