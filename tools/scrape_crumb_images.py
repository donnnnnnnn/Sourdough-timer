#!/usr/bin/env python3
"""Collect weakly-labeled sourdough crumb photos from Reddit's public JSON API.

Run on a machine with normal internet access (not the cloud sandbox):

    python3 tools/scrape_crumb_images.py --out dataset

Labels come from the search query that found each post, so they are noisy.
Plan to hand-review the folders afterwards — deleting obvious mislabels for
10 minutes raises accuracy more than any model tweak.
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request

# query -> label. Multiple queries can map to the same label.
SEARCHES: dict[str, str] = {
    "underproofed crumb": "under_fermented",
    "underfermented crumb": "under_fermented",
    "dense gummy crumb": "under_fermented",
    "fools crumb": "under_fermented",
    "overproofed crumb": "over_fermented",
    "overfermented flat": "over_fermented",
    "perfect crumb": "properly_fermented",
    "great crumb": "properly_fermented",
    "open even crumb": "properly_fermented",
}

SUBREDDITS = ["Sourdough", "Breadit", "SourdoughStarter"]
UA = {"User-Agent": "crumb-dataset-builder/1.0 (personal research)"}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def image_urls_from_post(post: dict) -> list[str]:
    data = post["data"]
    urls = []
    u = data.get("url_overridden_by_dest") or data.get("url") or ""
    if re.search(r"\.(jpe?g|png)(\?|$)", u):
        urls.append(u)
    # gallery posts
    for item in (data.get("media_metadata") or {}).values():
        src = (item.get("s") or {}).get("u", "")
        if src:
            urls.append(src.replace("&amp;", "&"))
    return urls


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--per-query", type=int, default=100)
    args = ap.parse_args()

    counts: dict[str, int] = {}
    seen: set[str] = set()

    for query, label in SEARCHES.items():
        outdir = os.path.join(args.out, label)
        os.makedirs(outdir, exist_ok=True)
        for sub in SUBREDDITS:
            url = (
                f"https://www.reddit.com/r/{sub}/search.json"
                f"?q={urllib.parse.quote(query)}&restrict_sr=1"
                f"&limit={args.per_query}&sort=top&t=all"
            )
            try:
                posts = fetch_json(url)["data"]["children"]
            except Exception as e:
                print(f"  skip r/{sub} '{query}': {e}")
                continue
            for post in posts:
                for img in image_urls_from_post(post):
                    if img in seen:
                        continue
                    seen.add(img)
                    name = re.sub(r"\W+", "_", img.split("/")[-1])[:80]
                    dest = os.path.join(outdir, name)
                    if not dest.endswith((".jpg", ".jpeg", ".png")):
                        dest += ".jpg"
                    if os.path.exists(dest):
                        continue
                    try:
                        req = urllib.request.Request(img, headers=UA)
                        with urllib.request.urlopen(req, timeout=20) as r, open(dest, "wb") as f:
                            f.write(r.read())
                        counts[label] = counts.get(label, 0) + 1
                    except Exception as e:
                        print(f"  failed {img}: {e}")
                    time.sleep(1)  # be polite to Reddit
            print(f"r/{sub} '{query}' done; totals: {counts}")

    print("\nFinal counts per label:", counts)
    print(f"Images saved under {args.out}/<label>/")
    print("Now hand-review the folders and delete mislabeled photos.")


if __name__ == "__main__":
    main()
