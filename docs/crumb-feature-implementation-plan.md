# Crumb-diagnosis feature — implementation plan

**What this document is:** the master plan for finishing the flagship ML feature —
photograph a slice of bread, and the app classifies the crumb on a 5-point scale
(`under_fermented, slightly_under, properly_fermented, slightly_over,
over_fermented`) fully on-device with a TFLite MobileNetV3Small model.

**Who executes it:** each work package (WP) below is sized to be handed to a
single fresh agent session (Haiku for mechanical work, Sonnet for
judgment-heavy work) or done by the owner on their own machine. Section 4 has
copy-pasteable prompts for the agent-executable packages.

**What this plan consumes (does not redesign):**
- `docs/crumb-dataset-runbook.md` — the data collection + labeling procedure
- `docs/crumb-model-integration.md` — the app-integration spec (label contract,
  "model replaces only `crumbProbs`" constraint, Expo Go fallback, 3-way fallback)

**Environment reality:** the cloud sandbox blocks outbound scraping and has no
GPU. Everything involving scraping, the Anthropic API key, model training, or a
physical phone is marked **owner-manual** and runs on the owner's machine.
Everything else is cloud-agent-executable.

---

## 1. Overview

### End state

`app/(tabs)/diagnose.tsx` lets a baker attach a crumb photo; the app runs
`analyzeCrumbPhoto()` from `model/visionAnalyzer.ts`, which (a) keeps the
existing Otsu/flood-fill heuristics to produce the boolean features
(`evenHoles`, `topHeavyHoles`, `tunnelingDetected`, `gummyDetected`,
`holeFraction`) that `diagnose()` in `model/classifier.ts` depends on, and
(b) replaces **only** the `crumbProbs` probability block with the softmax
output of `assets/model/crumb_classifier.tflite`, loaded via
`react-native-fast-tflite` in a dev build, with a graceful fallback to the
current heuristic probabilities in Expo Go or if the model fails to load.
The diagnose tab ships behind a "beta" label until on-device accuracy is
spot-checked (launch-checklist §4).

### Two independent tracks, one merge point

```
CODE TRACK (cloud agents, can start today)
  WP1 (Haiku)  runtime scaffolding: dep + Metro + types
     │
  WP2 (Sonnet) visionAnalyzer refactor: model hook + heuristic fallback
     │
  WP3 (Sonnet) diagnose screen: actually run the photo through the analyzer
     │
  WP4 (Sonnet) [CONTINGENT] 3-way→5-way probability derivation
     │
     └──────────────┐
                    ▼
DATA TRACK (owner's machine)          MERGE
  WP5 (owner) collect candidates       WP8 (owner) train + export + commit
     │                                    │        assets/model/
  WP6 (owner) curate with Claude vision   ▼
     │                                 WP9 (owner) dev build + on-device
  WP7 (owner) dataset health gate ────▶           verification
     (decides: 5-way, or 3-way + WP4)     │
                                          ▼
                                       WP10 (Haiku) checklist/docs close-out
```

The code track is designed so that **everything compiles and runs correctly
before the model exists** — the fallback path *is* today's behavior. That means
WP1–WP3 can be finished and merged while the owner is still collecting data.

---

## 2. Work packages

Facts below were verified against the code on 2026-07-06; anything the code
could not confirm is flagged inline as ⚠️ UNVERIFIED.

---

### WP1: TFLite runtime scaffolding

> **Plain language:** teach the app's build system about `.tflite` files and
> install the library that runs them, without changing any behavior yet.

- **Model tier:** Haiku — pure config/boilerplate, no design decisions.
- **Preconditions:** none. Branch off `main`.
- **Steps:**
  1. Add `react-native-fast-tflite` to `package.json` dependencies via
     `npx expo install react-native-fast-tflite` (falls back to
     `npm install react-native-fast-tflite` if expo install rejects it).
     ⚠️ UNVERIFIED: the library's compatibility with Expo SDK 56 / RN 0.85
     New-Architecture-only. It advertises New Arch support, but per the
     Notifee lesson in `docs/launch-checklist.md` §1, a green build proves
     nothing — runtime linking is only confirmed in WP9 on a device. Do NOT
     attempt to verify linking in the cloud env; just install and type-check.
  2. In `metro.config.js` (currently 7 lines: `getDefaultConfig` +
     `withNativeWind`), add `config.resolver.assetExts.push('tflite');`
     before the `withNativeWind` wrap, so
     `require('../assets/model/crumb_classifier.tflite')` bundles as an asset.
  3. Create `types/tflite-assets.d.ts` (or add to an existing ambient d.ts if
     one exists) declaring `declare module '*.tflite';` so TypeScript accepts
     the asset require. Confirm `tsconfig.json` picks the file up.
  4. Create the empty directory `assets/model/` with a `.gitkeep` so later
     packages have a stable path to target (the trained
     `crumb_classifier.tflite` + `labels.json` land here in WP8).
