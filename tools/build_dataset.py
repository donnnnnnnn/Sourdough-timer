#!/usr/bin/env python3
"""Auto-label crumb photos from sourdough blogs and PDFs, then train.

Run on your local machine (needs internet + optional PDFs in current dir):

    curl -sS https://bootstrap.pypa.io/get-pip.py | python3
    python3 -m pip install pymupdf beautifulsoup4 tensorflow
    python3 tools/build_dataset.py --out dataset

Stages:
  1. Blogs    — HTML scraping with heading/caption-based auto-labeling
  2. PDFs     — image extraction with nearby-text labeling
  3. Train    — fine-tune MobileNetV3Small, export crumb_classifier.tflite

Reddit's search API requires OAuth since 2023 and is skipped by default.
Pass --reddit to attempt it anyway.

Skip stages with --no-blogs / --no-pdf / --no-train
"""
import argparse
import json
import os
import re
import shutil
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ── label vocabulary ───────────────────────────────────────────────────────────

UNDER_WORDS = [
    "underproofed", "under-proofed", "under proofed",
    "underproved", "under-proved", "under proved",
    "underfermented", "under-fermented", "under fermented",
    "underdeveloped", "under developed",
    "needs more time", "needs longer", "more time", "too short",
    "dense crumb", "gummy crumb", "fools crumb", "fool's crumb",
    "tight crumb", "not enough fermentation", "not ready",
    "bulk too short",
]

OVER_WORDS = [
    "overproofed", "over-proofed", "over proofed",
    "overproved", "over-proved", "over proved",
    "overfermented", "over-fermented", "over fermented",
    "overdeveloped", "over developed",
    "went too long", "too long", "pushed it", "too much fermentation",
    "collapsed", "flat loaf", "gassy", "alcoholic smell",
    "bulk too long",
]

GOOD_WORDS = [
    "perfectly proofed", "properly proofed", "perfect proof",
    "perfectly proved", "properly proved",
    "perfectly fermented", "properly fermented", "well fermented",
    "ideal fermentation", "spot on", "nailed it", "looks great",
    "great crumb", "perfect crumb", "open crumb", "even crumb",
    "beautiful crumb", "gorgeous crumb",
]

# Single-word shorthands used in r/sourdough comments
UNDER_SHORT = {"under", "underproofed", "underproved", "underfermented"}
OVER_SHORT  = {"over",  "overproofed",  "overproved",  "overfermented"}
GOOD_SHORT  = {"perfect", "nailed", "gorgeous", "beautiful"}


def score_text(text: str) -> tuple[int, int, int]:
    """Return (under_score, over_score, good_score) for a block of text."""
    t = text.lower()
    u = sum(1 for w in UNDER_WORDS if w in t)
    o = sum(1 for w in OVER_WORDS  if w in t)
    g = sum(1 for w in GOOD_WORDS  if w in t)
    return u, o, g


def score_words(text: str) -> tuple[int, int, int]:
    """Token-level match (for short comment lines)."""
    tokens = set(re.findall(r"[a-z]+", text.lower()))
    u = len(tokens & UNDER_SHORT)
    o = len(tokens & OVER_SHORT)
    g = len(tokens & GOOD_SHORT)
    return u, o, g


def majority_label(u: int, o: int, g: int) -> str | None:
    """Return label only when one class clearly leads."""
    top = max(u, o, g)
    if top == 0:
        return None
    if [u, o, g].count(top) > 1:
        return None  # tie → skip
    if u == top: return "under_fermented"
    if o == top: return "over_fermented"
    return "properly_fermented"


# ── HTTP helpers ───────────────────────────────────────────────────────────────

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"}

