#!/usr/bin/env python3
"""Curate a scraped crumb-photo dataset using Claude vision.

Takes the raw output of build_dataset.py (which over-collects: logos, headshots,
recipe photos, composites) and produces a clean dataset where:
  - non-crumb images are discarded
  - composite infographics (e.g. 9-panel labeled crumb charts) are split into
    one training image per panel, each labeled per the text the author stamped
    on that panel
  - single crumb shots are labeled by what the image actually shows + any
    embedded text, overriding the scraper's keyword guess when they disagree

Labels onto a 5-point scale: under_fermented, slightly_under,
properly_fermented, slightly_over, over_fermented (matches the app's
FermentationState in model/training-data.ts).

Usage (on your machine, needs ANTHROPIC_API_KEY):

    python3 -m pip install anthropic pillow
    export ANTHROPIC_API_KEY=sk-ant-...
    python3 tools/curate_dataset.py --in dataset_raw --out dataset_clean \
        --context-file dataset_raw/contexts.json

Cost: roughly $0.01-0.03 per image with the default model. Pass
--model claude-haiku-4-5 to cut cost ~5x at some accuracy loss.
"""
import argparse
import base64
import io
import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("pip install pillow")

try:
    import anthropic
except ImportError:
    sys.exit("pip install anthropic")

LABELS = [
    "under_fermented",
    "slightly_under",
    "properly_fermented",
    "slightly_over",
    "over_fermented",
]

