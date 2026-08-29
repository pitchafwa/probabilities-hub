/* Probabilities Hub — frontend. Reads committed JSON, renders the terminal
   dashboard, and (with a GitHub PAT) edits data/watchlist.json via the
   Contents API. No build step, no framework. */
"use strict";

// ---------------------------------------------------------------- config/state
const LS = {
  theme: "ph.theme",
  token: "ph.ghToken",
  repo: "ph.repo",
  branch: "ph.branch",
  order: "ph.order",
};

const DEFAULTS = { repo: "pitchafwa/probabilities-hub", branch: "main" };

const STALE_AFTER_MS = 45 * 60 * 1000; // dashboard "stale" if data older than this
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

const CATEGORY_META = {
  politics: { label: "Politics — Elections", order: 1 },
  economics: { label: "Economics — Fed / Macro", order: 2 },
  sports: { label: "Sports — NFL / NBA", order: 3 },
  crypto: { label: "Crypto", order: 4 },
  entertainment: { label: "Entertainment — Awards", order: 5 },
  other: { label: "Other", order: 8 },
};

const state = {
  markets: [],
  history: { series: {} },
  headlines: { byMarket: {} },
  watchlist: [],
  updatedAt: null,
  fetchError: null,
};

// ---------------------------------------------------------------- tiny helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

function fmtVol(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}

function fmtAddedDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

function fmtPts(pts) {
  const a = Math.abs(pts);
  return (a < 10 ? a.toFixed(1) : Math.round(a).toString());
}

function trendClass(pts) {
  if (pts == null) return "flat";
  if (pts > 0.05) return "up";
  if (pts < -0.05) return "down";
  return "flat";
}

function arrow(pts) {
  if (pts == null) return "·";
  if (pts > 0.05) return "▲"; // ▲
  if (pts < -0.05) return "▼"; // ▼
  return "▬"; // ▬
}

// ---------------------------------------------------------------- config access
function cfg() {
  const repoStr = localStorage.getItem(LS.repo) || DEFAULTS.repo;
  const [owner, repo] = repoStr.split("/");
  return {
    owner: owner || "",
    repo: repo || "",
    repoStr,
    branch: localStorage.getItem(LS.branch) || DEFAULTS.branch,
    token: localStorage.getItem(LS.token) || "",
  };
}

