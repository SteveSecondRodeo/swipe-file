# Swipe File

A clean, filterable library of social content ideas. Every video plays in the browser, every carousel swipes, and everything downloads.

## Adding content

Drop files into the folders. Nothing else is needed; the weekly sync picks them up.

```
Always on/
  Reels/<Category>/video.mp4         one video idea per file
  Static/[<Category>/]image.jpg      one static idea per file (subfolder optional)
  Carousel/<Concept name>/...        one carousel per folder, slides can be photos or videos
  Carousel/panorama.png              a loose file is a single-image carousel
```

- **Categories** come from subfolder names (`Reels/Food`) plus tags Claude adds when labelling. To map a folder name onto existing categories, add it to `aliases` in `data/categories.json`.
- **Slide order:** carousels sort by filename. If filenames are random (hashes, app downloads), they sort by the date the file landed in the folder.
- **New collections:** any new top-level folder (e.g. `Campaigns/`) with `Reels`, `Static` or `Carousel` inside becomes its own collection.
- Keep single files under 95MB (GitHub's limit). The build warns you if one is too big.

## Instagram saves (linked ideas)

Posts from the saved collection `second-rodeo-sm-ideas` appear as linked ideas: a thumbnail, labels and a "Watch on Instagram" button. The videos are never downloaded or hosted.

1. In Chrome (logged in), open the collection and run `scripts/instagram_export.js` in the page. It downloads `swipefile-instagram-export.json`.
2. `python3 scripts/import_instagram.py ~/Downloads/swipefile-instagram-export.json` saves thumbnails and adds new posts to `data/instagram.json`.
3. Label the new posts, then rebuild. To hide a post, set `"skip": true` on it in `data/instagram.json`.

Captions are kept in `.ig_captions.json` (not committed) to help labelling and are never published.

## Labels

Every idea has a title, description, categories and technique tags in `data/labels.json`, keyed by file or folder path. Edit it by hand any time. If you rename or move a file, move its label key too, otherwise it is treated as new and relabelled.

## Weekly sync

A Claude scheduled task runs every Monday at 08:00 (while your Mac and the Claude app are open):

1. `scripts/weekly_sync.sh prepare` creates a `content/weekly-YYYY-MM-DD` branch, rescans the folders and makes 4-frame contact sheets of new videos.
2. Claude views every new item and writes its label.
3. `scripts/weekly_sync.sh publish` rebuilds the index, commits, pushes and opens a pull request. Merging it publishes the site.

If nothing changed that week, no PR is opened.

## Run it locally

```bash
python3 scripts/build_index.py
python3 -m http.server 8765
```

Then open http://localhost:8765. (Opening `index.html` directly won't work, browsers block it from loading the library data.)

## Hosting

GitHub Pages serves the repo root. Pages sites are capped at about 1GB. When the media folder gets close, move media to a bucket (Cloudflare R2 or S3) and set `MEDIA_BASE` at the top of `assets/app.js` to the bucket URL. Thumbnails stay in the repo.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `assets/` | The site |
| `data/library.json` | Generated index the site reads. Don't edit, it gets overwritten. |
| `data/labels.json` | Titles, descriptions, tags. Edit freely. |
| `data/categories.json` | Category list and folder name aliases |
| `thumbs/` | Generated thumbnails |
| `scripts/build_index.py` | Scanner and thumbnail builder (macOS: uses `sips` and `qlmanage`) |
| `scripts/contact_sheet.swift` | Makes 4-frame video previews for labelling |
| `scripts/weekly_sync.sh` | Weekly branch, commit, push and PR |