# Plain-language visual criteria for the 5-point fermentation scale. These are
# reused verbatim in the prompt AND the schema so Claude applies one rubric.
# Sources: The Sourdough Journey proof-progression charts, The Perfect Loaf
# over/under guide, and the diagnostic reasoning in Modernist Bread.
LABEL_CRITERIA = (
    "- under_fermented: very dense, tight, small even holes or none; often a "
    "gummy/wet band near the base; little to no rise. Includes classic "
    "'fool's crumb' (big holes up top, dense gummy bottom).\n"
    "- slightly_under: mostly good but a bit tight/uneven; a thin denser strip "
    "low in the slice; holes smaller than ideal. Close to right, needs a little "
    "more time.\n"
    "- properly_fermented: open, EVEN honeycomb through the whole slice; medium "
    "holes of varied but not extreme size; springy, dry walls; good height.\n"
    "- slightly_over: slightly too open/irregular; some thin translucent "
    "'spiderweb' walls; a few oversized holes; structure just starting to slacken.\n"
    "- over_fermented: very irregular, thin fragile walls, big ragged tunnels or "
    "a collapsed/flat top; gassy and structureless; pale crust when baked."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "is_crumb_content": {
            "type": "boolean",
            "description": "True only if the image shows the interior crumb of "
            "baked bread (sliced/cut open), either as a single photo or a "
            "composite of multiple crumb photos. False for logos, people, "
            "unsliced loaves, dough, recipes, ads, or non-bread food.",
        },
        "is_composite": {
            "type": "boolean",
            "description": "True if the image contains 2 or more distinct crumb "
            "photos arranged in a grid/collage (e.g. a labeled comparison chart).",
        },
        "single_label": {
            "type": ["string", "null"],
            "enum": LABELS + [None],
            "description": "For a single crumb photo: the fermentation diagnosis "
            "on a 5-point scale. Use embedded/overlaid text and the provided page "
            "context first, then judge visually per the criteria in the prompt. "
            "Null if composite or not crumb.",
        },
        "single_confidence": {
            "type": ["string", "null"],
            "enum": ["high", "medium", "low", None],
            "description": "Confidence in single_label. Null if not applicable.",
        },
        "grid_rows": {
            "type": ["integer", "null"],
            "description": "For composites: number of rows of crumb panels. Null otherwise.",
        },
        "grid_cols": {
            "type": ["integer", "null"],
            "description": "For composites: number of columns of crumb panels. Null otherwise.",
        },
        "panels": {
            "type": ["array", "null"],
            "description": "For composites: one entry per crumb panel, reading "
            "left-to-right then top-to-bottom. Read the text label printed on or "
            "next to each panel to determine the author's diagnosis for it.",
            "items": {
                "type": "object",
                "properties": {
                    "row": {"type": "integer", "description": "0-indexed row"},
                    "col": {"type": "integer", "description": "0-indexed column"},
                    "label": {
                        "type": ["string", "null"],
                        "enum": LABELS + [None],
                        "description": "Author's diagnosis for this panel per its "
                        "embedded text. Null if the panel has no readable label "
                        "and can't be confidently judged.",
                    },
                    "panel_text": {
                        "type": ["string", "null"],
                        "description": "The literal text printed on/near this panel, if any.",
                    },
                },
                "required": ["row", "col", "label", "panel_text"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "is_crumb_content", "is_composite", "single_label",
        "single_confidence", "grid_rows", "grid_cols", "panels",
    ],
    "additionalProperties": False,
}

PROMPT = """Analyze this image from a sourdough baking article.

Classify crumb into a 5-point fermentation scale:
{criteria}

Terminology mapping (map the author's words onto the scale):
- underproofed / underproved / underfermented / "needs more time" / dense /
  gummy / "fool's crumb" -> under_fermented (or slightly_under if the text/photo
  says only a little)
- overproofed / overproved / overfermented / collapsed / "went too long" ->
  over_fermented (or slightly_over if only just past peak)
- perfect / ideal / "properly proofed" / "nailed it" / good open crumb ->
  properly_fermented
Many comparison charts show a PROGRESSION (e.g. 4-6 loaves from raw-under to
badly-over). Map the endpoints to under/over and the in-between stages to
slightly_under / properly_fermented / slightly_over by where they sit in the row.

If the image is a composite chart with multiple crumb photos, READ THE TEXT on
or beside each panel — the author's printed label is the ground truth, not your
visual judgment. Report the grid layout and each panel's label in reading order.

If it's a single crumb photo, use embedded text first, then the page context
below (if any), then the visual criteria above. Set confidence honestly: reserve
'high' for a clear photo or an explicit printed label; use 'low' when you are
guessing between adjacent classes (e.g. proper vs slightly_over) — low-confidence
items are filtered out by --min-confidence.
{context}"""

MAX_DIM = 1568


def encode_image(path: Path) -> tuple[str, str] | None:
    try:
        img = Image.open(path)
        img.load()
    except Exception:
        return None
    if img.width < 100 or img.height < 100:
        return None
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if max(img.size) > MAX_DIM:
        scale = MAX_DIM / max(img.size)
        img = img.resize((int(img.width * scale), int(img.height * scale)))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.standard_b64encode(buf.getvalue()).decode(), "image/jpeg"


def crop_panel(path: Path, rows: int, cols: int, row: int, col: int) -> Image.Image:
    img = Image.open(path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.width / cols, img.height / rows
    # inset 3% to trim divider lines and label strips at panel edges
    ix, iy = w * 0.03, h * 0.03
    return img.crop((
        int(col * w + ix), int(row * h + iy),
        int((col + 1) * w - ix), int((row + 1) * h - iy),
    ))


def analyze(client, model: str, path: Path, context: str) -> dict | None:
    enc = encode_image(path)
    if enc is None:
        return None
    data, media_type = enc
    ctx = f"\nPage context for this image: {context}" if context else ""
    response = client.messages.create(
        model=model,
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image",
                 "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": PROMPT.format(criteria=LABEL_CRITERIA, context=ctx)},
            ],
        }],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    )
    if response.stop_reason == "refusal":
        return None
    text = next((b.text for b in response.content if b.type == "text"), None)
    return json.loads(text) if text else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="indir", default="dataset")
    ap.add_argument("--out", dest="outdir", default="dataset_clean")
    ap.add_argument("--model", default="claude-opus-4-8",
                    help="claude-haiku-4-5 is ~5x cheaper, slightly less accurate")
    ap.add_argument("--context-file", default=None,
                    help="Optional JSON mapping filename -> page context string "
                         "(alt text / caption saved by the scraper)")
    ap.add_argument("--min-confidence", default="medium",
                    choices=["high", "medium", "low"],
                    help="Discard single images below this label confidence")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is not set. Get a key at "
                 "console.anthropic.com (billing must be active), then:\n"
                 "  export ANTHROPIC_API_KEY=sk-ant-...")
    client = anthropic.Anthropic()
    # Preflight: one cheap call so a bad key fails once, not once per image.
    try:
        client.messages.create(model=args.model, max_tokens=1,
                               messages=[{"role": "user", "content": "hi"}])
    except anthropic.AuthenticationError:
        sys.exit("API key was rejected (401). Check that the key is active "
                 "and your workspace has billing enabled at "
                 "console.anthropic.com.")
    contexts: dict[str, str] = {}
    if args.context_file and os.path.exists(args.context_file):
        contexts = json.loads(Path(args.context_file).read_text())

    conf_rank = {"low": 0, "medium": 1, "high": 2}
    min_conf = conf_rank[args.min_confidence]

    stats = {"kept": 0, "split_panels": 0, "rejected_not_crumb": 0,
             "rejected_low_conf": 0, "relabeled": 0, "errors": 0}
    counts: dict[str, int] = {}

    files = sorted(p for p in Path(args.indir).rglob("*")
                   if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    print(f"Curating {len(files)} images with {args.model}\n")

    for i, path in enumerate(files, 1):
        scraper_label = path.parent.name if path.parent.name in LABELS else None
        try:
            result = analyze(client, args.model, path, contexts.get(path.name, ""))
        except Exception as e:
            print(f"  [{i}/{len(files)}] ERROR {path.name}: {e}")
            stats["errors"] += 1
            continue
        if result is None:
            stats["errors"] += 1
            continue

        if not result["is_crumb_content"]:
            print(f"  [{i}/{len(files)}] reject (not crumb): {path.name}")
            stats["rejected_not_crumb"] += 1
            continue

        if result["is_composite"] and result["panels"]:
            rows = result["grid_rows"] or 1
            cols = result["grid_cols"] or 1
            saved = 0
            for p in result["panels"]:
                if p["label"] not in LABELS:
                    continue
                if not (0 <= p["row"] < rows and 0 <= p["col"] < cols):
                    continue
                dest_dir = Path(args.outdir) / p["label"]
                dest_dir.mkdir(parents=True, exist_ok=True)
                panel_img = crop_panel(path, rows, cols, p["row"], p["col"])
                dest = dest_dir / f"{path.stem}_r{p['row']}c{p['col']}.jpg"
                panel_img.save(dest, quality=92)
                counts[p["label"]] = counts.get(p["label"], 0) + 1
                saved += 1
            print(f"  [{i}/{len(files)}] composite {rows}x{cols} -> {saved} panels: {path.name}")
            stats["split_panels"] += saved
            continue

        label = result["single_label"]
        conf = result["single_confidence"] or "low"
        if label not in LABELS or conf_rank[conf] < min_conf:
            print(f"  [{i}/{len(files)}] reject (label={label}, conf={conf}): {path.name}")
            stats["rejected_low_conf"] += 1
            continue
        if scraper_label and label != scraper_label:
            stats["relabeled"] += 1
        dest_dir = Path(args.outdir) / label
        dest_dir.mkdir(parents=True, exist_ok=True)
        Image.open(path).convert("RGB").save(dest_dir / f"{path.stem}.jpg", quality=92)
        counts[label] = counts.get(label, 0) + 1
        stats["kept"] += 1
        flag = " (relabeled)" if scraper_label and label != scraper_label else ""
        print(f"  [{i}/{len(files)}] keep {label} [{conf}]{flag}: {path.name}")

    print("\n=== Curation summary ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    print(f"  class counts: {counts}")
    print(f"\nClean dataset in {args.outdir}/ — train with:")
    print(f"  python3 tools/train_crumb_model.py --data {args.outdir}")
    print("\nPer-class floor is ~15; target 100+. slightly_under / slightly_over")
    print("are the hardest to source — if they stay thin, see the fallback in")
    print("docs/crumb-model-integration.md before training.")


if __name__ == "__main__":
    main()