// ---------------------------------------------------------------- card ordering
// User-defined card order, per device. A flat list of market ids across every
// category; each category section sorts its own markets by their index here.
function getOrder() {
  try {
    const v = JSON.parse(localStorage.getItem(LS.order) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function saveOrder(ids) {
  try {
    localStorage.setItem(LS.order, JSON.stringify(ids.map(String)));
  } catch {}
}
// Rebuild the order list from what's currently in the DOM (after a drag / keyboard move).
function commitOrderFromDom() {
  const ids = $$("#sections .section .grid .card")
    .map((c) => c.dataset.id)
    .filter(Boolean);
  // Preserve any ids not currently shown (e.g. a market mid-add) at the tail.
  const shown = new Set(ids);
  const tail = getOrder().filter((id) => !shown.has(id));
  saveOrder([...ids, ...tail]);
}
function sortByOrder(list) {
  const order = getOrder();
  const rank = (id) => {
    const i = order.indexOf(String(id));
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return list
    .map((m, i) => [m, i])
    .sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1])
    .map(([m]) => m);
}

// ---------------------------------------------------------------- data loading
async function loadJSON(path) {
  const res = await fetch(`${path}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function loadAll() {
  const results = await Promise.allSettled([
    loadJSON("./data/markets.json"),
    loadJSON("./data/history.json"),
    loadJSON("./data/headlines.json"),
    loadJSON("./data/watchlist.json"),
  ]);
  const [markets, history, headlines, watchlist] = results;

  if (markets.status === "fulfilled") {
    state.markets = (markets.value.markets || []).map((m) => ({ ...m }));
    state.updatedAt = markets.value.updatedAt || null;
    state.marketErrors = markets.value.errors || [];
    state.fetchError = null;
  } else {
    state.fetchError = markets.reason?.message || String(markets.reason);
  }
  if (history.status === "fulfilled") state.history = history.value || { series: {} };
  if (headlines.status === "fulfilled") state.headlines = headlines.value || { byMarket: {} };
  if (watchlist.status === "fulfilled" && Array.isArray(watchlist.value)) {
    state.watchlist = watchlist.value;
  }
}

// ---------------------------------------------------------------- delta / trend
// Change in probability (percentage points) over the trailing `windowMs`.
function deltaOver(id, windowMs) {
  const pts = state.history?.series?.[id];
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const now = Date.now();
  const latest = pts[pts.length - 1];
  const cutoff = now - windowMs;
  let base = null;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (new Date(pts[i].t).getTime() <= cutoff) { base = pts[i]; break; }
  }
  if (!base) base = pts[0]; // not enough span yet — use earliest we have
  const span = new Date(latest.t).getTime() - new Date(base.t).getTime();
  if (span < windowMs * 0.25) return null; // too little history to be meaningful
  // Whole-event series track the favorite; a lead change makes the delta meaningless.
  if (base.l && latest.l && base.l !== latest.l) return null;
  return Math.round((latest.p - base.p) * 10) / 10;
}

// 7d delta with Polymarket's own weekly change as a fallback while history builds.
function weekDelta(m) {
  const d = deltaOver(m.id, WEEK);
  if (d != null) return d;
  if (typeof m.oneWeekPriceChange === "number") {
    return Math.round(m.oneWeekPriceChange * 100 * 10) / 10;
  }
  return null;
}

function trendingMovers(limit = 6) {
  const rows = [];
  for (const m of state.markets) {
    if (m.pending) continue;
    const d = deltaOver(m.id, DAY);
    if (d == null || Math.abs(d) < 0.5) continue;
    rows.push({ m, d });
  }
  rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------- rendering
function sparkline(id) {
  const pts = state.history?.series?.[id];
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const w = 200, h = 26, pad = 2;
  const vals = pts.slice(-24).map((p) => p.p);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = (w - pad * 2) / (vals.length - 1);
  const d = vals
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = vals[vals.length - 1], first = vals[0];
  const stroke = last > first ? "var(--up)" : last < first ? "var(--down)" : "var(--sub)";
  const svg = `<svg class="card__spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.5"/></svg>`;
  const tpl = document.createElement("template");
  tpl.innerHTML = svg.trim();
  return tpl.content.firstChild;
}

function headlineEls(id) {
  const items = state.headlines?.byMarket?.[id] || [];
  if (!items.length) return null;
  const box = el("div", { class: "card__news" });
  for (const it of items.slice(0, 3)) {
    box.append(
      el(
        "a",
        { href: it.url, target: "_blank", rel: "noopener noreferrer", title: it.title },
        el("span", { class: "outlet", text: (it.outlet || "news") + " · " }),
        it.title
      )
    );
  }
  return box;
}

// Mini leaderboard for a multi-way event (Super Bowl winner, crowded primary…).
function outcomeBoard(m) {
  const box = el("div", { class: "card__board" });
  for (const o of m.outcomes) {
    const row = el(
      "div",
      { class: "ob__row" + (o.tracked ? " is-tracked" : "") + (o.outside ? " is-outside" : "") },
      el("span", { class: "ob__label", title: o.label, text: o.label }),
      el("span", { class: "ob__pct", text: Math.round(o.probability) + "%" })
    );
    box.append(row);
  }
  const more = m.outcomeCount - m.outcomes.filter((o) => !o.outside).length;
  if (more > 0) {
    box.append(el("div", { class: "ob__more", text: `+${more} more on Polymarket` }));
  }
  return box;
}

function marketCard(m, opts = {}) {
  const wk = weekDelta(m);
  const multi = !opts.trend && m.isMultiOutcome && Array.isArray(m.outcomes) && m.outcomes.length;

  const card = el("div", {
    class: "card" + (opts.trend ? " card--trend" : "") + (multi ? " card--multi" : ""),
    "data-id": m.id,
  });

  if (!opts.trend) {
    card.append(
      el("button", {
        class: "card__grip",
        "aria-label": "Reorder " + (m.question || "market") + " — drag, or press arrow keys",
        title: "Drag to reorder (or focus + ↑/↓)",
        text: "⠿",
      })
    );
  }
  if (opts.trend) {
    card.append(el("div", { class: "card__rank", text: opts.rankLabel || "" }));
  }

  const qLink = el(
    "a",
    { href: m.url || "#", target: "_blank", rel: "noopener noreferrer" },
    m.question || "Untitled market"
  );
  card.append(el("div", { class: "card__q" }, qLink));

  if (multi) {
    card.append(outcomeBoard(m));
  } else {
    const prob = m.probability == null ? "—" : Math.round(m.probability) + "%";
    const probCls = m.probability == null ? "flat" : m.probability >= 50 ? "up" : "down";
    card.append(el("div", { class: "card__prob " + probCls, text: prob }));
  }

  // Delta line. For multi-outcome cards it's labelled with the tracked outcome.
  if (opts.trend) {
    const d = opts.delta;
    card.append(
      el("div", { class: "card__delta " + trendClass(d), text: `${arrow(d)} ${fmtPts(d)} pts (24h)` })
    );
  } else if (m.pending) {
    card.append(el("div", { class: "card__delta flat", text: "· pending first refresh" }));
  } else {
    let prefix = "";
    if (m.kind === "event") {
      const w = String(m.leaderLabel || "").trim().split(/\s+/);
      prefix = (w[w.length - 1] || "fav").slice(0, 12) + " fav ";
    } else if (multi) {
      const tl = (m.outcomes.find((o) => o.tracked) || {}).label || "";
      const w = tl.trim().split(/\s+/);
      prefix = (w[w.length - 1] || tl).slice(0, 12) + " ";
    }
    const noData = m.kind === "event" ? "· favorite trend builds over time" : "· no 7d data yet";
    card.append(
      el(
        "div",
        { class: "card__delta " + trendClass(wk) },
        wk == null ? noData : `${prefix}${arrow(wk)} ${fmtPts(wk)} pts (7d)`
      )
    );
  }

  if (!opts.trend) {
    const spark = sparkline(m.id);
    if (spark) card.append(spark);

    card.append(
      el(
        "div",
        { class: "card__meta" },
        el("span", { text: "VOL " + fmtVol(m.volume) }),
        el("span", { text: "ADDED " + fmtAddedDate(m.addedDate) })
      )
    );

    const news = headlineEls(m.id);
    if (news) card.append(news);

    const rm = el("button", {
      class: "card__remove",
      "aria-label": "Remove " + (m.question || "market"),
      title: "Remove from dashboard",
      text: "✕",
      onclick: () => removeMarket(m),
    });
    card.append(rm);
  }

  return card;
}

// ---------------------------------------------------------------- drag to reorder
function getDragAfterElement(container, x, y) {
  const els = $$(".card:not(.is-dragging)", container);
  let best = null;
  let bestDist = Infinity;
  for (const el of els) {
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  if (!best) return null;
  const b = best.getBoundingClientRect();
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const before = y < cy - 4 || (Math.abs(y - cy) <= b.height / 2 && x < cx);
  return before ? best : best.nextElementSibling;
}

function enableDnD(grid) {
  $$(".card", grid).forEach((card) => {
    const grip = $(".card__grip", card);
    if (!grip) return;

    const arm = () => { card.draggable = true; };
    const disarm = () => { card.draggable = false; };
    grip.addEventListener("mousedown", arm);
    grip.addEventListener("touchstart", arm, { passive: true });
    card.addEventListener("mouseup", disarm);

    card.addEventListener("dragstart", (e) => {
      card.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", card.dataset.id || ""); } catch {}
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      disarm();
      commitOrderFromDom();
    });

    grip.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      if (e.key === "ArrowUp" && card.previousElementSibling) {
        grid.insertBefore(card, card.previousElementSibling);
      } else if (e.key === "ArrowDown" && card.nextElementSibling) {
        grid.insertBefore(card.nextElementSibling, card);
      } else {
        return;
      }
      commitOrderFromDom();
      grip.focus();
    });
  });

  grid.addEventListener("dragover", (e) => {
    const dragging = $(".is-dragging", grid);
    if (!dragging) return; // dragging from another section — ignore
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const after = getDragAfterElement(grid, e.clientX, e.clientY);
    if (after == null) grid.appendChild(dragging);
    else if (after !== dragging) grid.insertBefore(dragging, after);
  });
  grid.addEventListener("drop", (e) => e.preventDefault());
}

function sectionEl(title, count, cards) {
  const sec = el("section", { class: "section" });
  sec.append(
    el(
      "h2",
      { class: "section__title" },
      "// " + title,
      el("span", { class: "count", text: count != null ? `[${count}]` : "" }),
      el("span", { class: "section__rule" })
    )
  );
  if (!cards.length) {
    sec.append(el("div", { class: "empty", text: "No markets in this section yet." }));
  } else {
    const grid = el("div", { class: "grid" });
    cards.forEach((c) => grid.append(c));
    sec.append(grid);
  }
  return sec;
}

function render() {
  renderClock();
  renderBanners();
  renderTicker();

  const root = $("#sections");
  root.textContent = "";

  if (state.fetchError && !state.markets.length) {
    root.append(
      el("div", { class: "empty" },
        el("p", { text: "Could not load market data." }),
        el("p", { class: "hint", text: state.fetchError }),
        el("p", { class: "hint", text: "If this is a fresh deploy, the first scheduled data refresh may not have run yet." })
      )
    );
    return;
  }

  if (!state.markets.length) {
    root.append(
      el("div", { class: "empty" },
        el("p", { text: "No markets tracked yet." }),
        el("p", { class: "hint", text: 'Hit "+ Add" to search Polymarket and pin your first market.' })
      )
    );
    return;
  }

  // Data-driven category sections.
  const groups = new Map();
  for (const m of state.markets) {
    const key = (m.category || "other").toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const ordered = Array.from(groups.keys()).sort((a, b) => {
    const oa = CATEGORY_META[a]?.order ?? 90;
    const ob = CATEGORY_META[b]?.order ?? 90;
    return oa - ob || a.localeCompare(b);
  });
  for (const key of ordered) {
    const label = CATEGORY_META[key]?.label || key.replace(/\b\w/g, (c) => c.toUpperCase());
    const items = sortByOrder(groups.get(key));
    const cards = items.map((m) => marketCard(m));
    const sec = sectionEl(label, cards.length, cards);
    const grid = $(".grid", sec);
    if (grid) enableDnD(grid);
    root.append(sec);
  }

  // Trending (all categories, 24h movers).
  const movers = trendingMovers();
  const trendCards = movers.map(({ m, d }, i) =>
    marketCard(m, { trend: true, delta: d, rankLabel: `#${i + 1}` })
  );
  const trendSec = sectionEl("Trending Now — 24h movers, all categories", trendCards.length || null, trendCards);
  if (!movers.length) {
    trendSec.querySelector(".empty, .grid")?.remove();
    trendSec.append(
      el("div", { class: "empty", text: "Not enough price history yet — movers appear after ~24h of refreshes." })
    );
  }
  root.append(trendSec);
}

function renderClock() {
  const c = $("#clock");
  if (!state.updatedAt) {
    c.textContent = "no data yet";
    c.classList.add("is-stale");
    return;
  }
  const age = Date.now() - new Date(state.updatedAt).getTime();
  const stale = age > STALE_AFTER_MS;
  const mins = Math.max(0, Math.round(age / 60000));
  const rel = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
  c.innerHTML = `<span class="dot"></span>${stale ? "STALE" : "LIVE"} — updated ${rel} · SRC: POLYMARKET`;
  c.classList.toggle("is-stale", stale);
}

function renderBanners() {
  const box = $("#banners");
  box.textContent = "";
  if (state.updatedAt) {
    const age = Date.now() - new Date(state.updatedAt).getTime();
    if (age > STALE_AFTER_MS) {
      box.append(
        el("div", { class: "banner banner--warn" },
          `Data is ${Math.round(age / 60000)} min old — the refresh workflow may be delayed or failing. Check the repo's Actions tab.`)
      );
    }
  }
  if (state.marketErrors && state.marketErrors.length) {
    box.append(
      el("div", { class: "banner banner--warn" },
        `${state.marketErrors.length} market(s) failed to update in the last run: ` +
        state.marketErrors.map((e) => e.id).join(", "))
    );
  }
}

function renderTicker() {
  const t = $("#ticker");
  const items = state.markets.filter((m) => !m.pending && m.probability != null);
  if (!items.length) {
    t.innerHTML = '<div class="ticker--empty">no tracked markets</div>';
    return;
  }
  const makeRun = () => {
    const frag = document.createDocumentFragment();
    for (const m of items) {
      const d = deltaOver(m.id, DAY);
      const sym = tickerSymbol(m);
      const span = el("span", { class: "ticker__item" },
        el("span", { class: "ticker__sym", text: sym }),
        el("span", { class: "ticker__px", text: Math.round(m.probability) + "%" })
      );
      if (d != null) {
        span.append(el("span", { class: "ticker__d " + trendClass(d), text: `${arrow(d)} ${fmtPts(d)}` }));
      }
      frag.append(span);
    }
    return frag;
  };
  const track = el("div", { class: "ticker__track" });
  track.append(makeRun());
  track.append(makeRun()); // duplicate for seamless -50% scroll
  t.textContent = "";
  t.append(track);
}

const TICKER_STOP = new Set(
  ("will the a an of in on at to by for and or is are be after before with vs win wins " +
    "control party next new market resolve").split(" ")
);
function tickerSymbol(m) {
  const words = (m.question || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w) && !TICKER_STOP.has(w.toLowerCase()));
  const pick = words.slice(0, 3).map((w) => w.slice(0, 4));
  return (pick.join("·") || "MKT").slice(0, 16);
}

// ---------------------------------------------------------------- theme
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function initTheme() {
  const saved = localStorage.getItem(LS.theme);
  applyTheme(saved || "dark");
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });
}

