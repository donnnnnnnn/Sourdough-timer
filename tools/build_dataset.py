#!/usr/bin/env python3
"""Collect CANDIDATE crumb photos. Labeling happens later, in curate_dataset.py.

This is a deliberately *dumb* collector. It does NOT try to guess whether an
image is under/over/properly fermented — every past attempt to label by page
keywords or URL slugs produced garbage (logos, headshots, mislabeled crumbs).
The rule we learned the hard way (see CLAUDE.md lessons #1 and #4): heuristics
can't judge image *content*; a vision model can. So this stage's only job is to
cast a wide, clean net of candidate images and hand them to Claude vision.

Pipeline:

    1. tools/build_dataset.py   --out dataset_raw     # THIS FILE: collect candidates
    2. tools/curate_dataset.py  --in dataset_raw \\
                                --out dataset_clean \\
                                --context-file dataset_raw/contexts.json
                                                       # Claude vision labels into 5 buckets
    3. tools/train_crumb_model.py --data dataset_clean # train + export TFLite

Run this on your own machine (needs normal internet):

    python3 -m pip install beautifulsoup4 playwright pymupdf
    python3 -m playwright install chromium
    python3 tools/build_dataset.py --out dataset_raw

Sources:
  - Blogs : a hand-curated list of pages known to contain crumb photos and
            proof-comparison charts. We download every substantial image on the
            page with its alt text / caption / source URL as context. No slug
            guessing, no site-search URL discovery — those were the bug factory.
  - PDFs  : every image over a min size from the reference books. Text on the
            page is saved as context so the curator can read printed labels.
  - Reddit: OFF by default and OAuth-only. Reddit killed anonymous JSON search;
            fighting it is a time sink for low yield. See --reddit below.

Validate before scaling (CLAUDE.md lesson #1): run with --limit 2 first, open a
few files under dataset_raw/, confirm they're real crumb photos, THEN run full.
"""
import argparse
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"}
MIN_BYTES = 15_000       # skip icons, sprites, tiny thumbnails
MIN_DIM = 200            # (PDF images) skip anything smaller than this on a side
_SKIP_SRC_RE = re.compile(r'\.(svg|gif|ico|css|js|woff2?|ttf|eot)(\?|$)', re.I)

# ── curated image sources ──────────────────────────────────────────────────
#
# Every page below has been chosen because it actually shows sliced-crumb
# photos, ideally side-by-side proof comparisons (which curate_dataset.py can
# split into one labeled training image per panel — our highest-yield source).
#
# HOW TO GROW THIS LIST (do NOT let a script guess URLs):
#   1. Open the site's proofing / troubleshooting / "how to read your crumb"
#      guide in a browser and confirm with your own eyes it has crumb photos.
#   2. Paste the exact, working URL here. A dead or redirecting URL just yields
#      zero images and a log line — it can't poison the dataset — but keep the
#      list honest so the per-source counts stay meaningful.
#
# Tag pages that contain a labeled comparison GRID with "# grid" so a human
# skimming this file knows which sources feed the panel-splitter.
BLOG_PAGES = [
    # The Sourdough Journey — proof-progression photo grids (highest yield)
    "https://thesourdoughjourney.com/the-ultimate-sourdough-bulk-fermentation-guide/",  # grid
    "https://thesourdoughjourney.com/faq-over-under-proofed/",                          # grid
    "https://thesourdoughjourney.com/what-is-a-good-sourdough-crumb/",
    "https://thesourdoughjourney.com/how-to-read-sourdough-crumb/",
    "https://thesourdoughjourney.com/the-mysteries-of-bulk-fermentation/",
    # The Perfect Loaf
    "https://www.theperfectloaf.com/guides/whats-the-difference-between-over-and-under-proofed-bread-dough/",  # grid
    "https://www.theperfectloaf.com/guides/proofing-bread-dough/",
    "https://www.theperfectloaf.com/how-to-use-the-dough-poke-test/",
    "https://www.theperfectloaf.com/troubleshooting-sourdough-bread/",
    # King Arthur Baking
    "https://www.kingarthurbaking.com/blog/2021/10/01/sourdough-bread-common-mistakes",
    "https://www.kingarthurbaking.com/blog/2023/03/21/sourdough-troubleshooting",
    # Challenger Breadware
    "https://challengerbreadware.com/bread-techniques/identifying-proofing-levels-in-baked-bread/",  # grid
    # The Clever Carrot
    "https://www.theclevercarrot.com/2019/03/sourdough-bread-troubleshooting-guide/",
    # Brød & Taylor
    "https://brodandtaylor.com/blogs/recipes/sourdough-bread-problems-and-solutions",
    # The Fresh Loaf — community crumb-reading threads
    "https://www.thefreshloaf.com/node/71162/read-my-crumb-please",
    "https://www.thefreshloaf.com/node/68071/reading-crumb",
]

