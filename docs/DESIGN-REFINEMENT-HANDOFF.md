# Design Refinement Handoff — July 2026

For the session picking up after the design-modernization build. Read this,
then `docs/design-modernization-plan.md` (the vision + rationale), then work
the backlog below. The owner is non-technical: explain decisions plainly and
show evidence (screenshots, measurements) per CLAUDE.md.

## Where things stand

All work lives on **`claude/design-modernization-ux-lc5tfk`** — pushed, **not
merged to main, no PR opened** (owner hasn't asked for one). Seven commits:

| Commit | What it did |
|---|---|
| `01235b3` | The audit + plan doc, before-screenshots, `tools/screenshot-web.mjs` |
| `b05bc91` | Phase 0: silent Skia fallback, deleted orphaned `/diagnose`, headers off, warm splash colors |
| `dc4a88a` | Phase 1: `theme.ts` token system, Fraunces, `components/ui/` kit + 22-glyph Icon set, Tailwind toolchain removed |
| `3621168` | Phase 2: Dial/Ruler instruments, Journey card, rise Corridor, dough pad, NativeTabs (native) |
| `62cefa2` | Phase 3: store v2 (photo/temp/rise persisted), Shelf gallery, scan ritual, report card + Gauge, share card |
| `d17b34c` | Brand: generated icon set (`tools/generate_app_icon.mjs`), checklist + CLAUDE.md sync |
| `f8248c4` | Compaction: active timer 2.06 → 1.42 screens; countdown merged into the dough pad |

Everything is verified by `npx tsc --noEmit` + web export + Playwright
screenshots (before/after evidence in `docs/design-modernization-shots/`).
**Nothing has run on a physical device yet** — the device gates live in
`docs/launch-checklist.md` §5–6; treat those as the release blockers, not
part of this refinement backlog.

## How to see your work (the verification loop)

```bash
npm install
npx tsc --noEmit                      # after any .ts/.tsx change
npx expo export --platform web
npx serve dist -l 8787 &              # then screenshot with Playwright
node tools/screenshot-web.mjs         # or drive it manually
```

Measure scroll height (the compaction metric) in a Playwright page:

```js
[...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 40)
  .sort((a,b) => b.scrollHeight - a.scrollHeight)[0]?.scrollHeight
```

Current baselines at 390×844: **idle 1001px (1.26 screens), active 1130px
(1.42), Shelf fits ~1 screen when empty.** Don't regress these without a
reason you can defend.

Note: on web the Skia scene intentionally falls back to the pure-JS
`FermentationScene` (drifting orbs) — the real microscopy scene is
native-only. Judge glass/scene interplay on device, not on web.

## Invariants — do not break these

1. **Skia scene**: JS-thread RAF → `createPicture`. Never add `'worklet'`
   directives to `components/SkiaFermentationScene.tsx` (`docs/SKIA-HANDOFF.md`
   — this crashed every build for a day). New motion elsewhere may use
   Reanimated 4's **CSS-style API** (no worklet directives needed); the
   existing kit uses classic `Animated`, which is fine — don't migrate it
   for style points.
2. **Glass contract**: a `GlassCard`'s `radius` prop must match its visual
   radius; cards register rects with `glassStage` and re-measure on layout/
   scroll-settle. Any programmatic scroll must also call `setScrollY(...)` +
   bump the measure tick (see the `isActive` effect in
   `app/(tabs)/index.tsx` for the pattern) or the blurred panels render at a
   stale offset.
3. **Fallback ladder**: web → `FermentationScene` directly; native error →
   `FermentationScene` in production, red diagnostic panel only in
   `__DEV__` (`components/SkiaErrorBoundary.tsx`).
4. **Tokens**: every color/size/motion/haptic constant comes from
   `components/theme.ts`. Honey (`C.accent`) is reserved for living/active
   things — running timer, due fold, the culture. Ordinary controls are
   cream/parchment. The accent ramp is `accentForFraction()`.
5. **Store**: temperatures stored in °F always; `tempUnit` is display-only
   (`formatTemp`). Persist version 2 — new `BakeLog`/`PendingSession` fields
   must stay optional (old rows lack them). Photos are copied into
   `Paths.document` via the new expo-file-system `File` API
   (`persistPhoto` in `app/(tabs)/log.tsx`).
6. **Tabs**: NativeTabs on native, classic styled `Tabs` on web (NativeTabs'
   web rendering floats a pill over content). Both live in
   `app/(tabs)/_layout.tsx`.
7. **Gestures** use core `PanResponder` (no react-native-gesture-handler
   dependency) in Dial/Ruler/Corridor. Keep it that way unless a real need
   appears.
8. **Timer-screen logic** (alarm sync effect, Android panel sync, undo
   snapshot, late-fold flow) predates the redesign and is battle-tested —
   restyle around it, don't refactor it casually.

## Refinement backlog (ranked; each independently shippable)

**R1 — Reduce-motion support (a11y gap, known).** Nothing respects
`prefers-reduced-motion`/`AccessibilityInfo.isReduceMotionEnabled()`:
`Squish`, `BreathingDot`, `PulseDot`, `StartGlow`, bubbles, `ScanOverlay`
sweep. Add a `useReducedMotion()` hook in the kit; when true, swap springs
for instant state changes and stop ambient loops. The Skia scene itself
should probably dim to a static frame.

**R2 — Corridor band recompute (perf, known).** In
`components/ui/Corridor.tsx`, `xMax = max(target*1.25, elapsed+20)` feeds
the band `useMemo` — once `elapsed+20` exceeds `target*1.25` (late bulk),
the band re-samples **every second**. Quantize `xMax` to 15-minute steps
before the memo. While there: consider light time-axis labels (start /
target / now).

**R3 — Feel pass on the instruments (needs device).** Dial maps ~180px of
arc to 32°F → ~5.6px per detent; may be twitchy. Options: bigger arc radius,
value smoothing, or accept. Ruler thumb (22×34) may be small for floury
thumbs — consider 26×40 + `hitSlop`. Corridor drag-to-log needs a real
finger to judge. Tune `motion.pressIn/release` spring constants if squish
feels mushy on 120Hz screens.

**R4 — Pad label focus.** The pad's "NEXT FOLD IN mm:ss" label competes
with the hero digits when both are honey. Consider: label in straw until
the fold is <5 min out, then honey; ember when due (already ember when
late). One-line change in the pad status block (`index.tsx`).

**R5 — Journey polish.** (a) With >6 planned folds the milestone list gets
long — collapse recorded folds into one row ("Folds 1–4 ✓") once ≥3 are
done. (b) `editTarget` stays open until re-tapped — consider auto-closing a
few seconds after the last ruler change. (c) `scienceOpen` persists across
phase changes — arguably right (a reader keeps reading); confirm with the
owner. (d) Check header truncation at iPhone SE width (320pt).

**R6 — °C display granularity.** Dial detents are 1°F; in °C mode some
detents don't change the displayed integer (0.55°C per step). Either show
halves in °C ("24.5°") or make °C mode snap the underlying value to whole-°C
equivalents. Small, but international users will notice.

**R7 — "Bake it again."** On the Shelf detail sheet, a button that pre-fills
the plan from that bake. Blocker: `plannedTarget`/`foldCount` are local
`useState` in `index.tsx` seeded once from the store. Cleanest fix: on
press, call `setTargetDuration`/`setDefaultFoldCount` in the store, then
have the idle screen initialize from store on focus (or lift plannedTarget
into the store outright). Then `router.push('/')`.

**R8 — Shelf grid on wide screens.** Loaf cards are `width: '48%'` — on
tablets that's two huge columns. Switch to a computed column count from
`useWindowDimensions` (target ~170pt cards). Also: `supportsTablet` is true
in app.json, so someone will see it.

**R9 — Icon micro-review at size.** The custom glyphs were only judged at
web-render sizes. On device, check `undo` (arc math is approximate), `fold`
(wave + arrowhead), `share` at 12–14px. Nudge paths in
`components/ui/Icon.tsx`; glyphs are plain SVG path data.

**R10 — Celebration v2 + scan-ritual tuning.** The plan's "scene surge" on
bulk end is unbuilt (celebration is the restyled original). ScanOverlay's
2.6s minimum dwell and status-line cadence (950ms) were tuned blind —
verify against a real photo + real model latency, and make sure the ritual
never *adds* meaningful latency when the model is slow anyway.

**R11 — Empty-state illustration.** The Shelf empty state uses the `shelf`
glyph in a rounded square. The plan imagined a small warm illustration
(empty wooden shelf, one hopeful bubble). A hand-tuned SVG scene (~60 lines)
would lift the first-run moment considerably.

**R12 — Sweep the leftovers.** `fonts.mono` (deprecated, unreferenced),
`C.purple*/C.orange*` aliases (grep before deleting), lucide imports (web
tab bar only — fine, or swap to the custom set for full consistency),
`Journey`'s unused `autolyse` prop path if the autolyse card stays inline in
`index.tsx`.

## Watch-outs discovered while building

- `Squish` wraps children in a `TouchableOpacity` — a percentage width on
  `Squish`'s `style` sizes the *inner* view, not the touchable. Size a plain
  outer `View` instead (see `LoafCard` in `log.tsx` for the pattern).
- RN-web: `window.scrollTo` doesn't scroll the app — the ScrollView is an
  inner overflow container; use `mouse.wheel` in Playwright.
- `gap` + `justifyContent: 'space-between'` + percentage children
  over-constrain wrapped rows on web; use `rowGap` + `space-between`.
- expo-file-system's modern API (`File`, `Paths`) is sync-ish and throws on
  web — keep it behind the `Platform.OS === 'web'` guard + dynamic import.
- `npx expo install` in this cloud env dies with a TCP stream error —
  `npm view <pkg> dist-tags` for the `sdk-56` tag, then plain
  `npm install pkg@version`.
- Recording folds past the planned count works by design (`FoldDots` shows
  `max(planned, completed)`); don't "fix" it.

## Definition of done for any refinement

- `npx tsc --noEmit` clean.
- Fresh web screenshots of every touched screen; compare against
  `docs/design-modernization-shots/after-*.jpg`; update those if the look
  changes deliberately.
- Scroll-height baselines respected (or the new number justified in the
  commit message).
- New interactive elements: `accessibilityLabel`/`Role`, 44pt targets.
- Anything requiring native behavior → add to `docs/launch-checklist.md` §5
  instead of claiming it verified.
- Commit per refinement with the `feat(scope):`/`fix(scope):` style used on
  this branch; push to `claude/design-modernization-ux-lc5tfk`; PR only if
  the owner asks.