// ---------------------------------------------------------------- modals
let lastFocus = null;
function openModal(id) {
  const m = document.getElementById(id);
  lastFocus = document.activeElement;
  m.hidden = false;
  const focusable = m.querySelector("input, select, button");
  focusable?.focus();
  document.addEventListener("keydown", escClose);
}
function closeModal(m) {
  m.hidden = true;
  document.removeEventListener("keydown", escClose);
  lastFocus?.focus();
}
function escClose(e) {
  if (e.key === "Escape") $$(".modal:not([hidden])").forEach(closeModal);
}
function wireModals() {
  $$(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.hasAttribute("data-close")) closeModal(m);
    });
  });
  $("#addBtn").addEventListener("click", () => { openModal("addModal"); $("#searchInput").focus(); });
  $("#settingsBtn").addEventListener("click", () => { fillSettings(); openModal("settingsModal"); });
}

// ---------------------------------------------------------------- settings
function fillSettings() {
  const c = cfg();
  $("#repoInput").value = c.repoStr;
  $("#branchInput").value = c.branch;
  $("#repoSlug").textContent = c.repoStr;
  $("#tokenInput").value = "";
  const tag = $("#tokenState");
  tag.textContent = c.token ? "set" : "not set";
  tag.classList.toggle("is-set", !!c.token);
  $("#dataInfo").textContent = state.updatedAt
    ? `Last data refresh: ${new Date(state.updatedAt).toLocaleString()}`
    : "No data refresh recorded yet.";
}
function wireSettings() {
  $("#tokenSave").addEventListener("click", () => {
    const v = $("#tokenInput").value.trim();
    if (!v) return;
    localStorage.setItem(LS.token, v);
    fillSettings();
    toast("Token saved to this browser.");
  });
  $("#tokenClear").addEventListener("click", () => {
    localStorage.removeItem(LS.token);
    fillSettings();
    toast("Token cleared.");
  });
  $("#repoSave").addEventListener("click", () => {
    const repo = $("#repoInput").value.trim();
    const branch = $("#branchInput").value.trim() || "main";
    if (!/^[^/]+\/[^/]+$/.test(repo)) { toast("Repo must be owner/repo."); return; }
    localStorage.setItem(LS.repo, repo);
    localStorage.setItem(LS.branch, branch);
    fillSettings();
    toast("Repo config saved.");
  });
}

