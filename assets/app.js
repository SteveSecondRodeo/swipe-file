// Swipe File: browse, play and download social content ideas from data/library.json.
// Set MEDIA_BASE to a CDN/bucket URL if media ever moves off GitHub Pages; thumbnails stay local.
const MEDIA_BASE = "";

const FORMATS = [
  { id: "all", name: "All ideas" },
  { id: "video", name: "Videos" },
  { id: "static", name: "Statics" },
  { id: "carousel", name: "Carousels" },
];
const FORMAT_LABEL = { video: "Video", static: "Static", carousel: "Carousel" };
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
const NEW_DAYS = 10;

const $ = (sel) => document.querySelector(sel);
const els = {
  grid: $("#grid"), formats: $("#formats"), chips: $("#chips"), q: $("#q"), sort: $("#sort"),
  status: $("#status"), empty: $("#empty"), viewer: $("#viewer"), vMedia: $("#v-media"),
  toast: $("#toast"),
};

const state = { format: "all", cat: "", q: "", sort: "new", item: "" };
let library = { items: [], categories: [] };
let catNames = {};
let visible = [];
let shuffleSeed = Math.random();
let newestDate = 0;

const icons = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/></svg>',
  stack: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
};

const url = (path) => MEDIA_BASE + path.split("/").map(encodeURIComponent).join("/");
const localUrl = (path) => path.split("/").map(encodeURIComponent).join("/");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fileName = (path) => path.split("/").pop();
const fmtDuration = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const fmtBytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const isNew = (it) => newestDate - new Date(it.added) < NEW_DAYS * 864e5;

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

/* ---------- URL state ---------- */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.format = FORMATS.some((f) => f.id === p.get("format")) ? p.get("format") : "all";
  state.cat = p.get("cat") || "";
  state.q = p.get("q") || "";
  state.sort = p.get("sort") || "new";
  state.item = p.get("item") || "";
}
function writeHash(replace = true) {
  const p = new URLSearchParams();
  if (state.format !== "all") p.set("format", state.format);
  if (state.cat) p.set("cat", state.cat);
  if (state.q) p.set("q", state.q);
  if (state.sort !== "new") p.set("sort", state.sort);
  if (state.item) p.set("item", state.item);
  const h = p.toString() ? `#${p}` : location.pathname + location.search;
  replace ? history.replaceState(null, "", h) : history.pushState(null, "", h);
}

/* ---------- Filtering ---------- */
function matchesQuery(it, q) {
  if (!q) return true;
  const hay = [it.title, it.description, it.collection, it.creator ? "@" + it.creator : "", it.link ? "instagram" : "", ...it.tags, ...it.categories.map((c) => catNames[c] || c)]
    .join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w.replace(/^#/, "")));
}
function seeded(id) {
  let h = 0;
  for (const ch of id + shuffleSeed) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return h;
}
function compute() {
  const base = library.items.filter((it) => matchesQuery(it, state.q));
  const byFormat = base.filter((it) => state.format === "all" || it.type === state.format);
  visible = byFormat.filter((it) => !state.cat || it.categories.includes(state.cat));
  if (state.sort === "az") visible.sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === "shuffle") visible.sort((a, b) => seeded(a.id) - seeded(b.id));
  else visible.sort((a, b) => b.added.localeCompare(a.added) || a.title.localeCompare(b.title));
  return { base, byFormat };
}

