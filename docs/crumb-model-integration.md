# Crumb model integration spec

**Audience:** the Sonnet/Opus session that wires the trained model into the app.
**Prereq:** `assets/model/crumb_classifier.tflite` + `labels.json` exist (produced
by `train_crumb_model.py` — see `docs/crumb-dataset-runbook.md`).

This spec exists because the integration is **not** a drop-in replacement. Read
the "critical constraint" below before writing any code.

---

## Critical constraint: the model replaces ONLY the class probabilities

`model/visionAnalyzer.ts` currently does two jobs from one image:

1. **5-way class probabilities** — `crumbProbs: Record<FermentationState, number>`
   synthesized from hole statistics (the `under/sUnder/proper/sOver/over` block
   near the bottom of the file).
2. **Boolean shape/texture features** — `evenHoles`, `topHeavyHoles`,
   `tunnelingDetected`, `gummyDetected`, `holeFraction`, and (assembled in the
   diagnose screen) `megaPocketsNearCrust`, `shoulderProfile`, etc.

`model/classifier.ts` (`diagnose()`) consumes **both**. It leans heavily on the
booleans — fool's crumb detection, the oven-artifact check, flat-loaf voting, the
shoulder/bloom reader all key off `gummyDetected` / `tunnelingDetected` /
`topHeavyHoles`, *not* off `crumbProbs`. `crumbProbs` is only the top-level
under/over/proper vote via `topCrumbClass()`.

**Therefore:** the TFLite model replaces job #1 only. Keep the entire heuristic
feature-extraction pipeline (grayscale → Otsu → flood-fill → the boolean
interpretation block) exactly as-is; it still produces the booleans the
classifier needs. Swap out just the probability-synthesis block for the model's
softmax output.

A model that returns 5 probabilities but no booleans would silently break
`diagnose()` — every code path that reads `input.gummyDetected` etc. would get
`undefined`. Do not go there.

---

## Label contract (must match exactly)

The dataset and the app already agree on 5 classes, in this order:

```
under_fermented, slightly_under, properly_fermented, slightly_over, over_fermented
```

`train_crumb_model.py` writes `labels.json` from `image_dataset_from_directory`,
which orders classes **alphabetically**, i.e.:

```json
["over_fermented", "properly_fermented", "slightly_over", "slightly_under", "under_fermented"]
```

⚠️ That alphabetical order is **not** the app's semantic order. The model's output
vector index `i` corresponds to `labels[i]`, so you MUST map by name, never by
position. Load `labels.json` at runtime and build `crumbProbs` by looking each
class up by string:

```ts
// labels.json is the source of truth for index→class
const modelLabels: FermentationState[] = require('../assets/model/labels.json');
const probs = await runTflite(pixels);            // Float32Array, length 5
const crumbProbs = Object.fromEntries(
  modelLabels.map((label, i) => [label, probs[i]]),
) as Record<FermentationState, number>;
```

Add a startup assertion that `new Set(modelLabels)` equals the 5 known states, so
a retrained model with drifted labels fails loudly instead of mislabeling.

---

## Runtime: `react-native-fast-tflite`

The TS comments already anticipate this library. It needs a **dev build**
(`npx expo run:android` / `run:ios` or EAS) — it will not load in Expo Go, same
constraint as `@notifee/react-native`.

Steps:

1. `npx expo install react-native-fast-tflite`
2. Bundle the model as an asset. Two options:
   - `require('../assets/model/crumb_classifier.tflite')` via the
     `react-native-fast-tflite` Metro asset plugin (add `tflite` to
     `assetExts` in `metro.config.js`), OR
   - ship it in the native bundle and load by path.
3. Preprocess the image to the model's input: **224×224 RGB**. MobileNetV3Small
   here is exported with `include_preprocessing=True`, so the model expects **raw
   0–255 uint8/float pixels** — do NOT also divide by 255 or apply ImageNet
   mean/std, or you'll double-normalize and wreck accuracy. Feed pixels straight
   from a 224×224 resize.
4. Run inference, get the length-5 softmax, map to `crumbProbs` by label name.

Reuse the existing `expo-image-manipulator` + `jpeg-js` decode already in
`visionAnalyzer.ts` to get pixels — just resize to 224 (model) in addition to the
160 (heuristics), or run both off one decode.

---

## Where the swap goes in `visionAnalyzer.ts`

`analyzeCrumbPhoto(uri)` keeps its signature and its `CrumbVisionFeatures` return
shape. Inside:

- **Keep:** the whole `SIZE = 160` heuristic path that computes `evenHoles`,
  `topHeavyHoles`, `tunnelingDetected`, `gummyDetected`, `holeFraction`.
- **Replace:** the `let under = 0.1 … crumbProbs` synthesis block. Instead, run
  the model on a 224×224 version of the same image and use its output as
  `crumbProbs`.
- **Make it graceful:** if the model asset/native module isn't available (e.g.
  running in Expo Go during development), fall back to the current heuristic
  `crumbProbs` synthesis. Gate on a `try/catch` around model load so the app
  never hard-crashes on a missing model. Log which path was used.

Suggested shape:

```ts
const crumbProbs = (await tryModelProbs(uri)) ?? heuristicProbs(features);
```

This preserves the "confidence is intentionally moderate → UI tiebreaker
questions" UX described in the file header: the trained model will be more
decisive than the heuristic, which is fine, but keep the fallback so the app
degrades instead of breaking.

---

## Fallback: sparse middle classes

If `slightly_under` / `slightly_over` never reach a trainable count, don't ship a
5-way model that's guessing on two starved classes. Instead:

**Option A (recommended) — train 3-way, derive the middles at inference.**
Train on `under_fermented / properly_fermented / over_fermented` only (collapse
`slightly_*` folders into their neighbor, or keep them out). Then in
`visionAnalyzer.ts`, derive the 5-point `crumbProbs` from the 3-way output by
splitting the mass by margin: e.g. a `properly_fermented` prediction with a
non-trivial `under` runner-up bleeds probability into `slightly_under`. This is
exactly the kind of ordinal softening the current heuristic already does, so the
`diagnose()` contract is unchanged. Document the split rule where you implement it.

**Option B — ordinal head.** Retrain with an ordinal/regression head (predict a
0–4 scalar, bucket it) so the model learns the *ordering* even from few middle
examples. More work; only if Option A's derived middles feel wrong in testing.

Either way, `crumbProbs` still has all 5 keys and `classifier.ts` needs no change.

---

## Verification (before saying "done")

1. `npx tsc --noEmit` passes.
2. Run the diagnose flow on a **dev build** with 3–5 hand-labeled test photos
   (one clearly under, one clearly proper, one clearly over at minimum). Confirm
   `topCrumbClass(crumbProbs)` matches the eyeball label and the surfaced
   diagnosis is sane.
3. Confirm the Expo-Go fallback path still runs (heuristic `crumbProbs`, no crash)
   when the native module is absent.
4. Update `docs/launch-checklist.md` §4 — the "wire crumb_classifier.tflite into
   visionAnalyzer.ts" gap is closed; note the dev-build requirement.
5. Keep the diagnose tab behind a "beta" label until real-world accuracy is
   spot-checked, per the launch checklist.