- **Files to create/modify:**
  - `package.json`, `package-lock.json` (modify)
  - `metro.config.js` (modify)
  - `types/tflite-assets.d.ts` (create)
  - `assets/model/.gitkeep` (create)
- **Acceptance criteria:**
  - [ ] `npm install` completes; lockfile committed.
  - [ ] `npx tsc --noEmit` passes.
  - [ ] `npx expo config` (or `npx expo-doctor`) evaluates without errors.
  - [ ] `grep tflite metro.config.js` shows the assetExts line.
  - [ ] No behavior change anywhere — no app source files touched.
- **Dependencies:** none.
- **Risks/gotchas:** if `expo install` pins an unexpected version, prefer the
  latest release of `react-native-fast-tflite` (New Arch support landed in
  recent versions). Do not add a config plugin unless the library's README
  requires one — check its docs rather than guessing.

---

### WP2: `visionAnalyzer.ts` refactor — model hook with heuristic fallback

> **Plain language:** restructure the photo analyzer so a trained model can
> supply the "how fermented is this?" percentages, while everything else the
> diagnosis engine needs keeps coming from the existing pixel heuristics —
> and the app still works perfectly if the model file isn't there yet.

- **Model tier:** Sonnet — this is the highest-judgment slice: fallback
  gating, label-contract enforcement, and not breaking `diagnose()`.
- **Preconditions:** WP1 merged (dep + assetExts + d.ts exist). The model file
  does NOT need to exist — the code must handle its absence.
