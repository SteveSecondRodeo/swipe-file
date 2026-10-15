#!/usr/bin/env python3
"""Scan the media folders and rebuild data/library.json for the site.

Folder convention (inside any top-level "collection" folder, e.g. "Always on"):
  <Collection>/Reels/<Category>/<video>.mp4        -> one video idea each
  <Collection>/Static/[<Category>/]<image>.jpg     -> one static idea each
  <Collection>/Carousel/[<Category>/]<Concept>/... -> one carousel per folder of images
  <Collection>/Carousel/<image>.png                -> single-image carousel (e.g. panoramas)

Labels live in data/labels.json, keyed by the file/folder path. Anything without a
label is listed in data/unlabelled.json so the weekly task can label it.

Uses only the Python standard library plus macOS `sips` and `qlmanage` for thumbnails.
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
THUMBS = ROOT / "thumbs"
RESERVED = {"assets", "data", "scripts", "thumbs", "docs", "node_modules"}

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
THUMB_SIZE = 640
GITHUB_FILE_LIMIT_MB = 95

FORMAT_ALIASES = {
    "video": {"reels", "reel", "videos", "video", "tiktok", "tiktoks"},
    "static": {"static", "statics", "images", "image", "posts"},
    "carousel": {"carousel", "carousels"},
}

# Junk camera/app filenames that make bad titles.
JUNK_NAME = re.compile(r"^(reactnativeblobutiltmp_|img_|dsc_|pxl_|videoframe_|[0-9a-f]{16,})", re.I)


# Names with no meaningful order (hashes, app temp files).
RANDOM_NAME = re.compile(r"^(reactnativeblobutiltmp_|[0-9a-f]{16,})", re.I)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def natural_key(p):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def item_id(rel):
    return hashlib.sha1(rel.encode()).hexdigest()[:10]


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def format_for(folder_name):
    name = folder_name.strip().lower()
    for fmt, aliases in FORMAT_ALIASES.items():
        if name in aliases:
            return fmt
    return None


def mp4_duration(path):
    """Read duration in seconds from an MP4/MOV moov/mvhd box. None if unreadable."""
    try:
        with open(path, "rb") as f:
            size = os.path.getsize(path)
            return _find_mvhd(f, 0, size)
    except (OSError, struct.error):
        return None


def _find_mvhd(f, start, end):
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        box_size, box_type = struct.unpack(">I4s", f.read(8))
        header = 8
        if box_size == 1:
            box_size = struct.unpack(">Q", f.read(8))[0]
            header = 16
        elif box_size == 0:
            box_size = end - pos
        if box_size < header:
            return None
        if box_type == b"moov":
            return _find_mvhd(f, pos + header, pos + box_size)
        if box_type == b"mvhd":
            version = f.read(1)[0]
            f.read(3)
            if version == 1:
                f.read(16)
                timescale, duration = struct.unpack(">IQ", f.read(12))
            else:
                f.read(8)
                timescale, duration = struct.unpack(">II", f.read(8))
            return round(duration / timescale, 1) if timescale else None
        pos += box_size
    return None


def image_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
                         capture_output=True, text=True).stdout
    w = re.search(r"pixelWidth: (\d+)", out)
    h = re.search(r"pixelHeight: (\d+)", out)
    return (int(w.group(1)), int(h.group(1))) if w and h else (None, None)


def make_thumb(src, dest, is_video, sources):
    """Create a JPEG thumbnail if missing, stale, or made from a different file."""
    rel = str(src.relative_to(ROOT))
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime and sources.get(dest.stem) == rel:
        return True
    sources[dest.stem] = rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = src
    tmp = None
    if is_video:
        tmp = tempfile.mkdtemp()
        subprocess.run(["qlmanage", "-t", "-s", str(THUMB_SIZE * 2), "-o", tmp, str(src)],
                       capture_output=True)
        pngs = list(Path(tmp).glob("*.png"))
        if not pngs:
            shutil.rmtree(tmp, ignore_errors=True)
            return False
        source = pngs[0]
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "78",
                    "-Z", str(THUMB_SIZE), str(source), "--out", str(dest)], capture_output=True)
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
    return dest.exists()


def pretty_title(name):
    stem = Path(name).stem if Path(name).suffix else name
    if JUNK_NAME.match(stem):
        return None
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    stem = re.sub(r"\s+\d+$", "", stem)
    return stem[:1].upper() + stem[1:] if stem else None


def iso_mtime(path):
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).date().isoformat()


def scan():
    category_map = load_json(DATA / "categories.json", {"categories": [], "aliases": {}})
    aliases = {k.lower(): v for k, v in category_map.get("aliases", {}).items()}

    def folder_categories(parts):
        cats = []
        for part in parts:
            key = part.strip().lower()
            cats += aliases.get(key, [slug(part)])
        return list(dict.fromkeys(cats))

    found = []  # (rel, type, collection, folder_cats, media_files)
    warnings = []

    for collection in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        if collection.name.startswith(".") or collection.name.lower() in RESERVED:
            continue
        for fmt_dir in sorted(p for p in collection.iterdir() if p.is_dir()):
            fmt = format_for(fmt_dir.name)
            if not fmt:
                continue
            for dirpath, dirnames, filenames in os.walk(fmt_dir):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                here = Path(dirpath)
                sub = here.relative_to(fmt_dir).parts
                files = sorted((here / f for f in filenames if not f.startswith(".")), key=natural_key)
                videos = [f for f in files if f.suffix.lower() in VIDEO_EXT]
                images = [f for f in files if f.suffix.lower() in IMAGE_EXT]

                for f in files:
                    if f.stat().st_size > GITHUB_FILE_LIMIT_MB * 1024 * 1024:
                        warnings.append(f"Over {GITHUB_FILE_LIMIT_MB}MB (GitHub will reject): {f.relative_to(ROOT)}")

                if fmt == "carousel":
                    slides = [f for f in files if f.suffix.lower() in IMAGE_EXT | VIDEO_EXT]
                    if any(RANDOM_NAME.match(f.stem) for f in slides):
                        # Random download names carry no order; download time does.
                        slides.sort(key=lambda f: f.stat().st_mtime)
                    if slides and sub:
                        # This folder is one carousel (photo and video slides); parent folders are categories.
                        found.append((str(here.relative_to(ROOT)), "carousel", collection.name,
                                      folder_categories(sub[:-1]), slides))
                    else:
                        for s in slides:
                            found.append((str(s.relative_to(ROOT)), "carousel", collection.name,
                                          folder_categories(sub), [s]))
                    continue

                for v in videos:
                    found.append((str(v.relative_to(ROOT)), "video", collection.name,
                                  folder_categories(sub), [v]))
                for img in images:
                    found.append((str(img.relative_to(ROOT)), "static", collection.name,
                                  folder_categories(sub), [img]))
    return found, warnings, category_map


def build():
    DATA.mkdir(exist_ok=True)
    labels = load_json(DATA / "labels.json", {})
    found, warnings, category_map = scan()

    thumb_sources = load_json(THUMBS / "sources.json", {})
    items, unlabelled = [], []
    for rel, kind, collection, folder_cats, media in found:
        iid = item_id(rel)
        first = media[0]
        thumb = THUMBS / f"{iid}.jpg"
        has_thumb = make_thumb(first, thumb, first.suffix.lower() in VIDEO_EXT, thumb_sources)
        w, h = image_size(thumb) if has_thumb else (None, None)

        label = labels.get(rel, {})
        name = Path(rel).name
        fallback_title = pretty_title(name) or (f"{folder_cats[0].replace('-', ' ').title()} idea" if folder_cats else "Untitled idea")
        cats = list(dict.fromkeys(label.get("categories", []) + folder_cats))

        item = {
            "id": iid,
            "path": rel,
            "type": kind,
            "collection": collection,
            "title": label.get("title") or fallback_title,
            "description": label.get("description", ""),
            "categories": cats,
            "tags": label.get("tags", []),
            "thumb": str(thumb.relative_to(ROOT)) if has_thumb else None,
            "w": w,
            "h": h,
            "added": label.get("added") or iso_mtime(first),
            "media": [str(m.relative_to(ROOT)) for m in media],
            "bytes": sum(m.stat().st_size for m in media),
        }
        if kind == "video":
            item["duration"] = mp4_duration(first)
        if not label:
            item["unlabelled"] = True
            unlabelled.append({"path": rel, "type": kind, "thumb": item["thumb"],
                               "folder_categories": folder_cats,
                               "slides": item["media"] if kind == "carousel" else None})
        items.append(item)

    items.sort(key=lambda i: (i["added"], i["path"]), reverse=True)

    known = {c["id"]: c for c in category_map.get("categories", [])}
    counts = {}
    for it in items:
        for c in it["categories"]:
            counts[c] = counts.get(c, 0) + 1
    categories = [{"id": cid, "name": known.get(cid, {}).get("name", cid.replace("-", " ").title()),
                   "count": counts.get(cid, 0)}
                  for cid in list(known) + sorted(c for c in counts if c not in known)]

    library = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "categories": categories,
        "collections": sorted({i["collection"] for i in items}),
        "items": items,
    }
    (DATA / "library.json").write_text(json.dumps(library, indent=1, ensure_ascii=False))
    (DATA / "unlabelled.json").write_text(json.dumps(unlabelled, indent=1, ensure_ascii=False))

    # Remove thumbnails for items that no longer exist.
    live = {f"{i['id']}.jpg" for i in items}
    thumb_sources = {k: v for k, v in thumb_sources.items() if f"{k}.jpg" in live}
    (THUMBS / "sources.json").write_text(json.dumps(thumb_sources, indent=1, sort_keys=True))
    for t in THUMBS.glob("*.jpg"):
        if t.name not in live:
            t.unlink()

    by_type = {}
    for i in items:
        by_type[i["type"]] = by_type.get(i["type"], 0) + 1
    print(f"{len(items)} items " + ", ".join(f"{v} {k}" for k, v in sorted(by_type.items())))
    print(f"{len(unlabelled)} need labels (see data/unlabelled.json)")
    for w in warnings:
        print("WARNING:", w, file=sys.stderr)


if __name__ == "__main__":
    build()