# ── Playwright (renders JS-heavy pages; falls back to urllib) ───────────────
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


def fetch_html(url: str, rendered: bool = True) -> str | None:
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
            print(f"    playwright failed {url}: {e} — trying urllib")
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception as e:
        print(f"    fetch failed {url}: {e}")
        return None


try:
    from bs4 import BeautifulSoup
    BS4 = True
except ImportError:
    BS4 = False


# ── dedup: by source URL AND by image content hash ─────────────────────────
# CDNs serve the same photo at many sizes (?w=300, ?w=1024, /photo-768x512.jpg).
# URL dedup alone lets the same crumb in 5x — which quietly biases training.
# So we also hash the downloaded bytes and skip content we've already saved.

def _img_srcs_from_tag(tag) -> list[str]:
    srcs = []
    for attr in ("src", "data-src", "data-lazy-src", "data-original"):
        v = tag.get(attr, "")
        if v and not v.startswith("data:"):
            srcs.append(v.strip())
    srcset = tag.get("srcset") or tag.get("data-srcset") or ""
    if srcset:
        # last entry in a srcset is the highest-resolution variant
        parts = [p.strip().split()[0] for p in srcset.split(",") if p.strip()]
        if parts:
            srcs.append(parts[-1])
    return srcs


def _context_for(tag, page_url: str) -> str:
    """Alt text + nearest caption + source page — everything the curator needs
    to read a printed label or understand where the image came from."""
    alt = (tag.get("alt") or "").strip()
    cap = ""
    fig = tag.find_parent("figure")
    if fig and fig.find("figcaption"):
        cap = fig.find("figcaption").get_text(" ", strip=True)
    return " | ".join(x for x in [alt, cap, f"from {page_url}"] if x)


def collect_blogs(outdir: str, limit: int | None,
                  seen_urls: set, seen_hashes: set,
                  contexts: dict) -> dict:
    print("\n=== Blogs ===")
    if not BS4:
        print("  bs4 not installed — run: pip install beautifulsoup4")
        return {}
    dest_dir = os.path.join(outdir, "candidates")
    os.makedirs(dest_dir, exist_ok=True)
    per_source: dict[str, int] = {}

    pages = BLOG_PAGES[:limit] if limit else BLOG_PAGES
    for page in pages:
        html = fetch_html(page, rendered=True)
        if not html:
            per_source[page] = 0
            continue
        soup = BeautifulSoup(html, "html.parser")
        tags = soup.find_all("img") + soup.find_all("source")
        saved = 0
        for tag in tags:
            for src in _img_srcs_from_tag(tag):
                if not src or _SKIP_SRC_RE.search(src):
                    continue
                full = urllib.parse.urljoin(page, src)
                if not full.startswith("http") or full in seen_urls:
                    continue
                seen_urls.add(full)
                data = _download_bytes(full)
                if data is None or len(data) < MIN_BYTES:
                    continue
                digest = hashlib.md5(data).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                name = _safe_name(full, digest)
                with open(os.path.join(dest_dir, name), "wb") as f:
                    f.write(data)
                contexts[name] = _context_for(tag, page)
                saved += 1
                time.sleep(0.3)
        per_source[page] = saved
        print(f"  {saved:3d}  {page}")
    return per_source