- **The critical constraint (from `docs/crumb-model-integration.md`):**
  `model/classifier.ts` (`diagnose()`) leans heavily on the booleans —
  fool's crumb (`input.tunnelingDetected && input.topHeavyHoles &&
  input.gummyDetected`), the oven-artifact check, flat-loaf voting — not on
  `crumbProbs`. `crumbProbs` only feeds `topCrumbClass()`. So the model
  replaces **job #1 only**: the probability-synthesis block at
  `visionAnalyzer.ts` lines 120–134 (`let under = 0.1, sUnder = 0.15, …`
  through the normalized `crumbProbs` object). The entire `SIZE = 160`
  heuristic path (grayscale → `otsu()` → flood fill → the feature
  interpretation block at lines 110–118) stays byte-for-byte in behavior.
- **Steps:**
  1. Extract the existing synthesis block into a pure function
     `heuristicProbs(...)` taking the already-computed signals
     (`tunnelingDetected`, `bottomDense`, `gummyDetected`, `evenHoles`,
     `holeFraction`, `sizeVariance`, `topHeavyHoles`) and returning
     `Record<FermentationState, number>`. Identical math — this is a move,
     not a rewrite.
  2. Add a lazy model loader in a new file `model/tfliteRuntime.ts`:
     - Loads `labels.json` via
       `require('../assets/model/labels.json')` and the model via
       `require('../assets/model/crumb_classifier.tflite')` inside a
       `try/catch`. If either require throws (files absent) or the native
       module is unavailable (Expo Go), return `null` and log once which
       path is active (`console.log('[crumb] model path: tflite' / 'heuristic')`).
     - **Label contract:** `train_crumb_model.py` writes `labels.json` from
       `image_dataset_from_directory`, which orders classes
       **alphabetically** (`["over_fermented","properly_fermented","slightly_over","slightly_under","under_fermented"]`)
       — NOT the app's semantic order. Build `crumbProbs` by mapping output
       index `i` → `labels[i]` **by name**, exactly as the integration spec's
       snippet shows. Never map by position.
     - **Startup assertion:** verify `new Set(labels)` equals the 5 known
       `FermentationState` values (or, if WP4 is in play, the 3-way subset —
       see WP4); on mismatch, log an error and disable the model path
       (fall back) rather than crash. A retrained model with drifted labels
       must fail loudly in logs, never mislabel silently.
     - **Preprocessing:** resize to 224×224 and feed **raw 0–255 pixels**.
       The Keras export uses `include_preprocessing=True`
       (`tools/train_crumb_model.py` line 54), so the graph normalizes
       internally — dividing by 255 or applying ImageNet mean/std would
       double-normalize and wreck accuracy. Reuse the existing
       `expo-image-manipulator` + `base-64` + `jpeg-js` decode pattern from
       `analyzeCrumbPhoto` (lines 30–40), just at 224 instead of 160; drop
       the alpha channel from jpeg-js RGBA output to build the RGB tensor.
       ⚠️ UNVERIFIED: the exact `react-native-fast-tflite` call signatures
       (`loadTensorflowModel`, `model.runSync`) and whether the converted
       model expects float32 or uint8 input — the executing agent must check
       the library README and the converter output (with
       `tf.lite.Optimize.DEFAULT` and no representative dataset, weights are
       quantized but I/O stays float32; confirm rather than assume).
  3. In `analyzeCrumbPhoto`, keep the signature and the
     `CrumbVisionFeatures` return shape unchanged. Replace the synthesis
     block with:
     ```ts
     const crumbProbs = (await tryModelProbs(uri)) ?? heuristicProbs(…);
     ```
  4. Keep the file-header comment honest — update it to describe the
     model-first/heuristic-fallback design and the "moderate confidence →
     tiebreaker questions" UX it preserves.
- **Files to create/modify:**
  - `model/visionAnalyzer.ts` (modify — surgical)
  - `model/tfliteRuntime.ts` (create)
- **Acceptance criteria:**
  - [ ] `npx tsc --noEmit` passes.
  - [ ] With no model files present, `analyzeCrumbPhoto` returns exactly the
        same output as before the refactor (spot-check: a small Node/ts-node
        harness or unit-style assertion comparing `heuristicProbs` output for
        3 synthetic feature tuples against hand-computed values from the old
        block — show the actual numbers in the report, per CLAUDE.md
        lesson #2).
  - [ ] `CrumbVisionFeatures` shape unchanged; `model/classifier.ts` and its
        callers compile untouched.
  - [ ] Label mapping is by name; grep confirms no `probs[0]`-style
        positional indexing against a hardcoded class order.
  - [ ] Log line clearly states which probability path ran.
- **Dependencies:** WP1.
- **Risks/gotchas:**
  - Don't move or "improve" the boolean thresholds (e.g. `avgWallContrast <
    6`) — they're tuned; any drift silently changes `diagnose()` outcomes.
  - `require` of a missing asset fails at **bundle time** in Metro, not
    runtime — so the requires must be resilient to the files not existing
    yet. Safest pattern until WP8 lands: keep the requires behind a single
    `MODEL_BUNDLED = false` constant flipped to `true` in WP8's commit, or
    ship tiny placeholder files. Prefer the constant (no fake assets in the
    repo); document the flip clearly at the constant's definition so WP8's
    executor can't miss it.

---

### WP3: Diagnose screen — run the photo through the analyzer

> **Plain language:** today the diagnose tab's photos are decorative
> ("Reference only — for a future ML model") and the diagnosis comes entirely
> from 3 tap-to-answer questions. This package makes the crumb photo actually
> feed the diagnosis, while keeping the questions for what a crumb photo can't
> see (loaf silhouette, crust/score).

- **Model tier:** Sonnet — merging two evidence sources without degrading the
  existing UX needs judgment.
- **Preconditions:** WP2 merged. Model file not required (fallback works).
- **Verified current state (`app/(tabs)/diagnose.tsx`):**
  - `analyzeCrumbPhoto` is never imported or called anywhere in `app/`.
  - `buildClassifierInput()` (line 99) derives ALL `ClassifierInput` fields
    from the three answers: `crumbProbs` via `deriveCrumbProbs(shape, crumb,
    crust)` (line 66), plus `gummyDetected`/`evenHoles`/`tunnelingDetected`/
    `topHeavyHoles`/`megaPocketsNearCrust` from the crumb answer,
    `shoulderProfile`/`shapeFlat` from the shape answer, and
    `crustPale`/`glutenStrandsInBloom`/`bubblesInBloom` from the crust answer.
  - `crumbUri` state already exists with camera/library pickers (`pickPhoto`).
- **Steps:**
  1. When `crumbUri` is set, run `analyzeCrumbPhoto(crumbUri)` (async, with a
     loading state on the Diagnose button) and merge into
     `buildClassifierInput`:
     - `crumbProbs` ← vision result (model or heuristic — WP2 decides).
     - Vision-derived booleans (`evenHoles`, `topHeavyHoles`,
       `tunnelingDetected`, `gummyDetected`) ← from the photo, **overriding**
       the crumb-question mapping, since pixels beat memory. Keep the crumb
       question visible: it still supplies `megaPocketsNearCrust` (the
       heuristic can't detect that) and acts as the tiebreaker the analyzer's
       header comment designed for.
     - Exterior signals stay question-driven: `shoulderProfile`, `shapeFlat`,
       `crustPale`, `glutenStrandsInBloom`, `bubblesInBloom` — a crumb photo
       cannot see any of these.
  2. No photo → exactly today's behavior (`deriveCrumbProbs` from answers).
     `Platform.OS === 'web'` → also today's behavior (pickers are already
     no-ops on web, line 163).
  3. Wrap the analyzer call in try/catch: on failure, fall back to the
     question-derived input and proceed (never block a diagnosis on a bad
     photo). Log the failure.
  4. Update the photo section copy — it no longer says "Reference only";
     label the photo-driven analysis as **Beta** per launch-checklist §4
     ("Ship the diagnose tab behind a 'beta' label if the model isn't ready").
  5. Surface which path was used in the result card's reasoning footer
     (e.g. "Photo analysis: on-device model" / "Photo analysis: heuristic" /
     "Answers only") so on-device verification (WP9) can confirm the path.
- **Files to create/modify:** `app/(tabs)/diagnose.tsx` (modify).
- **Acceptance criteria:**
  - [ ] `npx tsc --noEmit` passes.
  - [ ] With no photo attached, resulting `ClassifierInput` is byte-identical
        to today's (spot-check by logging the object for one fixed answer
        combo before/after and diffing — show the diff in the report).
  - [ ] With a photo attached in Expo Go (heuristic path), the flow completes
        and shows a diagnosis + the path indicator; no crash.
  - [ ] Web build (`npx expo start` → `w`) still renders the tab.
- **Dependencies:** WP2.
- **Risks/gotchas:** `analyzeCrumbPhoto` throws on non-JPEG-decodable input
  (`jpeg-js`); ImagePicker returns JPEG with `quality: 0.7` so this is fine
  for camera/library, but keep the try/catch. Don't run analysis eagerly on
  photo pick — run it on Diagnose press so a slow analysis never blocks
  browsing.

---

### WP4: 3-way → 5-way probability derivation (CONTINGENT)

> **Plain language:** the two "slightly" classes are the hardest photos to
> find. If the dataset can't feed them, we train the model on just 3 classes
> and mathematically spread its answers back onto the 5-point scale, so the
> rest of the app never notices.

- **Model tier:** Sonnet — ordinal probability-splitting rule needs care.
- **Trigger:** only executed if WP7's health gate finds `slightly_under` /
  `slightly_over` below the ~15-image floor after exhausting sources (per
  `docs/crumb-dataset-runbook.md` step 3 and the integration spec's
  "sparse middle classes" section, Option A).
- **Preconditions:** WP2 merged; WP7's decision says "3-way".
- **Steps:**
  1. Owner (in WP8) trains on 3 folders only; `labels.json` will then be
     `["over_fermented","properly_fermented","under_fermented"]`
     (alphabetical, length 3).
  2. In `model/tfliteRuntime.ts`, detect `labels.length === 3` (name-checked
     against the 3 expected states) and route through a
     `deriveFiveFromThree(threeProbs)` function: keep the winning class's
     mass, bleed probability into the adjacent `slightly_*` key proportional
     to the runner-up's margin (e.g. a `properly_fermented` win with a
     non-trivial `under_fermented` runner-up moves mass into
     `slightly_under`). This mirrors the ordinal softening the current
     heuristic already does. Output always has **all 5 keys** so
     `classifier.ts`, `topCrumbClass()`, and `diagnose()` need zero changes.
  3. Document the exact split rule in a comment where implemented (the
     integration spec requires this).
  4. Extend WP2's label assertion to accept exactly two valid label sets:
     the 5-way set or the 3-way set. Anything else → fallback + error log.
- **Files to create/modify:** `model/tfliteRuntime.ts` (modify).
- **Acceptance criteria:**
  - [ ] `npx tsc --noEmit` passes.
  - [ ] Unit-style spot-check printed in the report: for 3 hand-picked 3-way
        inputs (decisive under, decisive proper, proper-with-under-runner-up),
        show the derived 5-vectors; they must sum to 1 and the third case
        must put visible mass on `slightly_under`.
  - [ ] `topCrumbClass` of a decisive 3-way input equals the original winner.
- **Dependencies:** WP2 (code), WP7 (decision).
- **Risks/gotchas:** do not implement Option B (ordinal head) unless the
  owner reports Option A's derived middles feel wrong in WP9 testing.

---

### WP5: Collect candidate images — `build_dataset.py` (owner-manual)

> **Plain language:** on your own computer, run the scraper that downloads
> candidate crumb photos from the hand-curated blog list and the reference
> PDFs. The cloud environment can't do this — it blocks web scraping.

- **Model tier:** owner-manual (outbound scraping is blocked in the sandbox).
- **Preconditions:** Python 3.13, normal internet. Optionally the reference
  PDFs (Modernist Bread, The Sourdough School) in the working dir.
- **Steps:** follow `docs/crumb-dataset-runbook.md` Step 1 **exactly** — it
  already encodes the guardrails. In particular:
  1. `python3 -m pip install beautifulsoup4 playwright pymupdf && python3 -m playwright install chromium`
  2. **Smoke test first (lesson #1):** `python3 tools/build_dataset.py --out dataset_raw --limit 1`,
     then open a few files in `dataset_raw/candidates/` and confirm with your
     eyes they're real crumb photos.
  3. Full run: `python3 tools/build_dataset.py --out dataset_raw`.
  4. Read the per-source count table at the end. Sources showing 0 are dead —
     replace URLs in `BLOG_PAGES` (tools/build_dataset.py, ~line 69) only
     with pages you've personally opened and confirmed (never let a script
     guess URLs).
- **Acceptance criteria:**
  - [ ] Smoke-test output eyeballed before the full run.
  - [ ] `dataset_raw/candidates/` populated; `dataset_raw/contexts.json` exists.
  - [ ] Per-source count table reviewed; grid-tagged sources (`# grid`)
        yielded images (they feed all 5 classes at once).