/* ---------- Rendering ---------- */
function render() {
  const { base, byFormat } = compute();

  els.formats.innerHTML = FORMATS.map((f) => {
    const n = f.id === "all" ? base.length : base.filter((it) => it.type === f.id).length;
    return `<button data-format="${f.id}" aria-pressed="${state.format === f.id}">${f.name}<span class="count">${n}</span></button>`;
  }).join("");

  const counts = {};
  byFormat.forEach((it) => it.categories.forEach((c) => (counts[c] = (counts[c] || 0) + 1)));
  const cats = library.categories.filter((c) => counts[c.id] || c.id === state.cat);
  els.chips.innerHTML =
    `<button class="chip" data-cat="" aria-pressed="${!state.cat}">Everything</button>` +
    cats.map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="${state.cat === c.id}">${esc(c.name)}<span class="n">${counts[c.id] || 0}</span></button>`).join("") +
    library.categories.filter((c) => !counts[c.id] && c.id !== state.cat && c.count === 0)
      .map((c) => `<button class="chip" disabled title="Nothing here yet">${esc(c.name)}</button>`).join("");

  els.grid.innerHTML = visible.map(cardHtml).join("");
  els.empty.hidden = visible.length > 0;
  const parts = [state.cat && catNames[state.cat], state.q && `“${state.q}”`].filter(Boolean);
  els.status.textContent = `${visible.length} ${visible.length === 1 ? "idea" : "ideas"}${parts.length ? " for " + parts.join(", ") : ""}`;
  if (els.q.value !== state.q) els.q.value = state.q;
  els.sort.value = state.sort;
}

function cardHtml(it, i) {
  const ratio = it.w && it.h ? `${it.w} / ${it.h}` : "4 / 5";
  let badge = "";
  if (it.link) badge = `<span class="badge">${icons.ig}${it.type === "carousel" ? "Carousel" : "Reel"}</span>`;
  else if (it.type === "video") badge = `<span class="badge">${icons.play}${fmtDuration(it.duration) || "Video"}</span>`;
  else if (it.type === "carousel") badge = `<span class="badge">${icons.stack}${it.media.length}</span>`;
  const cats = it.categories.slice(0, 3).map((c) => catNames[c] || c).join(" · ");
  return `<article class="card" tabindex="0" data-id="${it.id}" style="animation-delay:${Math.min(i, 20) * 18}ms">
    <div class="card-media" style="aspect-ratio:${ratio}">
      ${it.thumb ? `<img src="${localUrl(it.thumb)}" alt="" loading="lazy" decoding="async">` : ""}
      ${badge}${isNew(it) ? '<span class="badge new">New</span>' : ""}
      ${it.link
        ? `<a class="card-dl" href="${esc(it.link)}" target="_blank" rel="noopener" aria-label="Watch ${esc(it.title)} on Instagram" title="Watch on Instagram">${icons.external}</a>`
        : `<button class="card-dl" data-dl="${it.id}" aria-label="Download ${esc(it.title)}" title="Download">${icons.download}</button>`}
    </div>
    <div class="card-body"><h3 class="card-title">${esc(it.title)}</h3><p class="card-cats">${esc(cats)}</p></div>
  </article>`;
}

/* Hover-to-play previews for videos (desktop only). */
function attachHoverPreview() {
  if (!matchMedia("(hover: hover)").matches) return;
  els.grid.addEventListener("mouseover", (e) => {
    const card = e.target.closest(".card");
    if (!card || card.querySelector("video")) return;
    const it = byId(card.dataset.id);
    const src = it && it.media.find((m) => VIDEO_RE.test(m));
    if (!src) return;
    const v = document.createElement("video");
    Object.assign(v, { src: url(src), muted: true, loop: true, playsInline: true, preload: "auto" });
    v.style.opacity = 0;
    v.addEventListener("playing", () => (v.style.opacity = 1), { once: true });
    card.querySelector(".card-media").prepend(v);
    v.play().catch(() => {});
    card.addEventListener("mouseleave", () => v.remove(), { once: true });
  });
}

/* ---------- Viewer ---------- */
let slideIndex = 0;
const byId = (id) => library.items.find((it) => it.id === id);

function openItem(id, push = true) {
  const it = byId(id);
  if (!it) return closeViewer();
  state.item = id;
  writeHash(!push);
  slideIndex = 0;
  els.viewer.hidden = false;
  document.body.style.overflow = "hidden";

  $("#v-format").textContent = `${FORMAT_LABEL[it.type]}${it.collection ? " · " + it.collection : ""}`;
  $("#v-title").textContent = it.title;
  $("#v-desc").textContent = it.description;
  $("#v-cats").innerHTML = it.categories.map((c) => `<button data-cat="${c}">${esc(catNames[c] || c)}</button>`).join("") || "<span>None yet</span>";
  $("#v-tags").innerHTML = it.tags.map((t) => `<button data-tag="${esc(t)}">${esc(t)}</button>`).join("");
  $("#v-tags").parentElement.hidden = !it.tags.length;

  const meta = [];
  if (it.link) {
    meta.push(["Creator", "@" + it.creator], ["Source", "Instagram"], ["Saved", fmtDate(it.added)]);
  } else {
  if (it.type === "video" && it.duration) meta.push(["Length", fmtDuration(it.duration)]);
  if (it.type === "carousel") meta.push(["Slides", it.media.length]);
  meta.push(["Size", fmtBytes(it.bytes)], ["Added", fmtDate(it.added)], ["File", fileName(it.path)]);
  }
  $("#v-meta").innerHTML = meta.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");

  const multi = it.media.length > 1;
  $("#v-actions").innerHTML = it.link
    ? `<a class="btn accent" href="${esc(it.link)}" target="_blank" rel="noopener">${icons.ig}Watch on Instagram</a>
       <button class="btn ghost" data-action="copy">${icons.link}Copy link</button>`
    : multi
    ? `<button class="btn accent" data-action="zip">${icons.download}Download all (${it.media.length})</button>
       <button class="btn ghost" data-action="slide">${icons.download}This slide</button>
       <button class="btn ghost" data-action="copy">${icons.link}Copy link</button>`
    : `<a class="btn accent" href="${url(it.media[0])}" download="${esc(fileName(it.media[0]))}">${icons.download}Download</a>
       <button class="btn ghost" data-action="copy">${icons.link}Copy link</button>`;

  renderMedia(it);
  const idx = visible.findIndex((v) => v.id === id);
  $("#v-prev").disabled = idx <= 0;
  $("#v-next").disabled = idx < 0 || idx >= visible.length - 1;
}

function mediaEl(path, active) {
  if (VIDEO_RE.test(path)) {
    return `<video src="${url(path)}" ${active ? "autoplay" : ""} controls loop playsinline preload="${active ? "auto" : "metadata"}"></video>`;
  }
  return `<img src="${url(path)}" alt="" decoding="async">`;
}

function renderMedia(it) {
  if (it.link) {
    els.vMedia.innerHTML = `<a class="ig-cover" href="${esc(it.link)}" target="_blank" rel="noopener" aria-label="Watch on Instagram">
        <img src="${localUrl(it.thumb)}" alt="">
        <span class="ig-play">${it.type === "carousel" ? icons.stack : icons.play}</span>
        <span class="ig-note">${icons.ig}Plays on Instagram</span>
      </a>`;
    return;
  }
  if (it.media.length === 1) {
    els.vMedia.innerHTML = mediaEl(it.media[0], true);
    return;
  }
  els.vMedia.innerHTML = `<div class="slides">
      <div class="track">${it.media.map((m, i) => `<div class="slide">${mediaEl(m, false)}</div>`).join("")}</div>
      <button class="s-arrow s-prev" aria-label="Previous slide">${icons.prev}</button>
      <button class="s-arrow s-next" aria-label="Next slide">${icons.next}</button>
      <span class="s-count"></span>
      <div class="dots">${it.media.map((_, i) => `<button aria-label="Slide ${i + 1}" data-slide="${i}"></button>`).join("")}</div>
    </div>`;
  const box = els.vMedia.querySelector(".slides");
  box.querySelector(".s-prev").onclick = () => goSlide(slideIndex - 1);
  box.querySelector(".s-next").onclick = () => goSlide(slideIndex + 1);
  box.querySelector(".dots").onclick = (e) => e.target.dataset.slide && goSlide(+e.target.dataset.slide);
  let startX = null;
  box.addEventListener("pointerdown", (e) => (startX = e.clientX));
  box.addEventListener("pointerup", (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 40) goSlide(slideIndex + (dx < 0 ? 1 : -1));
    startX = null;
  });
  goSlide(0);
}

function goSlide(i) {
  const it = byId(state.item);
  const box = els.vMedia.querySelector(".slides");
  if (!it || !box) return false;
  if (i < 0 || i >= it.media.length) return false;
  slideIndex = i;
  box.querySelector(".track").style.transform = `translateX(${-100 * i}%)`;
  box.querySelector(".s-count").textContent = `${i + 1} / ${it.media.length}`;
  box.querySelector(".s-prev").disabled = i === 0;
  box.querySelector(".s-next").disabled = i === it.media.length - 1;
  box.querySelectorAll(".dots button").forEach((d, n) => d.setAttribute("aria-current", n === i));
  box.querySelectorAll(".slide video").forEach((v, n) => {
    const slide = v.closest(".slide");
    const active = [...slide.parentElement.children].indexOf(slide) === i;
    if (active) v.play().catch(() => {}); else v.pause();
  });
  return true;
}

function stepItem(dir) {
  const idx = visible.findIndex((v) => v.id === state.item);
  const next = visible[idx + dir];
  if (next) openItem(next.id, false);
}

function closeViewer() {
  els.viewer.hidden = true;
  els.vMedia.innerHTML = "";
  document.body.style.overflow = "";
  const last = state.item;
  state.item = "";
  writeHash();
  const card = last && els.grid.querySelector(`[data-id="${last}"]`);
  if (card) card.focus({ preventScroll: false });
}

/* ---------- Downloads ---------- */
function downloadFile(path) {
  const a = document.createElement("a");
  a.href = url(path);
  a.download = fileName(path);
  document.body.append(a);
  a.click();
  a.remove();
}

async function downloadZip(it) {
  if (!window.JSZip) {
    it.media.forEach((m, i) => setTimeout(() => downloadFile(m), i * 400));
    return;
  }
  toast(`Zipping ${it.media.length} slides…`);
  const zip = new JSZip();
  await Promise.all(it.media.map(async (m, i) => {
    const blob = await fetch(url(m)).then((r) => r.blob());
    zip.file(`${String(i + 1).padStart(2, "0")}-${fileName(m)}`, blob);
  }));
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${it.title.replace(/[^\w\- ]+/g, "").trim() || "carousel"}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Events ---------- */
function bind() {
  els.formats.addEventListener("click", (e) => {
    const b = e.target.closest("[data-format]");
    if (!b) return;
    state.format = b.dataset.format;
    writeHash(); render();
  });
  els.chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.cat = b.dataset.cat === state.cat ? "" : b.dataset.cat;
    writeHash(); render();
    b.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  });
  let t;
  els.q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = els.q.value.trim(); writeHash(); render(); }, 120);
  });
  els.sort.addEventListener("change", () => { state.sort = els.sort.value; shuffleSeed = Math.random(); writeHash(); render(); });
  $("#shuffle").addEventListener("click", () => {
    const pool = visible.length ? visible : library.items;
    openItem(pool[Math.floor(Math.random() * pool.length)].id);
  });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, { format: "all", cat: "", q: "" });
    writeHash(); render();
  });

  els.grid.addEventListener("click", (e) => {
    const dl = e.target.closest("[data-dl]");
    if (dl) {
      e.stopPropagation();
      const it = byId(dl.dataset.dl);
      return it.media.length > 1 ? downloadZip(it) : downloadFile(it.media[0]);
    }
    const card = e.target.closest(".card");
    if (card) openItem(card.dataset.id);
  });
  els.grid.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("card")) openItem(e.target.dataset.id);
  });

  els.viewer.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeViewer();
    const cat = e.target.closest("[data-cat]");
    if (cat) { state.cat = cat.dataset.cat; closeViewer(); render(); writeHash(); return; }
    const tag = e.target.closest("[data-tag]");
    if (tag) { state.q = tag.dataset.tag; state.cat = ""; closeViewer(); render(); writeHash(); return; }
    const act = e.target.closest("[data-action]");
    if (!act) return;
    const it = byId(state.item);
    if (act.dataset.action === "zip") downloadZip(it);
    if (act.dataset.action === "slide") downloadFile(it.media[slideIndex]);
    if (act.dataset.action === "copy") {
      navigator.clipboard.writeText(location.href).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
    }
  });
  $("#intro-inspire").addEventListener("click", () => $("#shuffle").click());
  $("#terms-link").addEventListener("click", (e) => {
    e.preventDefault();
    const terms = $("#terms");
    terms.open = true;
    terms.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#v-prev").addEventListener("click", () => stepItem(-1));
  $("#v-next").addEventListener("click", () => stepItem(1));

  document.addEventListener("keydown", (e) => {
    const typing = /input|select|textarea/i.test(document.activeElement.tagName);
    if (els.viewer.hidden) {
      if (e.key === "/" && !typing) { e.preventDefault(); els.q.focus(); }
      if (e.key === "Escape" && typing) els.q.blur();
      return;
    }
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); stepItem(1); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); stepItem(-1); }
    else if (e.key === "ArrowRight") { if (!goSlide(slideIndex + 1)) stepItem(1); }
    else if (e.key === "ArrowLeft") { if (!goSlide(slideIndex - 1)) stepItem(-1); }
  });

  window.addEventListener("hashchange", () => {
    readHash(); render();
    if (state.item) openItem(state.item, false);
    else if (!els.viewer.hidden) closeViewer();
  });
}

async function init() {
  readHash();
  bind();
  attachHoverPreview();
  try {
    library = await fetch("data/library.json", { cache: "no-cache" }).then((r) => r.json());
  } catch {
    els.status.textContent = "Couldn't load the library. If you opened index.html directly, run it through a local server (see README).";
    return;
  }
  catNames = Object.fromEntries(library.categories.map((c) => [c.id, c.name]));
  newestDate = Math.max(...library.items.map((it) => new Date(it.added)));
  renderFan();
  render();
  if (state.item) openItem(state.item, false);
}

/* A fanned hand of random thumbnails in the intro. */
function renderFan() {
  const pool = library.items.filter((it) => it.thumb).sort(() => Math.random() - 0.5).slice(0, 7);
  const mid = (pool.length - 1) / 2;
  $("#intro-fan").innerHTML = pool.map((it, i) => {
    const off = i - mid;
    return `<img src="${localUrl(it.thumb)}" alt="" data-id="${it.id}" style="--r:${off * 6}deg;--y:${Math.abs(off) * 7}px;--d:${i * 60}ms;z-index:${10 - Math.abs(Math.round(off))}">`;
  }).join("");
  $("#intro-fan").onclick = (e) => e.target.dataset.id && openItem(e.target.dataset.id);
}

init();
