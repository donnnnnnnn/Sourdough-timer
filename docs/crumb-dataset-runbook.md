# Crumb dataset runbook — collecting & labeling training photos

**Audience:** whoever runs the data pipeline (the owner locally, or a Sonnet/Opus
session). **Goal:** end up with `dataset_clean/` holding 100+ correctly-labeled
crumb photos in each of 5 classes, ready for `train_crumb_model.py`.

Read this end-to-end before running anything. The whole point of the redesign is
that **we stopped trying to label images by keywords** (it produced logos,
headshots, and mislabeled crumbs — see CLAUDE.md lessons #1 and #4). Now the
scraper only *collects candidates*; Claude vision does *all* the labeling.

---

## The 5 classes

Matches `FermentationState` in `model/training-data.ts`:

| label | what the crumb looks like |
|---|---|
| `under_fermented` | very dense/tight, gummy band near base, little rise; includes fool's crumb |
| `slightly_under` | mostly good but a bit tight/uneven; thin denser strip low in the slice |
| `properly_fermented` | open, **even** honeycomb through the whole slice; springy dry walls |
| `slightly_over` | slightly too open/irregular; thin "spiderweb" walls; a few oversized holes |
| `over_fermented` | very irregular, fragile walls, ragged tunnels or collapsed top; pale crust |

The 5-point scale is harder to source than 3, because the middle grades are
subtle. Two things make it tractable:

1. **Comparison charts are gold.** Many baking blogs publish a single image
   showing 4–6 loaves in a proof *progression* (raw-under → perfect → badly-over).
   `curate_dataset.py` splits these into one labeled training image per panel and
   reads the author's printed label as ground truth. A handful of these charts can
   populate all 5 classes at once. The curated source list in `build_dataset.py`
   flags known grids with `# grid`.
2. **The reference PDFs.** *Modernist Bread* and *The Sourdough School* have
   labeled crumb plates. Drop the PDFs in the working dir and the collector
   extracts every image with the page text as context.

---

## Step 1 — collect candidates (`build_dataset.py`)

Run on a machine with **normal internet** (not the cloud sandbox — it blocks
outbound scraping). Needs `beautifulsoup4`, `playwright`, `pymupdf`.

```bash
python3 -m pip install beautifulsoup4 playwright pymupdf
python3 -m playwright install chromium

# SMOKE TEST FIRST (CLAUDE.md lesson #1): one page only.
python3 tools/build_dataset.py --out dataset_raw --limit 1
ls dataset_raw/candidates | head        # open a few — are they real crumb photos?

# Looks right? Full run.
python3 tools/build_dataset.py --out dataset_raw
```

Output:
- `dataset_raw/candidates/` — flat, **unlabeled** images, deduped by content hash
- `dataset_raw/contexts.json` — `filename → "alt text | caption | source URL"`,
  fed to the curator so it can read printed labels and page context

The run ends with a per-source count table. If a source shows `0`, its URL is
probably dead or JS-gated — fine, it can't poison the set, but replace it with a
working URL (open the site's proofing/troubleshooting guide in a browser, confirm
crumb photos, paste the exact URL into `BLOG_PAGES`). **Never let a script guess
URLs** — that was the original bug.

### Adding Reddit (optional, low priority)

Anonymous Reddit JSON is blocked since 2023. Only bother if blogs+PDFs fall short:

```bash
# create a free "script" app at https://www.reddit.com/prefs/apps
export REDDIT_CLIENT_ID=...     REDDIT_CLIENT_SECRET=...
python3 tools/build_dataset.py --out dataset_raw --reddit
```

Reddit photos have no reliable labels, so the curator judges them purely
visually — expect a lower keep-rate.

---

## Step 2 — label with Claude vision (`curate_dataset.py`)

```bash
python3 -m pip install anthropic pillow
export ANTHROPIC_API_KEY=sk-ant-...      # billing must be active

# SMOKE TEST: the script makes ONE cheap preflight call and exits clearly if the
# key is bad (lesson #3). Then curate a handful by pointing --in at a small dir,
# or just run it — it prints per-image decisions as it goes.
python3 tools/curate_dataset.py --in dataset_raw --out dataset_clean \
    --context-file dataset_raw/contexts.json --model claude-haiku-4-5
```

- Default model is `claude-opus-4-8`; `--model claude-haiku-4-5` is ~5× cheaper
  and fine for a first pass. Cost is roughly **$0.01–0.03/image** on Opus, less on
  Haiku — a few dollars total for a full dataset, **not** a plan-usage concern.
- `--min-confidence medium` (default) drops images where the model is guessing
  between adjacent classes. Loosen to `low` only if a class is starved.
- Composites are split into panels automatically; single photos are labeled and
  copied. The run ends with a **per-class count table** (lesson #7).

Output: `dataset_clean/<label>/*.jpg`, five folders.

---

## Step 3 — check dataset health BEFORE training

```bash
for d in dataset_clean/*/; do echo "$(ls "$d" | wc -l)  $d"; done
```

- **Floor:** ~15/class or the model won't learn the class at all.
- **Target:** 100+/class, balanced.
- **Spot-check:** open ~5 random images in each folder. Mislabeled ones deleted
  by hand here beat any model tweak. Watch for `slightly_under`/`slightly_over`
  being thin — they're the hardest to source.

If the middle classes stay thin after exhausting sources, **do not force it** —
see the "sparse middle classes" fallback in `docs/crumb-model-integration.md`
(train 3-way + derive the `slightly_*` grades) before training.

To grow a class: add more comparison-chart URLs (best), add more PDFs, or enable
Reddit. Re-run steps 1–2; content-hash dedup means re-running is safe and won't
duplicate images already collected.

---

## Step 4 — hand off to training

Once every class clears the floor:

```bash
python3 tools/train_crumb_model.py --data dataset_clean --out assets/model
```

Produces `assets/model/crumb_classifier.tflite` + `labels.json`. Wiring it into
the app is a separate task — see `docs/crumb-model-integration.md`.

---

## Guardrails (why each exists — all are past mistakes)

- **Show real output before scaling** (`--limit 1`, then eyeball). Lesson #1.
- **Inspect artifacts, not exit codes** — read the count tables, open images. #2.
- **Fail fast on credentials** — the curator preflights the API key. #3.
- **Content is judged by a model, never by keywords.** #4.
- **Printed labels > page context > visual guess**, with a confidence rating. #5.
- **No secrets in files** — keys live in env vars only. #6.
- **Per-class counts every run.** #7.
