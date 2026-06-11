#!/usr/bin/env python3
"""Auto-label crumb photos from Reddit, sourdough blogs, and PDFs, then train.

Run on your local machine (needs internet + optional PDFs in current dir):

    python3 -m pip install pymupdf beautifulsoup4 playwright tensorflow
    python3 -m playwright install chromium
    python3 tools/build_dataset.py --out dataset

Stages:
  1. Reddit   — query-based download + comment-consensus re-labeling
  2. Blogs    — HTML scraping with heading/caption-based auto-labeling
              — site search discovery finds real article URLs automatically
  3. PDFs     — image extraction with nearby-text labeling
  4. Train    — fine-tune MobileNetV3Small, export crumb_classifier.tflite

Skip stages with --no-reddit / --no-blogs / --no-pdf / --no-train
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

# ── label vocabulary ──────────────────────────────────────────────────────────────────────────────

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

UNDER_SHORT = {"under", "underproofed", "underproved", "underfermented"}
OVER_SHORT  = {"over",  "overproofed",  "overproved",  "overfermented"}
GOOD_SHORT  = {"perfect", "nailed", "gorgeous", "beautiful"}


def score_text(text: str) -> tuple[int, int, int]:
    t = text.lower()
    u = sum(1 for w in UNDER_WORDS if w in t)
    o = sum(1 for w in OVER_WORDS  if w in t)
    g = sum(1 for w in GOOD_WORDS  if w in t)
    return u, o, g


def score_words(text: str) -> tuple[int, int, int]:
    tokens = set(re.findall(r"[a-z]+", text.lower()))
    u = len(tokens & UNDER_SHORT)
    o = len(tokens & OVER_SHORT)
    g = len(tokens & GOOD_SHORT)
    return u, o, g


def majority_label(u: int, o: int, g: int) -> str | None:
    top = max(u, o, g)
    if top == 0:
        return None
    if [u, o, g].count(top) > 1:
        return None
    if u == top: return "under_fermented"
    if o == top: return "over_fermented"
    return "properly_fermented"


# ── HTTP helpers ─────────────────────────────────────────────────────────────────────────────

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"}

try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT = True
except ImportError:
    PLAYWRIGHT = False

_pw_browser = None

def _get_browser():
    global _pw_browser
    if _pw_browser is None:
        _pw = sync_playwright().start()
        _pw_browser = _pw.chromium.launch(headless=True)
    return _pw_browser


def fetch(url: str, *, is_json: bool = False, rendered: bool = False):
    if rendered and PLAYWRIGHT:
        try:
            browser = _get_browser()
            page = browser.new_page()
            page.set_extra_http_headers({"User-Agent": UA["User-Agent"]})
            page.goto(url, wait_until="networkidle", timeout=45000)
            html = page.content()
            page.close()
            return html
        except Exception as e:
            print(f"  playwright failed {url}: {e} — falling back to urllib")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        data = r.read()
    return json.loads(data) if is_json else data.decode("utf-8", "ignore")


def download(url: str, dest: str) -> bool:
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


# ── Stage 1: Reddit ───────────────────────────────────────────────────────────────────────────

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


# ── Stage 2: Blogs ───────────────────────────────────────────────────────────────────────────

try:
    from bs4 import BeautifulSoup
    BS4 = True
except ImportError:
    BS4 = False

# Confirmed-working pages only — no guessed slugs
BLOG_PAGES = [
    "https://thesourdoughjourney.com/the-ultimate-sourdough-bulk-fermentation-guide/",
    "https://thesourdoughjourney.com/faq-over-under-proofed/",
    "https://thesourdoughjourney.com/what-is-a-good-sourdough-crumb/",
    "https://thesourdoughjourney.com/how-to-read-sourdough-crumb/",
    "https://www.theperfectloaf.com/guides/proofing-bread-dough/",
    "https://www.theperfectloaf.com/how-to-use-the-dough-poke-test/",
    "https://www.theperfectloaf.com/beginners-sourdough-bread/",
    "https://www.theperfectloaf.com/guides/crumb-structure/",
    "https://www.theperfectloaf.com/troubleshooting-sourdough-bread/",
    "https://www.kingarthurbaking.com/learn/guides/sourdough",
    "https://www.kingarthurbaking.com/recipes/sourdough-bread-recipe",
    "https://www.kingarthurbaking.com/blog/2021/10/01/sourdough-bread-common-mistakes",
    "https://challengerbreadware.com/bread-techniques/identifying-proofing-levels-in-baked-bread/",
    "https://www.thefreshloaf.com/node/71162/read-my-crumb-please",
    "https://www.theclevercarrot.com/2019/03/sourdough-bread-troubleshooting-guide/",
    "https://brodandtaylor.com/blogs/recipes/proofing-bread",
    "https://brodandtaylor.com/blogs/recipes/sourdough-bread-problems-and-solutions",
]

# Pages where keyword scoring is unreliable — label is certain from context.
HARDCODED_PAGE_LABELS: dict[str, str | None] = {
    "https://www.kingarthurbaking.com/learn/guides/sourdough": "properly_fermented",
    "https://www.kingarthurbaking.com/recipes/sourdough-bread-recipe": "properly_fermented",
    "https://www.theperfectloaf.com/beginners-sourdough-bread/": "properly_fermented",
}

# Sites to search dynamically — finds real article URLs instead of guessing slugs.
# Format: (base_url, search_path_template, queries)
# WordPress uses /?s={q}, Shopify uses /search?q={q}
SEARCH_QUERIES = [
    "overproofed", "overproved", "overfermented", "over fermented",
    "underproofed", "underproved", "underfermented", "under fermented",
    "dense crumb", "gummy crumb", "tight crumb",
    "crumb evaluation", "crumb reading", "crumb debugging",
    "crumb troubleshooting", "crumb chart", "crumb structure", "open crumb",
    "bulk fermentation", "troubleshooting",
]

SEARCH_SITES: list[tuple[str, str, list[str]]] = [
    ("https://www.pantrymama.com",      "/?s={q}",        SEARCH_QUERIES),
    ("https://www.busbysbakery.com",    "/?s={q}",        SEARCH_QUERIES),
    ("https://truesourdough.com",       "/?s={q}",        SEARCH_QUERIES),
    ("https://www.theclevercarrot.com", "/?s={q}",        SEARCH_QUERIES),
    ("https://littlespoonfarm.com",     "/?s={q}",        SEARCH_QUERIES),
    ("https://thesourdoughjourney.com", "/?s={q}",        SEARCH_QUERIES),
    ("https://brodandtaylor.com",       "/search?q={q}",  SEARCH_QUERIES),
    ("https://www.theperfectloaf.com",  "/?s={q}",        SEARCH_QUERIES),
]


def discover_pages() -> list[tuple[str, str | None]]:
    """Search each site and return (url, label) for relevant posts found."""
    if not BS4:
        print("  bs4 required for page discovery — skipping")
        return []

    discovered: list[tuple[str, str | None]] = []
    seen_urls: set[str] = set()

    for base, path_tpl, queries in SEARCH_SITES:
        for q in queries:
            search_url = base + path_tpl.replace("{q}", urllib.parse.quote(q))
            try:
                html = fetch(search_url, rendered=False)
            except Exception as e:
                print(f"  search failed {search_url}: {e}")
                continue

            soup = BeautifulSoup(html, "html.parser")
            found = 0
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if not href.startswith("http"):
                    href = urllib.parse.urljoin(base, href)
                if not href.startswith(base):
                    continue
                path = urllib.parse.urlparse(href).path.rstrip("/")
                if not path or path.count("/") < 1:
                    continue
                if any(x in href for x in ["/page/", "/tag/", "/category/", "/author/", "/feed", "?", "#"]):
                    continue
                if href in seen_urls:
                    continue
                seen_urls.add(href)

                link_text = a.get_text(" ", strip=True)
                u, o, g = score_text(link_text + " " + href)
                label = majority_label(u, o, g)
                if label:
                    discovered.append((href, label))
                    found += 1

            print(f"  search '{q}' @ {base} → {found} labeled links")
            time.sleep(1)

    print(f"  total discovered: {len(discovered)} labeled candidate pages")
    return discovered


IMG_RE = re.compile(r'<img[^>]+(?:src|data-src)=["\']([^"\']+)["\']', re.I)
MIN_BYTES = 8_000
_SKIP_SRC_RE = re.compile(r'\.(svg|gif|ico|css|js|woff2?|ttf|eot)(\?|$)', re.I)


def _img_srcs_from_tag(tag) -> list[str]:
    srcs = []
    for attr in ("src", "data-src", "data-lazy-src", "data-original"):
        v = tag.get(attr, "")
        if v and not v.startswith("data:"):
            srcs.append(v.strip())
    srcset = tag.get("srcset") or tag.get("data-srcset") or ""
    if srcset:
        parts = [p.strip().split()[0] for p in srcset.split(",") if p.strip()]
        if parts:
            srcs.append(parts[-1])
    return srcs


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


def scrape_page(page: str, page_default: str | None, outdir: str, seen: set, counts: dict) -> int:
    """Fetch and scrape one page. Returns number of images saved."""
    try:
        html = fetch(page, rendered=True)
    except Exception as e:
        print(f"  skip {page}: {e}")
        return 0

    if not BS4:
        # regex fallback — no context labeling
        if page_default is None:
            page_u, page_o, page_g = score_text(html[:5000])
            page_default = majority_label(page_u, page_o, page_g)
        if page_default is None:
            return 0
        for src in IMG_RE.findall(html):
            full = urllib.parse.urljoin(page, src)
            if full in seen:
                continue
            seen.add(full)
            dest_dir = os.path.join(outdir, page_default)
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
                counts[page_default] = counts.get(page_default, 0) + 1
            except Exception:
                pass
            time.sleep(0.4)
        return counts.get(page_default, 0)

    soup = BeautifulSoup(html, "html.parser")
    imgs = soup.find_all("img")

    if page_default is None:
        page_u, page_o, page_g = score_text(soup.get_text())
        page_default = majority_label(page_u, page_o, page_g)
        if page_default is None:
            url_u, url_o, url_g = score_text(page)
            page_default = majority_label(url_u, url_o, url_g)
        print(f"    scored u={page_u} o={page_o} g={page_g} → default={page_default} | {len(imgs)} imgs")
    else:
        print(f"    hardcoded={page_default} | {len(imgs)} imgs")

    if page_default is None:
        print(f"  skip {page} — no label signal")
        return 0

    labeled = 0
    all_tags = imgs + soup.find_all("source")
    for tag in all_tags:
        for src in _img_srcs_from_tag(tag):
            if not src or _SKIP_SRC_RE.search(src):
                continue
            full = urllib.parse.urljoin(page, src)
            if not full.startswith("http"):
                continue
            label = label_from_context(tag, page) or page_default
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
            time.sleep(0.3)

    print(f"  {page} → {labeled} saved")
    return labeled


def run_blogs(outdir: str, seen: set) -> None:
    print("\n=== Stage 2: Blogs ===")
    if PLAYWRIGHT:
        print("  Playwright available")
    counts: dict[str, int] = {}

    # 2a: confirmed pages
    for page in BLOG_PAGES:
        label = HARDCODED_PAGE_LABELS.get(page)  # None means score dynamically
        scrape_page(page, label, outdir, seen, counts)

    # 2b: search-discovered pages
    print("\n  -- discovering pages via site search --")
    for page, label in discover_pages():
        if page not in seen:
            scrape_page(page, label, outdir, seen, counts)

    print("Blog totals:", counts)


# ── Stage 3: PDFs ───────────────────────────────────────────────────────────────────────────

def run_pdfs(pdf_paths: list[str], outdir: str) -> None:
    print("\n=== Stage 3: PDFs ===")
    try:
        import fitz
    except ImportError:
        print("  pymupdf not installed — skipping PDFs")
        return

    counts: dict[str, int] = {}
    for pdf_path in pdf_paths:
        if not os.path.exists(pdf_path):
            print(f"  not found: {pdf_path}")
            continue
        doc = fitz.open(pdf_path)
        for page_index in range(len(doc)):
            page = doc[page_index]
            images = page.get_images(full=True)
            if not images:
                continue
            u, o, g = score_text(page.get_text())
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


# ── Stage 4: Train ───────────────────────────────────────────────────────────────────────────

def run_train(dataset_dir: str, model_out: str, epochs: int) -> None:
    print("\n=== Stage 4: Train ===")
    try:
        import tensorflow as tf
    except ImportError:
        print("  tensorflow not installed — skipping training")
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

    import numpy as np
    class_counts = np.zeros(len(labels))
    for d in [dataset_dir + "/" + l for l in labels]:
        idx = labels.index(Path(d).name)
        class_counts[idx] = len(list(Path(d).glob("*.*"))) if Path(d).exists() else 1
    class_counts = np.maximum(class_counts, 1)
    total = class_counts.sum()
    class_weight = {i: total / (len(labels) * c) for i, c in enumerate(class_counts)}
    print("Class weights:", {labels[i]: f"{w:.2f}" for i, w in class_weight.items()})

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
    model.fit(train_ds, validation_data=val_ds, epochs=epochs, class_weight=class_weight)

    base.trainable = True
    for layer in base.layers[:-20]:
        layer.trainable = False
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-5),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(train_ds, validation_data=val_ds, epochs=4, class_weight=class_weight)

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
    print("Commit assets/model/ then wire it into visionAnalyzer.ts")


# ── main ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--model-out", default="assets/model")
    ap.add_argument("--per-query", type=int, default=100)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--pdfs", nargs="*", default=[])
    ap.add_argument("--reddit",   action="store_true",
                    help="Enable Reddit scraping (requires OAuth since 2023)")
    ap.add_argument("--no-blogs", action="store_true")
    ap.add_argument("--no-pdf",   action="store_true")
    ap.add_argument("--no-train", action="store_true")
    args = ap.parse_args()

    seen: set[str] = set()

    if args.reddit:
        run_reddit(args.out, args.per_query, seen)
    else:
        print("Skipping Reddit (pass --reddit to attempt it)")

    if not args.no_blogs:
        run_blogs(args.out, seen)

    if not args.no_pdf:
        pdf_paths = args.pdfs or [str(p) for p in Path(".").glob("*.pdf")]
        if pdf_paths:
            print(f"PDFs: {pdf_paths}")
        run_pdfs(pdf_paths, args.out)

    if not args.no_train:
        total = sum(
            len(list(Path(os.path.join(args.out, d)).glob("*")))
            for d in ["under_fermented", "properly_fermented", "over_fermented"]
            if os.path.isdir(os.path.join(args.out, d))
        )
        if total < 15:
            print(f"\nOnly {total} images — skipping training (need ≥15).")
        else:
            run_train(args.out, args.model_out, args.epochs)


if __name__ == "__main__":
    main()