function toast(msg, kind = "warn") {
  const box = $("#banners");
  const b = el("div", { class: "banner banner--" + kind, text: msg });
  box.prepend(b);
  setTimeout(() => b.remove(), 6000);
}

// ---------------------------------------------------------------- search (live)
let searchTimer = null;
function wireSearch() {
  const input = $("#searchInput");
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch(input.value); });
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 350);
  });
}

async function runSearch(q) {
  q = (q || "").trim();
  const box = $("#searchResults");
  if (q.length < 3) { box.textContent = ""; return; }
  box.innerHTML = '<div class="spinner">// searching Polymarket…</div>';
  try {
    const url =
      "https://gamma-api.polymarket.com/public-search?q=" +
      encodeURIComponent(q) +
      "&limit_per_type=20&events_status=active";
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const rows = flattenSearch(data);
    renderSearchResults(rows);
  } catch (err) {
    box.innerHTML = "";
    box.append(el("div", { class: "empty", text: "Search failed: " + (err.message || err) }));
  }
}

function priceOf(m) {
  try {
    const p = JSON.parse(m.outcomePrices || "[]").map(Number)[0];
    return isFinite(p) ? Math.round(p * 1000) / 10 : null;
  } catch {
    return null;
  }
}

function flattenSearch(data) {
  const tracked = new Set(state.watchlist.map((w) => String(w.id)));
  const groups = [];

  for (const ev of data.events || []) {
    const kids = (ev.markets || [])
      .filter((m) => !m.closed && m.active !== false)
      .map((m) => ({
        id: String(m.id),
        question: m.groupItemTitle ? `${ev.title} — ${m.groupItemTitle}` : m.question || ev.title,
        label: m.groupItemTitle || m.question || "—",
        description: (ev.description || m.description || "").replace(/\s+/g, " ").slice(0, 200),
        probability: priceOf(m),
        volume: Math.round(Number(m.volumeNum) || 0),
        url: `https://polymarket.com/event/${ev.slug}`,
        slug: ev.slug,
      }));
    if (!kids.length) continue;

    const serious = kids
      .filter((k) => k.probability != null && k.probability >= 1)
      .sort((a, b) => b.probability - a.probability);
    const eventTracked = tracked.has(`event:${ev.id}`);
    const rows = [];

    // Whole-event row first, for multi-way races.
    if (serious.length >= 3) {
      rows.push({
        kind: "event",
        id: `event:${ev.id}`,
        eventId: String(ev.id),
        question: ev.title,
        description: (ev.description || "").replace(/\s+/g, " ").slice(0, 200),
        probability: serious[0].probability,
        leaderLabel: serious[0].label,
        outcomeCount: serious.length,
        outcomes: serious.slice(0, 6).map((k) => ({ label: k.label, probability: k.probability })),
        volume: Math.round(Number(ev.volume) || 0),
        url: `https://polymarket.com/event/${ev.slug}`,
        already: eventTracked,
      });
    }
    for (const k of kids.sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1))) {
      rows.push({
        ...k,
        already: tracked.has(k.id) || eventTracked,
        inEvent: eventTracked && !tracked.has(k.id),
      });
    }
    groups.push({ vol: Math.max(...kids.map((k) => k.volume), Number(ev.volume) || 0), rows });
  }

  groups.sort((a, b) => b.vol - a.vol);
  return groups.flatMap((g) => g.rows).slice(0, 40);
}

