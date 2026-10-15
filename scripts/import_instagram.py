#!/usr/bin/env python3
"""Import an Instagram saved-collection export as linked ideas (no video hosting).

Usage: python3 scripts/import_instagram.py ~/Downloads/swipefile-instagram-export.json

The export is a JSON list of {url, alt, icons, mime, b64} made in the browser from the
saved collection grid (see README). This script:
  - saves a 640px thumbnail per post to thumbs/ig_<shortcode>.jpg
  - adds new posts to data/instagram.json (url, creator, type, first-seen date)
  - writes captions to .ig_captions.json (gitignored) to help labelling; they are never published
"""
import base64
import json
import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "data" / "instagram.json"
CAPTIONS = ROOT / ".ig_captions.json"
THUMBS = ROOT / "thumbs"
URL_RE = re.compile(r"instagram\.com/([^/]+)/(p|reel)/([^/]+)/?")


def main(export_path):
    export = json.loads(Path(export_path).read_text())
    store = json.loads(STORE.read_text()) if STORE.exists() else []
    known = {p["url"] for p in store}
    captions = json.loads(CAPTIONS.read_text()) if CAPTIONS.exists() else {}
    THUMBS.mkdir(exist_ok=True)

    added = 0
    for post in export:
        m = URL_RE.search(post["url"])
        if not m:
            continue
        creator, kind, code = m.groups()
        url = f"https://www.instagram.com/{kind}/{code}/"
        if post.get("alt"):
            captions[url] = post["alt"]
        if url in known or not post.get("b64"):
            continue
        thumb = THUMBS / f"ig_{code}.jpg"
        with tempfile.NamedTemporaryFile(suffix=".img") as tmp:
            tmp.write(base64.b64decode(post["b64"]))
            tmp.flush()
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "78", "-Z", "640",
                            tmp.name, "--out", str(thumb)], capture_output=True)
        if not thumb.exists():
            print("thumbnail failed:", url, file=sys.stderr)
            continue
        if kind == "reel" or "Clip" in post.get("icons", []):
            fmt = "video"
        elif "Carousel" in post.get("icons", []):
            fmt = "carousel"
        else:
            fmt = "static"
        store.append({"url": url, "creator": creator, "type": fmt, "thumb": f"thumbs/{thumb.name}",
                      "saved": date.today().isoformat()})
        known.add(url)
        added += 1

    STORE.write_text(json.dumps(store, indent=1))
    CAPTIONS.write_text(json.dumps(captions, indent=1, ensure_ascii=False))
    print(f"{added} new Instagram posts ({len(store)} total)")


if __name__ == "__main__":
    main(sys.argv[1])
