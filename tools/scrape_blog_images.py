#!/usr/bin/env python3
"""DEPRECATED — superseded by tools/build_dataset.py (blog collector) + curate_dataset.py.

Kept for reference. The new collector dedups by content hash, saves alt/caption
context for the vision curator, and renders JS-heavy pages via Playwright. Use the
flow in docs/crumb-dataset-runbook.md instead.

Download crumb photos from the expert blog pages used for the knowledge base.

The Sourdough Journey's proofing pages are the gold mine: photo grids of the
same recipe at different proof levels. Run on a machine with normal internet:

    python3 tools/scrape_blog_images.py --out dataset_blogs

Images are saved per-page; sort them into dataset/<label>/ by hand using the
captions on the source pages.
"""
import argparse
import os
import re
import time
import urllib.parse
import urllib.request

PAGES = [
    # The Sourdough Journey — proofing comparison grids
    "https://thesourdoughjourney.com/faq-bulk-fermentation-tools/",
    "https://thesourdoughjourney.com/troubleshooting/",
    "https://thesourdoughjourney.com/the-mysteries-of-bulk-fermentation/",
    # The Perfect Loaf
    "https://www.theperfectloaf.com/guides/whats-the-difference-between-over-and-under-proofed-bread-dough/",
    "https://www.theperfectloaf.com/guides/sourdough-bread-troubleshooting-guide/",
    # King Arthur
    "https://www.kingarthurbaking.com/blog/2023/03/21/sourdough-troubleshooting",
    # Challenger Breadware
    "https://challengerbreadware.com/blogs/bread-education/how-to-read-a-crumb",
    # The Fresh Loaf crumb-reading threads
    "https://www.thefreshloaf.com/node/68071/reading-crumb",
]

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) crumb-dataset-builder/1.0"}
IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+\.(?:jpe?g|png|webp))', re.I)
MIN_BYTES = 30_000  # skip thumbnails and icons


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dataset_blogs")
    args = ap.parse_args()

    total = 0
    for page in PAGES:
        slug = re.sub(r"\W+", "_", urllib.parse.urlparse(page).path).strip("_")[:60]
        outdir = os.path.join(args.out, slug or "root")
        try:
            req = urllib.request.Request(page, headers=UA)
            html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
        except Exception as e:
            print(f"skip {page}: {e}")
            continue
        urls = {urllib.parse.urljoin(page, m) for m in IMG_RE.findall(html)}
        print(f"{page} -> {len(urls)} candidate images")
        for img in sorted(urls):
            name = re.sub(r"\W+", "_", img.split("/")[-1])[:80]
            os.makedirs(outdir, exist_ok=True)
            dest = os.path.join(outdir, name)
            if os.path.exists(dest):
                continue
            try:
                req = urllib.request.Request(img, headers=UA)
                data = urllib.request.urlopen(req, timeout=20).read()
                if len(data) < MIN_BYTES:
                    continue
                with open(dest, "wb") as f:
                    f.write(data)
                total += 1
            except Exception as e:
                print(f"  failed {img}: {e}")
            time.sleep(0.5)

    print(f"\nSaved {total} images under {args.out}/")
    print("Sort into dataset/<label>/ folders, then run train_crumb_model.py")


if __name__ == "__main__":
    main()