function guessCategory(text) {
  const s = text.toLowerCase();
  if (/\b(senate|house|governor|president|election|midterm|congress|gop|democrat|republican)\b/.test(s)) return "politics";
  if (/\b(fed|rate cut|fomc|inflation|recession|jobs report|gdp)\b/.test(s)) return "economics";
  if (/\b(nfl|nba|super bowl|playoff|mvp|championship|world series|stanley cup)\b/.test(s)) return "sports";
  if (/\b(bitcoin|ethereum|btc|eth|crypto|solana)\b/.test(s)) return "crypto";
  if (/\b(oscar|grammy|emmy|box office|album)\b/.test(s)) return "entertainment";
  return "other";
}

function renderSearchResults(rows) {
  const box = $("#searchResults");
  box.textContent = "";
  if (!rows.length) {
    box.append(el("div", { class: "empty", text: "No open markets matched." }));
    return;
  }
  const tpl = $("#categoryPickerTpl");
  for (const r of rows) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    if (r.kind === "event") node.classList.add("result--event");

    const q = $(".result__q", node);
    if (r.kind === "event") {
      q.append(el("span", { class: "result__tag", text: `▚ whole event · ${r.outcomeCount} outcomes` }));
      q.append(document.createTextNode(" " + r.question));
    } else {
      q.textContent = r.question;
    }

    $(".result__desc", node).textContent = r.description || "";
    $(".result__meta", node).textContent =
      r.kind === "event"
        ? `leader ${r.leaderLabel} ${r.probability}% · ${fmtVol(r.volume)} vol`
        : (r.probability != null ? r.probability + "% · " : "") + fmtVol(r.volume) + " vol";

    const sel = $("select", node);
    sel.value = guessCategory(r.question + " " + (r.description || ""));

    const btn = $("button", node);
    if (r.already) {
      btn.textContent = r.inEvent ? "In event" : "Added";
      btn.disabled = true;
      btn.classList.add("btn--ghost");
    } else {
      btn.textContent = r.kind === "event" ? "Add event" : "Add";
      btn.addEventListener("click", () => addMarket(r, sel.value, btn));
    }
    box.append(node);
  }
}