def fetch(url: str, *, is_json: bool = False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        data = r.read()
    return json.loads(data) if is_json else data.decode("utf-8", "ignore")


def download(url: str, dest: str) -> bool:
    """Download binary to dest. Returns True on success."""
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r, open(dest, "wb") as f:
            f.write(r.read())
        return True
    except Exception as e:
        print(f"    dl failed {url}: {e}")
        return False


def save_image(url: str, label: str, outdir: str, seen: set) -> bool:
    if url in seen:
        return False
    seen.add(url)
    dest_dir = os.path.join(outdir, label)
    os.makedirs(dest_dir, exist_ok=True)
    name = re.sub(r"\W+", "_", url.split("?")[0].split("/")[-1])[:80]
    if not re.search(r"\.(jpe?g|png|webp)$", name, re.I):
        name += ".jpg"
    dest = os.path.join(dest_dir, name)
    if os.path.exists(dest):
        return False
    return download(url, dest)


# ── Stage 1: Reddit (opt-in) ──────────────────────────────────────────────────

REDDIT_SEARCHES: list[tuple[str, str]] = [
    ("underproofed crumb",        "under_fermented"),
    ("under proofed crumb",       "under_fermented"),
    ("underfermented sourdough",  "under_fermented"),
    ("underproved loaf",          "under_fermented"),
    ("dense gummy crumb",         "under_fermented"),
    ("fools crumb",               "under_fermented"),
    ("overproofed crumb",         "over_fermented"),
    ("over proofed crumb",        "over_fermented"),
    ("overfermented sourdough",   "over_fermented"),
    ("overproved loaf",           "over_fermented"),
    ("flat collapsed loaf",       "over_fermented"),
    ("too much bulk fermentation","over_fermented"),
    ("perfect crumb",             "properly_fermented"),
    ("great crumb sourdough",     "properly_fermented"),
    ("open even crumb",           "properly_fermented"),
    ("nailed my bulk",            "properly_fermented"),
    ("rate my crumb",             None),
    ("crumb shot",                None),
    ("bulk fermentation result",  None),
]

SUBREDDITS = ["Sourdough", "Breadit", "SourdoughStarter"]


def reddit_comment_label(permalink: str) -> str | None:
    try:
        url = f"https://old.reddit.com{permalink}.json?limit=20&sort=top"
        data = fetch(url, is_json=True)
        time.sleep(0.5)
        comments = data[1]["data"]["children"]
        u = o = g = 0
        for c in comments:
            cd = c.get("data", {})
            body = cd.get("body", "")
            cu, co, cg = score_text(body)
            u += cu; o += co; g += cg
            wu, wo, wg = score_words(body)
            u += wu; o += wo; g += wg
        return majority_label(u, o, g)
    except Exception:
        return None


def image_urls_from_post(post: dict) -> list[str]:
    data = post["data"]
    urls = []
    u = data.get("url_overridden_by_dest") or data.get("url") or ""
    if re.search(r"\.(jpe?g|png)(\?|$)", u, re.I):
        urls.append(u)
    for item in (data.get("media_metadata") or {}).values():
        src = (item.get("s") or {}).get("u", "")
        if src:
            urls.append(src.replace("&amp;", "&"))
    return urls


def run_reddit(outdir: str, per_query: int, seen: set) -> None:
    print("\n=== Stage 1: Reddit ===")
    counts: dict[str, int] = {}

    for query, seed_label in REDDIT_SEARCHES:
        for sub in SUBREDDITS:
            url = (
                f"https://old.reddit.com/r/{sub}/search.json"
                f"?q={urllib.parse.quote(query)}&restrict_sr=1"
                f"&limit={per_query}&sort=top&t=all"
            )
            try:
                posts = fetch(url, is_json=True)["data"]["children"]
            except Exception as e:
                print(f"  skip r/{sub} '{query}': {e}")
                continue

            for post in posts:
                imgs = image_urls_from_post(post)
                if not imgs:
                    continue
                pd = post["data"]
                post_text = (pd.get("selftext") or "") + " " + (pd.get("title") or "")
                pu, po, pg = score_text(post_text)
                permalink = pd.get("permalink", "")
                comment_label = reddit_comment_label(permalink) if permalink else None
                time.sleep(0.8)
                if comment_label:
                    label = comment_label
                elif (pu + po + pg) > 0:
                    label = majority_label(pu, po, pg)
                else:
                    label = seed_label
                if label is None:
                    continue
                for img in imgs:
                    if save_image(img, label, outdir, seen):
                        counts[label] = counts.get(label, 0) + 1

            print(f"  r/{sub} '{query}' done | counts: {counts}")
            time.sleep(1)

    print("Reddit totals:", counts)


# ── Stage 2: Blogs ─────────────────────────────────────────────────────────

try:
    from bs4 import BeautifulSoup
    BS4 = True
except ImportError:
    BS4 = False

BLOG_PAGES = [
    "https://thesourdoughjourney.com/the-ultimate-sourdough-bulk-fermentation-guide/",
    "https://thesourdoughjourney.com/faq-over-under-proofed/",
    "https://thesourdoughjourney.com/tools/",
    "https://www.theperfectloaf.com/guides/proofing-bread-dough/",
    "https://www.theperfectloaf.com/how-to-use-the-dough-poke-test/",
    "https://www.kingarthurbaking.com/learn/guides/sourdough",
    "https://www.kingarthurbaking.com/blog/tag/sourdough-troubleshooting",
    "https://challengerbreadware.com/bread-techniques/identifying-proofing-levels-in-baked-bread/",
    "https://www.thefreshloaf.com/node/71162/read-my-crumb-please",
]

IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+\.(?:jpe?g|png|webp))["\']', re.I)
MIN_BYTES = 25_000


def label_from_context(tag, page_url: str) -> str | None:
    if not BS4:
        return None
    alt = (tag.get("alt") or "").lower()
    u, o, g = score_text(alt)
    if (l := majority_label(u, o, g)):
        return l
    fig = tag.find_parent("figure")
    if fig:
        cap = fig.find("figcaption")
        if cap:
            u, o, g = score_text(cap.get_text())
            if (l := majority_label(u, o, g)):
                return l
    node = tag.parent
    for _ in range(4):
        if node is None:
            break
        for heading in node.find_all_previous(["h1","h2","h3","h4","p"], limit=3):
            u, o, g = score_text(heading.get_text())
            if (l := majority_label(u, o, g)):
                return l
        node = node.parent
    return None


def run_blogs(outdir: str, seen: set) -> None:
    print("\n=== Stage 2: Blogs ===")
    if not BS4:
        print("  beautifulsoup4 not installed — falling back to regex (no context labeling)")
        print("  Install with: python3 -m pip install beautifulsoup4")

    counts: dict[str, int] = {}

    for page in BLOG_PAGES:
        try:
            html = fetch(page)
        except Exception as e:
            print(f"  skip {page}: {e}")
            continue

        if BS4:
            soup = BeautifulSoup(html, "html.parser")
            imgs = soup.find_all("img")
            page_u, page_o, page_g = score_text(soup.get_text())
            page_default = majority_label(page_u, page_o, page_g)
            labeled = 0
            for tag in imgs:
                src = tag.get("src") or tag.get("data-src") or ""
                if not re.search(r"\.(jpe?g|png|webp)", src, re.I):
                    continue
                full = urllib.parse.urljoin(page, src)
                label = label_from_context(tag, page) or page_default
                if label is None:
                    continue
                dest_dir = os.path.join(outdir, label)
                os.makedirs(dest_dir, exist_ok=True)
                name = re.sub(r"\W+", "_", full.split("?")[0].split("/")[-1])[:80]
                if not re.search(r"\.(jpe?g|png|webp)$", name, re.I):
                    name += ".jpg"
                dest = os.path.join(dest_dir, name)
                if full in seen or os.path.exists(dest):
                    seen.add(full)
                    continue
                seen.add(full)
                try:
                    req = urllib.request.Request(full, headers=UA)
                    data = urllib.request.urlopen(req, timeout=20).read()
                    if len(data) < MIN_BYTES:
                        continue
                    with open(dest, "wb") as f:
                        f.write(data)
                    counts[label] = counts.get(label, 0) + 1
                    labeled += 1
                except Exception as ex:
                    print(f"    failed {full}: {ex}")
                time.sleep(0.4)
            print(f"  {page} → {labeled} labeled images")
        else:
            page_u, page_o, page_g = score_text(html[:5000])
            label = majority_label(page_u, page_o, page_g)
            for src in IMG_RE.findall(html):
                full = urllib.parse.urljoin(page, src)
                if full in seen:
                    continue
                seen.add(full)
                if label is None:
                    continue
                dest_dir = os.path.join(outdir, label)
                os.makedirs(dest_dir, exist_ok=True)
                name = re.sub(r"\W+", "_", full.split("?")[0].split("/")[-1])[:80]
                dest = os.path.join(dest_dir, name)
                try:
                    req = urllib.request.Request(full, headers=UA)
                    data = urllib.request.urlopen(req, timeout=20).read()
                    if len(data) < MIN_BYTES:
                        continue
                    with open(dest, "wb") as f:
                        f.write(data)
                    counts[label] = counts.get(label, 0) + 1
                except Exception as ex:
                    print(f"    failed {full}: {ex}")
                time.sleep(0.4)

    print("Blog totals:", counts)


# ── Stage 3: PDFs ─────────────────────────────────────────────────────────


def run_pdfs(pdf_paths: list[str], outdir: str) -> None:
    print("\n=== Stage 3: PDFs ===")
    try:
        import fitz
    except ImportError:
        print("  pymupdf not installed — install with: python3 -m pip install pymupdf")
        return

    counts: dict[str, int] = {}

    for pdf_path in pdf_paths:
        if not os.path.exists(pdf_path):
            print(f"  not found: {pdf_path}")
            continue
        print(f"  {pdf_path}")
        doc = fitz.open(pdf_path)
        for page_index in range(len(doc)):
            page = doc[page_index]
            images = page.get_images(full=True)
            if not images:
                continue
            text = page.get_text()
            u, o, g = score_text(text)
            label = majority_label(u, o, g)
            if label is None:
                continue
            dest_dir = os.path.join(outdir, label)
            os.makedirs(dest_dir, exist_ok=True)
            for img_index, img in enumerate(images):
                xref = img[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                except Exception:
                    continue
                if pix.width < 200 or pix.height < 200:
                    continue
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                dest = os.path.join(dest_dir, f"{Path(pdf_path).stem}_p{page_index+1:03d}_i{img_index}.png")
                if not os.path.exists(dest):
                    pix.save(dest)
                    counts[label] = counts.get(label, 0) + 1

    print("PDF totals:", counts)


# ── Stage 4: Train ─────────────────────────────────────────────────────────

def run_train(dataset_dir: str, model_out: str, epochs: int) -> None:
    print("\n=== Stage 4: Train ===")
    try:
        import tensorflow as tf
    except ImportError:
        print("  tensorflow not installed — install with: python3 -m pip install tensorflow")
        return

    IMG_SIZE = 224
    train_ds, val_ds = tf.keras.utils.image_dataset_from_directory(
        dataset_dir,
        validation_split=0.2,
        subset="both",
        seed=42,
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=16,
    )
    labels = train_ds.class_names
    print("Classes:", labels)

    augment = tf.keras.Sequential([
        tf.keras.layers.RandomFlip("horizontal"),
        tf.keras.layers.RandomRotation(0.08),
        tf.keras.layers.RandomZoom(0.15),
        tf.keras.layers.RandomBrightness(0.2),
    ])

    base = tf.keras.applications.MobileNetV3Small(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
        include_preprocessing=True,
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3))
    x = augment(inputs)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(len(labels), activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(train_ds, validation_data=val_ds, epochs=epochs)

    base.trainable = True
    for layer in base.layers[:-20]:
        layer.trainable = False
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-5),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(train_ds, validation_data=val_ds, epochs=4)

    os.makedirs(model_out, exist_ok=True)
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()
    model_path = os.path.join(model_out, "crumb_classifier.tflite")
    with open(model_path, "wb") as f:
        f.write(tflite_model)
    with open(os.path.join(model_out, "labels.json"), "w") as f:
        json.dump(labels, f)

    print(f"\nSaved {model_path} ({len(tflite_model)/1e6:.1f} MB)")
    print("Commit assets/model/ then tell Claude to wire it into visionAnalyzer.ts")


# ── main ───────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="dataset",
                    help="Output directory for labeled images")
    ap.add_argument("--model-out", default="assets/model",
                    help="Where to write the TFLite model")
    ap.add_argument("--per-query", type=int, default=100,
                    help="Max Reddit posts per query per subreddit")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--pdfs", nargs="*", default=[],
                    help="PDF file paths to extract images from")
    ap.add_argument("--reddit",   action="store_true",
                    help="Attempt Reddit scraping (API requires OAuth, likely blocked)")
    ap.add_argument("--no-blogs", action="store_true")
    ap.add_argument("--no-pdf",   action="store_true")
    ap.add_argument("--no-train", action="store_true")
    args = ap.parse_args()

    seen: set[str] = set()

    if args.reddit:
        run_reddit(args.out, args.per_query, seen)
    else:
        print("Skipping Reddit (API requires OAuth since 2023 — pass --reddit to attempt)")

    if not args.no_blogs:
        run_blogs(args.out, seen)

    if not args.no_pdf:
        pdf_paths = args.pdfs
        if not pdf_paths:
            pdf_paths = [str(p) for p in Path(".").glob("*.pdf")]
            if pdf_paths:
                print(f"Auto-detected PDFs: {pdf_paths}")
        run_pdfs(pdf_paths, args.out)

    if not args.no_train:
        total = sum(
            len(list(Path(os.path.join(args.out, d)).glob("*")))
            for d in ["under_fermented", "properly_fermented", "over_fermented"]
            if os.path.isdir(os.path.join(args.out, d))
        )
        if total < 30:
            print(f"\nOnly {total} images collected — skipping training (need ≥30).")
            print("Review dataset/ folders, then re-run: python3 tools/build_dataset.py --no-blogs --no-pdf")
        else:
            run_train(args.out, args.model_out, args.epochs)


if __name__ == "__main__":
    main()
