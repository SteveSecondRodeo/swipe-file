// Run on an Instagram saved-collection page (logged in) to export every post as a linked idea.
// Scrolls the grid, fetches each cover image, and downloads swipefile-instagram-export.json
// for scripts/import_instagram.py. Video files are never downloaded.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tiles = new Map();
  const grab = () => document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]').forEach((a) => {
    const url = a.href.split("?")[0];
    if (tiles.has(url)) return;
    const img = a.querySelector("img");
    if (!img) return;
    let src = img.currentSrc || img.src;
    if (img.srcset) {
      const best = img.srcset.split(",").map((s) => s.trim().split(" ")).sort((x, y) => parseInt(y[1]) - parseInt(x[1]))[0];
      if (best) src = best[0];
    }
    const icons = [...a.querySelectorAll("svg[aria-label]")].map((s) => s.getAttribute("aria-label"));
    tiles.set(url, { url, img: src, alt: (img.alt || "").slice(0, 240), icons });
  });

  await sleep(2500);
  let last = 0, stable = 0;
  while (stable < 4) {
    grab();
    window.scrollBy(0, 2500);
    await sleep(1200);
    if (tiles.size === last) stable++; else { stable = 0; last = tiles.size; }
  }
  grab();

  const toB64 = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(",")[1]); f.readAsDataURL(b); });
  const out = [];
  for (const t of tiles.values()) {
    try {
      const b = await fetch(t.img).then((r) => { if (!r.ok) throw r.status; return r.blob(); });
      out.push({ url: t.url, alt: t.alt, icons: t.icons, mime: b.type, b64: await toB64(b) });
    } catch {
      out.push({ url: t.url, alt: t.alt, icons: t.icons, b64: null });
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
  a.download = "swipefile-instagram-export.json";
  document.body.append(a);
  a.click();
  a.remove();
  return { posts: out.length, failed: out.filter((p) => !p.b64).length };
})();