- **Dependencies:** none. Runs in parallel with WP1–WP3.
- **Risks:** low yield from JS-gated sites — acceptable; the curator filters
  garbage, it can't be poisoned by dead URLs.

---

### WP6: Curate + label with Claude vision — `curate_dataset.py` (owner-manual)

> **Plain language:** on your machine, have Claude look at every candidate
> photo, throw out non-crumb images, split labeled comparison charts into
> panels, and sort everything into the 5 class folders. Needs your Anthropic
> API key — which is currently the project's known blocker.

- **Model tier:** owner-manual (needs `ANTHROPIC_API_KEY`; the key currently
  returns 401 — CLAUDE.md "Current state" item 1. Fixing billing/workspace in
  console.anthropic.com is the first step of this WP).
- **Preconditions:** WP5's `dataset_raw/` (or the existing 188-image
  `dataset/` from previous scrapes — curate that first while WP5 runs, per
  CLAUDE.md next-steps item 2).
- **Steps:** runbook Step 2 exactly:
  1. Fix the API key; the script's preflight (one 1-token call,
     `tools/curate_dataset.py` lines 248–255) will fail fast and cheap if
     it's still broken — do not proceed past a failed preflight.
  2. `python3 tools/curate_dataset.py --in dataset_raw --out dataset_clean --context-file dataset_raw/contexts.json --model claude-haiku-4-5`
     (Haiku first pass; ~$0.01–0.03/image on Opus, less on Haiku).
  3. Read the ending stats + per-class count table (lesson #7). Keep
     `--min-confidence medium`; loosen to `low` only for a starved class.
- **Acceptance criteria:**
  - [ ] Preflight passed on the first attempt of the real run.
  - [ ] `dataset_clean/<label>/` has five folders; per-class counts recorded.
  - [ ] Spot-check ~5 random images per class by eye; hand-delete mislabels.
- **Dependencies:** WP5 (or existing `dataset/`).
- **Risks:** middle classes thin — expected; that's WP7's gate, don't force it.

---

### WP7: Dataset health gate — 5-way vs 3-way decision (owner-manual)

> **Plain language:** count what you actually collected, and make the one
> strategic call in this project: train on all 5 grades, or on 3 grades with
> the app deriving the in-between ones.

- **Model tier:** owner-manual (it's a judgment call on data you must eyeball;
  an agent can help tabulate, but the decision is the owner's).
- **Preconditions:** WP6 output (possibly after 2–3 collect/curate loops —
  runbook says re-running is safe, content-hash dedup prevents duplicates).
- **Steps:** runbook Step 3:
  1. `for d in dataset_clean/*/; do echo "$(ls "$d" | wc -l)  $d"; done`
  2. Every class ≥ ~15 (absolute floor), target 100+ balanced → **decide
     5-way**; WP4 is skipped.
  3. `slightly_under`/`slightly_over` still under the floor after exhausting
     blogs + PDFs (+ optionally Reddit OAuth) → **decide 3-way**; trigger WP4
     and, in WP8, train on the 3 main folders (collapse or exclude the
     `slightly_*` folders per the integration spec).
- **Acceptance criteria:**
  - [ ] Per-class count table saved into the WP8 handoff note.
  - [ ] Explicit written decision: "5-way" or "3-way + WP4".
- **Dependencies:** WP6.
- **Risks:** shipping a 5-way model with two starved classes — the integration
  spec explicitly forbids it ("don't ship a 5-way model that's guessing").

---

### WP8: Train, export, commit model assets (owner-manual + Haiku assist)

> **Plain language:** train the small image model on your machine, get the
> two output files, and commit them into the app so the code from WP1–WP3
> can finally load them.

- **Model tier:** owner-manual for training (no GPU in the sandbox; TF runs on
  the owner's machine). A Haiku session may do the commit/flip once the owner
  drops the artifacts into the repo.
- **Preconditions:** WP7 decision; `pip install tensorflow==2.16.*`.
- **Steps:**
  1. `python3 tools/train_crumb_model.py --data dataset_clean --out assets/model`
     (12 frozen epochs + 4 fine-tune epochs; prints `Classes: [...]` — verify
     it lists the expected label set for your WP7 decision).
  2. Sanity-check validation accuracy from the training log. Rough bar:
     comfortably above chance (>60% for 3-way, >40% for 5-way on a balanced
     val split) before bothering with device wiring; below that, collect more
     data instead.
  3. Copy/commit `assets/model/crumb_classifier.tflite` (~2–4 MB) and
     `assets/model/labels.json` into the repo, and flip WP2's
     `MODEL_BUNDLED` constant to `true` (its comment marks the spot).
  4. `npx tsc --noEmit` after the flip.
- **Files created:** `assets/model/crumb_classifier.tflite`,
  `assets/model/labels.json`; `model/tfliteRuntime.ts` (one-line flip).
- **Acceptance criteria:**
  - [ ] `labels.json` content matches the WP7 decision (5 names or 3 names,
        alphabetical).
  - [ ] Final val accuracy recorded in the commit message body.
  - [ ] `npx tsc --noEmit` passes with the flip.
- **Dependencies:** WP7 (data), WP2 (the constant to flip), WP4 if 3-way.
- **Risks:** committing a multi-MB binary is fine once, but don't iterate
  models through git history casually — retrain locally, commit the keeper.

---

### WP9: Dev build + on-device verification (owner-manual)

> **Plain language:** put the app on a real phone (the model library doesn't
> work in the Expo Go preview app) and check that a few photos you already
> know the answer for get diagnosed correctly.

- **Model tier:** owner-manual (physical device; `react-native-fast-tflite`
  needs a dev build — `npx expo run:android` / `run:ios` or EAS — same
  constraint class as notify-kit; it will not load in Expo Go).
- **Preconditions:** WP3 + WP8 merged.
- **Steps:** integration spec's Verification section:
  1. Build + install a dev build on a physical phone.
  2. Run the diagnose flow on 3–5 hand-labeled test photos (at minimum: one
     clearly under, one clearly proper, one clearly over). Confirm the
     result card's path indicator says the model path ran, and
     `topCrumbClass(crumbProbs)` (i.e., the headline diagnosis direction)
     matches your eyeball label each time.
  3. Open the same build's flow with the model path artificially disabled
     (or simply run the app in Expo Go): confirm the heuristic fallback runs,
     the path indicator says so, and nothing crashes. **Per the Notifee
     lesson (launch-checklist §1): a green build is not verification —
     only this on-device run is.**
  4. Sanity-check inference latency feels acceptable (<~2s on a mid phone).
- **Acceptance criteria:**
  - [ ] 3/3 clear-case photos diagnosed in the right direction on-device.
  - [ ] Expo Go / fallback path verified crash-free.
  - [ ] Findings (photo → predicted class table) posted back for WP10.
- **Dependencies:** WP3, WP8.
- **Risks:** if the native module fails to link on New Arch (the Notifee
  failure mode), the app must still run via WP2's guard — if it hard-crashes,
  that's a WP2 bug, not a reason to ship without the guard.

---

### WP10: Close-out — checklist, docs, beta gate (Haiku)

> **Plain language:** update the project's memory files so the next session
> knows the feature is done (or exactly what's still open), per house rules.

- **Model tier:** Haiku — mechanical doc edits against known facts.
- **Preconditions:** WP9's verification results.
- **Steps:**
  1. `docs/launch-checklist.md` §4: replace the entry with what remains (if
     fully verified, delete it per the file's own rule; note the dev-build
     requirement for the model path either way).
  2. `CLAUDE.md` "Current state / next steps": rewrite the 4-item list to
     reflect reality post-ship.
  3. If verification exposed accuracy concerns, keep/strengthen the "beta"
     label wording in `app/(tabs)/diagnose.tsx` and record the concern in
     the checklist instead of deleting the entry.
- **Files to modify:** `docs/launch-checklist.md`, `CLAUDE.md`, possibly
  `app/(tabs)/diagnose.tsx` (copy only).
- **Acceptance criteria:**
  - [ ] Checklist §4 accurately reflects on-device findings (no aspirational
        claims — evidence only, lesson #2).
  - [ ] `npx tsc --noEmit` passes if the tsx copy changed.
- **Dependencies:** WP9.

---

## 3. Critical path & parallelism

**Fully parallel from day one:**
- Code track: WP1 → WP2 → WP3 (serial within the track — each builds on the
  last; single-file-ownership keeps merges trivial).
- Data track: WP6-on-existing-`dataset/` can start the moment the API key is
  fixed, in parallel with WP5's fresh scrape; then WP5→WP6(again)→WP7.

**Serialization points:**
- WP8 needs both tracks: WP7's data + WP2's constant.
- WP4 blocks WP8 only in the 3-way scenario, and WP4 itself only needs WP2 —
  so it can even be built speculatively if the owner wants zero idle time
  (it's dead code behind the `labels.length === 3` check otherwise).
- WP9 needs everything; WP10 needs WP9.

**Minimum path to a shippable beta:** WP1 → WP2 → WP3 alone is shippable —
the diagnose tab gains real photo analysis via the heuristic path, behind the
beta label, with zero model dependency. The model (WP5–WP9) upgrades accuracy
without further UI work. This ordering means the app never waits on the
dataset.

**Single most likely schedule risk:** the API key (WP6) — it has been the
blocker since June. Fix it first; everything else can proceed regardless.

---

## 4. Delegation-ready prompts

Copy-paste one block into a fresh session. Each assumes the repo is cloned at
the root and the session creates its own `claude/...` branch off `main`
(merging any predecessor WP branch first). Per repo policy: never push to
`main`; no secrets in code or commits.

### Prompt — WP1 (Haiku)

```
Repo: Sourdough-timer. Create branch claude/wp1-tflite-scaffolding off main.

Task: scaffolding only, zero behavior change.
1. Install react-native-fast-tflite (try `npx expo install react-native-fast-tflite`,
   else npm install). Commit package.json + lockfile.
2. metro.config.js currently just wraps getDefaultConfig with withNativeWind.
   Add `config.resolver.assetExts.push('tflite');` before the wrap.
3. Create types/tflite-assets.d.ts containing `declare module '*.tflite';`
   and confirm tsconfig.json includes it.
4. Create assets/model/.gitkeep (empty dir placeholder for the future
   crumb_classifier.tflite + labels.json).

Do NOT touch any app source (.tsx/.ts under app/ or model/). Do NOT add an
Expo config plugin unless react-native-fast-tflite's README says it is
required for Expo — check, don't guess.

Acceptance (verify and show output): `npx tsc --noEmit` passes;
`npx expo config` evaluates without error; `grep tflite metro.config.js`
shows the line. Commit with a clear message; push the branch; no PR.
```

### Prompt — WP2 (Sonnet)

```
Repo: Sourdough-timer. Branch claude/wp2-vision-model-hook off main (merge
the WP1 branch first if not yet on main — it adds react-native-fast-tflite,
a tflite assetExt, and types/tflite-assets.d.ts).

READ FIRST, fully: docs/crumb-model-integration.md (the spec you are
implementing — every constraint below comes from it), model/visionAnalyzer.ts,
model/classifier.ts, model/training-data.ts (FermentationState).

Task: refactor model/visionAnalyzer.ts so a TFLite model can supply
crumbProbs, with the current heuristic as fallback.

Hard constraints:
- analyzeCrumbPhoto keeps its signature and CrumbVisionFeatures return shape.
- The SIZE=160 heuristic pipeline (grayscale → otsu → flood fill → the
  boolean block computing evenHoles/topHeavyHoles/tunnelingDetected/
  gummyDetected/holeFraction) must be preserved with IDENTICAL behavior —
  classifier.ts's diagnose() depends on those booleans (fool's crumb, oven
  artifact, flat-loaf voting). The model replaces ONLY the probability
  synthesis block (the `let under = 0.1 ...` block).
- Extract that block into a pure heuristicProbs(...) function (a move, not a
  rewrite), then: `const crumbProbs = (await tryModelProbs(uri)) ?? heuristicProbs(...)`.
- New file model/tfliteRuntime.ts implements tryModelProbs:
  * Loads assets/model/labels.json and assets/model/crumb_classifier.tflite.
    These files DO NOT EXIST YET. Metro fails at bundle time on missing
    require()s, so gate both requires behind a `const MODEL_BUNDLED = false`
    constant with a comment telling the future model-commit task to flip it.
  * labels.json from Keras is ALPHABETICAL (["over_fermented",
    "properly_fermented","slightly_over","slightly_under","under_fermented"])
    — NOT the app's semantic order. Map output index i to labels[i] BY NAME.
    Never positional against a hardcoded order.
  * Assert new Set(labels) equals the 5 FermentationState values; on
    mismatch log an error and return null (fallback), never crash or
    mislabel.
  * Preprocess: resize to 224x224 (reuse the expo-image-manipulator +
    base-64 + jpeg-js pattern already in analyzeCrumbPhoto), feed RAW 0-255
    pixels (RGB, drop jpeg-js's alpha). The Keras export uses
    include_preprocessing=True — do NOT divide by 255 or apply ImageNet
    mean/std (double normalization). Check react-native-fast-tflite's README
    for the exact load/run API and input dtype; do not invent APIs.
  * Any load/run failure (Expo Go, missing native module, bad asset) →
    return null, log once which path is active.

Acceptance (show real output, not just exit codes):
- npx tsc --noEmit passes.
- Demonstrate heuristicProbs equivalence: compute its output for 3 synthetic
  feature tuples and show the numbers match the pre-refactor math.
- Grep proof there's no positional label indexing.
Commit, push branch, no PR. Do not touch app/(tabs)/diagnose.tsx.
```

### Prompt — WP3 (Sonnet)

```
Repo: Sourdough-timer. Branch claude/wp3-diagnose-photo-wiring off main
(merge the WP2 branch first if needed).

READ FIRST: app/(tabs)/diagnose.tsx (all of it), model/visionAnalyzer.ts
(post-WP2), model/classifier.ts (ClassifierInput), docs/crumb-model-integration.md.

Current state: diagnose.tsx never calls analyzeCrumbPhoto; photos are
"Reference only" and buildClassifierInput() derives everything (including
crumbProbs via deriveCrumbProbs) from 3 manual questions.

Task: when a crumb photo is attached (crumbUri), run analyzeCrumbPhoto on
Diagnose press (with a loading state) and merge:
- crumbProbs and the vision booleans (evenHoles, topHeavyHoles,
  tunnelingDetected, gummyDetected) come from the photo, overriding the
  crumb-question mapping.
- megaPocketsNearCrust still comes from the crumb question (the heuristic
  cannot detect it) — keep all 3 questions in the UI.
- Exterior fields stay question-driven: shoulderProfile, shapeFlat,
  crustPale, glutenStrandsInBloom, bubblesInBloom.
- No photo, or web platform, or analyzer throws → exactly today's behavior
  (try/catch, log, proceed with question-derived input; never block).
- Update the photo section copy (no longer "Reference only") and label the
  photo analysis "Beta" per docs/launch-checklist.md §4.
- Add a small line in the result card showing which path ran ("on-device
  model" / "heuristic" / "answers only") for later device verification.

Acceptance (show real output):
- npx tsc --noEmit passes.
- Log the ClassifierInput for one fixed answer combo with no photo, before
  and after your change — diff must be empty.
- Describe (or screenshot via the web build) that the tab still renders.
Commit, push branch, no PR.
```

### Prompt — WP4 (Sonnet, only if WP7 decided 3-way)

```
Repo: Sourdough-timer. Branch claude/wp4-three-way-derivation off main.

READ FIRST: docs/crumb-model-integration.md section "Fallback: sparse middle
classes" (you are implementing Option A), model/tfliteRuntime.ts,
model/training-data.ts (FermentationState).

Task: in model/tfliteRuntime.ts, support a 3-class model. When labels.json
has exactly ["over_fermented","properly_fermented","under_fermented"]
(alphabetical), route through deriveFiveFromThree(threeProbs): keep the
winner's mass, bleed probability into the adjacent slightly_* key
proportional to the runner-up's margin (a properly_fermented win with a
non-trivial under_fermented runner-up moves mass into slightly_under).
Output must always contain all 5 FermentationState keys summing to 1 —
classifier.ts must need zero changes. Document the exact split rule in a
comment at the function. Extend the label assertion to accept exactly the
5-way set or this 3-way set; anything else → log error + heuristic fallback.

Acceptance: npx tsc --noEmit passes; print derived 5-vectors for 3 test
inputs (decisive under, decisive proper, proper-with-under-runner-up) — sums
= 1, third case shows visible slightly_under mass, topCrumbClass preserved
for decisive inputs. Commit, push branch, no PR.
```

### Prompt — WP10 (Haiku)

```
Repo: Sourdough-timer. Branch claude/wp10-ml-closeout off main.

Input you will be given: the on-device verification results from the owner
(photo → predicted class table, fallback check result, latency note).

Task: update project memory to match verified reality — no aspirational
claims.
1. docs/launch-checklist.md §4: if the model is wired, verified on-device,
   and accuracy was acceptable, delete the entry per the file's own rule but
   add a one-line note (in §2-style device checks if needed) that the model
   path requires a dev build. If anything remains open, rewrite §4 to list
   exactly what.
2. CLAUDE.md "Current state / next steps (June 2026)": rewrite the numbered
   list to the current truth and update the month.
3. If verification flagged accuracy concerns, keep the "Beta" wording in
   app/(tabs)/diagnose.tsx and note the concern in the checklist.

Acceptance: docs read accurately against the supplied results; npx tsc
--noEmit passes if any .tsx changed. Commit, push branch, no PR.
```

*(WP5–WP9 are owner-manual; their "prompts" are the runbook and this doc's
steps. If the owner wants an agent to babysit a local run, paste the WP text
itself — but the commands must execute on the owner's machine.)*

---

## 5. Definition of done (whole feature)

Tied to `docs/launch-checklist.md` §4, which currently reads: *"The crumb
classifier still needs: working Anthropic key for curation, ≥100 images/class,
training run, and wiring `crumb_classifier.tflite` into
`model/visionAnalyzer.ts`. Ship the diagnose tab behind a 'beta' label if the
model isn't ready at launch."*

The feature is done when ALL of the following hold, with evidence, not
assertions (CLAUDE.md lesson #2):

1. **Data:** `dataset_clean/` per-class count table shows every trained class
   ≥100 (target) or the WP7 gate consciously chose 3-way; counts are recorded
   in the WP8 commit.
2. **Model:** `assets/model/crumb_classifier.tflite` + `labels.json` are
   committed; training log's val accuracy recorded; `labels.json` matches the
   trained class set.
3. **Code:** WP1–WP3 (± WP4) merged; `npx tsc --noEmit` passes; the heuristic
   boolean pipeline in `visionAnalyzer.ts` is untouched in behavior; label
   mapping is by name with the drift assertion in place.
4. **Device:** WP9 verified on a physical phone — model path confirmed
   active, 3+ clear-case photos diagnosed in the right direction, Expo
   Go/fallback path crash-free.
5. **Memory:** launch-checklist §4 updated/removed per WP10; the diagnose tab
   keeps its "Beta" label until real-world accuracy is spot-checked, then the
   label's removal is a deliberate, recorded decision.
6. **Hygiene:** no API keys or secrets anywhere in the diffs; all work on
   `claude/...` branches; nothing pushed to `main` unasked.