def _download_bytes(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read()
    except Exception:
        return None


def _safe_name(url: str, digest: str) -> str:
    base = re.sub(r"\W+", "_", url.split("?")[0].split("/")[-1])[:60]
    if not re.search(r"\.(jpe?g|png|webp)$", base, re.I):
        base += ".jpg"
    # prefix a short hash so different photos never collide on a shared filename
    return f"{digest[:8]}_{base}"


# ── PDFs (reference books) ─────────────────────────────────────────────────

def collect_pdfs(pdf_paths: list[str], outdir: str,
                 seen_hashes: set, contexts: dict) -> dict:
    print("\n=== PDFs ===")
    try:
        import fitz  # pymupdf
    except ImportError:
        print("  pymupdf not installed — run: pip install pymupdf")
        return {}
    dest_dir = os.path.join(outdir, "candidates")
    os.makedirs(dest_dir, exist_ok=True)
    per_source: dict[str, int] = {}

    for pdf_path in pdf_paths:
        if not os.path.exists(pdf_path):
            print(f"  not found: {pdf_path}")
            continue
        doc = fitz.open(pdf_path)
        stem = Path(pdf_path).stem
        saved = 0
        for page_index in range(len(doc)):
            page = doc[page_index]
            page_text = page.get_text().strip().replace("\n", " ")
            for img_index, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                except Exception:
                    continue
                if pix.width < MIN_DIM or pix.height < MIN_DIM:
                    continue
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                data = pix.tobytes("png")
                digest = hashlib.md5(data).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                name = f"{digest[:8]}_{stem}_p{page_index+1:03d}_i{img_index}.png"
                with open(os.path.join(dest_dir, name), "wb") as f:
                    f.write(data)
                # nearby page text is often the printed caption / label
                contexts[name] = f"{page_text[:300]} | from {stem} p{page_index+1}"
                saved += 1
        per_source[pdf_path] = saved
        print(f"  {saved:3d}  {pdf_path}")
    return per_source


# ── Reddit (opt-in, OAuth only) ────────────────────────────────────────────

def collect_reddit(outdir: str, seen_hashes: set, contexts: dict) -> dict:
    print("\n=== Reddit ===")
    cid = os.environ.get("REDDIT_CLIENT_ID")
    secret = os.environ.get("REDDIT_CLIENT_SECRET")
    if not (cid and secret):
        print("  REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set — skipping.\n"
              "  Anonymous Reddit JSON is rate-limited/blocked since 2023. To use\n"
              "  Reddit, create a free 'script' app at\n"
              "  https://www.reddit.com/prefs/apps and export both env vars.\n"
              "  (Low priority: blogs + PDFs are a cleaner, higher-yield source.)")
        return {}
    try:
        token = _reddit_token(cid, secret)
    except Exception as e:
        print(f"  auth failed: {e} — skipping Reddit")
        return {}

    queries = ["crumb shot", "rate my crumb", "bulk fermentation result",
               "underproofed", "overproofed", "open crumb"]
    subs = ["Sourdough", "Breadit", "SourdoughStarter"]
    dest_dir = os.path.join(outdir, "candidates")
    os.makedirs(dest_dir, exist_ok=True)
    saved = 0
    for q in queries:
        for sub in subs:
            url = (f"https://oauth.reddit.com/r/{sub}/search"
                   f"?q={urllib.parse.quote(q)}&restrict_sr=1&limit=100&sort=top&t=all")
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "crumb-dataset/2.0", "Authorization": f"bearer {token}"})
                with urllib.request.urlopen(req, timeout=25) as r:
                    posts = json.load(r)["data"]["children"]
            except Exception as e:
                print(f"  skip r/{sub} '{q}': {e}")
                continue
            for post in posts:
                d = post["data"]
                title = d.get("title", "")
                for img in _reddit_image_urls(d):
                    data = _download_bytes(img)
                    if data is None or len(data) < MIN_BYTES:
                        continue
                    digest = hashlib.md5(data).hexdigest()
                    if digest in seen_hashes:
                        continue
                    seen_hashes.add(digest)
                    name = _safe_name(img, digest)
                    with open(os.path.join(dest_dir, name), "wb") as f:
                        f.write(data)
                    contexts[name] = f"{title} | r/{sub}"
                    saved += 1
                    time.sleep(0.5)
            time.sleep(1)
    print(f"  saved {saved} candidate images from Reddit")
    return {"reddit": saved}