// ---------------------------------------------------------------- watchlist writes
function b64utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function ghContents(method, body) {
  const c = cfg();
  if (!c.token) throw new Error("No GitHub token set — open Settings and add one.");
  if (!c.owner || !c.repo) throw new Error("Repo not configured (owner/repo).");
  const api = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/data/watchlist.json`;
  const url = method === "GET" ? `${api}?ref=${encodeURIComponent(c.branch)}&_=${Date.now()}` : api;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${json.message || res.statusText}`);
  return json;
}

async function commitWatchlist(nextList, message) {
  let sha;
  try {
    const cur = await ghContents("GET");
    sha = cur.sha;
  } catch (err) {
    if (!/GitHub 404/.test(err.message)) throw err; // 404 = file doesn't exist yet
  }
  await ghContents("PUT", {
    message,
    branch: cfg().branch,
    content: b64utf8(JSON.stringify(nextList, null, 2) + "\n"),
    ...(sha ? { sha } : {}),
  });
}

async function addMarket(r, category, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  const isEvent = r.kind === "event";
  const addedDate = new Date().toISOString().slice(0, 10);
  const entry = isEvent
    ? {
        id: `event:${r.eventId}`,
        platform: "polymarket",
        kind: "event",
        eventId: String(r.eventId),
        question: r.question,
        category,
        addedDate,
      }
    : { id: String(r.id), platform: "polymarket", question: r.question, category, addedDate };

  const next = [...state.watchlist.filter((w) => String(w.id) !== entry.id), entry];
  try {
    await commitWatchlist(next, `watchlist: add ${entry.question}`);
    state.watchlist = next;
    // Optimistic card so it shows immediately.
    if (!state.markets.some((m) => m.id === entry.id)) {
      state.markets.push(
        isEvent
          ? {
              ...entry,
              isMultiOutcome: true,
              outcomeCount: r.outcomeCount,
              outcomes: (r.outcomes || []).map((o) => ({ ...o, tracked: false })),
              probability: r.probability,
              leaderLabel: r.leaderLabel,
              volume: r.volume,
              url: r.url,
              pending: true,
            }
          : { ...entry, probability: r.probability, volume: r.volume, url: r.url, pending: true }
      );
    }
    render();
    if (btn) { btn.textContent = "Added"; btn.classList.add("btn--ghost"); }
    toast("Added. The dashboard fills in fully on the next scheduled data refresh.", "warn");
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = "Add"; }
    toast("Add failed: " + (err.message || err));
  }
}

async function removeMarket(m) {
  if (!confirm(`Remove "${m.question}" from the dashboard?`)) return;
  const next = state.watchlist.filter((w) => String(w.id) !== String(m.id));
  try {
    await commitWatchlist(next, `watchlist: remove ${m.question}`);
    state.watchlist = next;
    state.markets = state.markets.filter((x) => x.id !== m.id);
    render();
    toast("Removed. History for this market is pruned on the next refresh.", "warn");
  } catch (err) {
    toast("Remove failed: " + (err.message || err));
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  initTheme();
  wireModals();
  wireSettings();
  wireSearch();
  try {
    await loadAll();
  } catch (err) {
    state.fetchError = err.message || String(err);
  }
  render();
  // Re-tick the clock / staleness every minute.
  setInterval(renderClock, 60000);
}

document.addEventListener("DOMContentLoaded", boot);
