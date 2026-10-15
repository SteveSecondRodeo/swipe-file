#!/bin/zsh
# Weekly content sync for Swipe File.
#
#   scripts/weekly_sync.sh prepare   # new branch, rescan folders, contact sheets for anything unlabelled
#   (label everything in data/unlabelled.json into data/labels.json)
#   scripts/weekly_sync.sh publish   # rebuild, commit, push, open a pull request
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

ROOT="${0:A:h:h}"
cd "$ROOT"
BRANCH="content/weekly-$(date +%Y-%m-%d)"
SHEETS="$ROOT/.sheets"

case "${1:-}" in
  prepare)
    if git remote get-url origin >/dev/null 2>&1; then
      git checkout main
      git pull --ff-only origin main
    else
      git checkout main
    fi
    git checkout -B "$BRANCH"
    python3 scripts/build_index.py

    # 4-frame contact sheets so unlabelled videos can be judged at a glance.
    rm -rf "$SHEETS" && mkdir -p "$SHEETS"
    python3 - "$SHEETS" <<'EOF'
import json, subprocess, sys, hashlib
sheets = sys.argv[1]
items = json.load(open("data/unlabelled.json"))
videos = [m for it in items for m in ([it["path"]] if it["type"] == "video" else (it["slides"] or []))
          if m.lower().endswith((".mp4", ".mov", ".m4v", ".webm"))]
for m in videos:
    out = f"{sheets}/{hashlib.sha1(m.encode()).hexdigest()[:10]}.jpg"
    subprocess.run(["swift", "scripts/contact_sheet.swift", m, out], capture_output=True)
    print(f"{m} -> {out}")
print(f"{len(items)} unlabelled items, {len(videos)} contact sheets in {sheets}")
EOF
    ;;

  publish)
    python3 scripts/build_index.py
    rm -rf "$SHEETS"
    git add -A
    if git diff --cached --quiet; then
      echo "No new content this week. Nothing to publish."
      git checkout main
      git branch -D "$BRANCH" 2>/dev/null || true
      exit 0
    fi
    COUNT=$(python3 -c "import json;print(len(json.load(open('data/library.json'))['items']))")
    git commit -m "Weekly content sync $(date +%Y-%m-%d) ($COUNT ideas)"
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "No GitHub remote yet. Changes committed on local branch $BRANCH."
      exit 0
    fi
    git push -u origin "$BRANCH"
    if command -v gh >/dev/null 2>&1; then
      gh pr create --base main --head "$BRANCH" \
        --title "Weekly content sync $(date +%Y-%m-%d)" \
        --body-file "$ROOT/.pr-body.md" 2>/dev/null \
        || gh pr create --base main --head "$BRANCH" --title "Weekly content sync $(date +%Y-%m-%d)" --body "New and changed ideas from this week's folder scan."
      rm -f "$ROOT/.pr-body.md"
    else
      echo "Pushed $BRANCH. Install the GitHub CLI (gh) to open the PR automatically, or open it on github.com."
    fi
    git checkout main
    ;;

  *)
    echo "usage: $0 prepare|publish" >&2
    exit 1
    ;;
esac