def _reddit_token(cid: str, secret: str) -> str:
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        "https://www.reddit.com/api/v1/access_token", data=body,
        headers={"User-Agent": "crumb-dataset/2.0"})
    auth = base64_basic(cid, secret)
    req.add_header("Authorization", f"Basic {auth}")
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)["access_token"]


def base64_basic(cid: str, secret: str) -> str:
    import base64
    return base64.standard_b64encode(f"{cid}:{secret}".encode()).decode()


def _reddit_image_urls(d: dict) -> list[str]:
    urls = []
    u = d.get("url_overridden_by_dest") or d.get("url") or ""
    if re.search(r"\.(jpe?g|png)(\?|$)", u, re.I):
        urls.append(u)
    for item in (d.get("media_metadata") or {}).values():
        src = (item.get("s") or {}).get("u", "")
        if src:
            urls.append(src.replace("&amp;", "&"))
    return urls


# ── main ───────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="dataset_raw",
                    help="candidates land in <out>/candidates/ (flat, UNLABELED)")
    ap.add_argument("--limit", type=int, default=None,
                    help="only process the first N blog pages — use 1-2 to smoke-test")
    ap.add_argument("--pdfs", nargs="*", default=[],
                    help="PDF paths; default = every *.pdf in the current dir")
    ap.add_argument("--no-blogs", action="store_true")
    ap.add_argument("--no-pdf", action="store_true")
    ap.add_argument("--reddit", action="store_true",
                    help="also scrape Reddit (needs REDDIT_CLIENT_ID/SECRET)")
    args = ap.parse_args()

    os.makedirs(os.path.join(args.out, "candidates"), exist_ok=True)
    seen_urls: set[str] = set()
    seen_hashes: set[str] = set()
    contexts: dict[str, str] = {}
    report: dict[str, dict] = {}

    if not args.no_blogs:
        report["blogs"] = collect_blogs(args.out, args.limit,
                                        seen_urls, seen_hashes, contexts)
    if not args.no_pdf:
        pdfs = args.pdfs or [str(p) for p in Path(".").glob("*.pdf")]
        if pdfs:
            report["pdfs"] = collect_pdfs(pdfs, args.out, seen_hashes, contexts)
        else:
            print("\n=== PDFs ===\n  no PDFs found (put reference books in cwd or pass --pdfs)")
    if args.reddit:
        report["reddit"] = collect_reddit(args.out, seen_hashes, contexts)

    ctx_path = os.path.join(args.out, "contexts.json")
    with open(ctx_path, "w") as f:
        json.dump(contexts, f, indent=1)

    total = len(contexts)
    print("\n=== Collection summary ===")
    for source, counts in report.items():
        n = sum(counts.values()) if isinstance(counts, dict) else counts
        print(f"  {source:8s}: {n} candidate images")
    print(f"  TOTAL   : {total} unique candidate images (deduped by content hash)")
    print(f"  contexts: {ctx_path}")
    print("\nNEXT — eyeball the output BEFORE curating (CLAUDE.md lesson #2):")
    print(f"  ls {args.out}/candidates | head")
    print("Then label with Claude vision into 5 buckets:")
    print(f"  export ANTHROPIC_API_KEY=sk-ant-...")
    print(f"  python3 tools/curate_dataset.py --in {args.out} \\")
    print(f"      --out dataset_clean --context-file {ctx_path}")


if __name__ == "__main__":
    main()
