#!/usr/bin/env python3
"""Extract crumb photos from the baking ebooks (Open Crumb Mastery, Hamelman).

These are the highest-quality training images we have: each figure sits next
to expert commentary on its fermentation state, so labels are reliable.

Setup:

    pip install pymupdf

Run (on the machine where the PDFs live):

    python3 tools/extract_pdf_images.py "Open Crumb Mastery Trevor Wilson (1).pdf" --out dataset_pdf

Images land in dataset_pdf/page_NNN/ so you can flip through the PDF and the
folders side by side, then move each image into dataset/<label>/ by hand:

    under_fermented / properly_fermented / over_fermented

Hand-sorting these is worth it — a few hundred well-labeled expert photos
beat thousands of noisy Reddit ones.
"""
import argparse
import os

import fitz  # PyMuPDF

MIN_DIM = 200  # skip icons and decorations


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default="dataset_pdf")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    count = 0
    for page_index in range(len(doc)):
        images = doc[page_index].get_images(full=True)
        if not images:
            continue
        pagedir = os.path.join(args.out, f"page_{page_index + 1:03d}")
        for img_index, img in enumerate(images):
            xref = img[0]
            pix = fitz.Pixmap(doc, xref)
            if pix.width < MIN_DIM or pix.height < MIN_DIM:
                continue
            if pix.colorspace and pix.colorspace.n > 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            os.makedirs(pagedir, exist_ok=True)
            pix.save(os.path.join(pagedir, f"img_{img_index}.png"))
            count += 1

    print(f"Extracted {count} images >= {MIN_DIM}px into {args.out}/page_NNN/")
    print("Sort them into dataset/<label>/ folders, then run train_crumb_model.py")


if __name__ == "__main__":
    main()
