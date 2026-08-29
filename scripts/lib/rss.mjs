// RSS/Atom headline fetch + keyword matching. No API key, no dependencies.
//
// Output written to data/headlines.json:
//   { updatedAt: ISO, byMarket: { "<marketId>": [ { title, url, outlet, publishedAt } ] } }
//
// v1 matching is plain substring/keyword scoring. The module boundary is kept
// deliberately narrow (fetchHeadlines) so a News API can replace it later with
// the same output shape (see backlog in the instructions).

const STOPWORDS = new Set(
  ("the a an and or of to in on at for by with from as is are be will would win wins won " +
    "next new party control seat race meeting rate rates cut cuts point points pts week 2024 " +
    "2025 2026 2027 2028 vs game season make makes made this that when who what which does do")
    .split(/\s+/)
);

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

// Atom <link href="..."/> or RSS <link>...</link>
function linkOf(block) {
  const href = block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (href) return decodeEntities(href[1]);
  return tag(block, "link");
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = tag(b, "title");
    if (!title) continue;
    const url = linkOf(b);
    const dateRaw =
      tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const ts = dateRaw ? Date.parse(dateRaw) : NaN;
    items.push({ title, url, publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null });
  }
  return items;
}

async function fetchFeed(feed, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; probabilities-hub/1.0; +https://github.com/pitchafwa/probabilities-hub)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml).map((it) => ({ ...it, outlet: feed.outlet, feedCategory: feed.category || "general" }));
  } finally {
    clearTimeout(timer);
  }
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

// Category-generic tokens: real words, but so common in a section feed that on
// their own they signal nothing. They still count inside multi-word phrases.
const GENERIC = new Set(
  ("nfl nba mlb nhl ncaa senate house congress election elections midterm midterms " +
    "governor gubernatorial president presidential campaign football basketball baseball " +
    "hockey league championship playoff playoffs season game games team teams draft " +
    "coach player players score federal reserve republican republicans democrat democrats")
    .split(/\s+/)
);

// Keywords for a market: salient words from the question, plus adjacent
// stopword-free word pairs as strong-signal phrases (e.g. "buffalo bills",
// "rate cut", "super bowl"). "groupItemTitle" is folded into question upstream.
function marketKeywords(market) {
  const tokens = tokenize(market.question); // ordered, stopword-free, len>=4
  const salient = new Set(tokens.filter((t) => !GENERIC.has(t)));
  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return { salient, phrases };
}

// A headline matches a market when it shares a distinctive phrase, or at least
// two distinctive (non-generic) words. Same-category feeds get a small nudge.
function scoreHeadline(headline, kw, marketCategory) {
  const title = headline.title.toLowerCase();
  const titleTokens = new Set(tokenize(title));

  let phraseHits = 0;
  for (const p of kw.phrases) if (title.includes(p)) phraseHits += 1;

  let salientHits = 0;
  for (const t of kw.salient) if (titleTokens.has(t)) salientHits += 1;

  let score = phraseHits * 3 + salientHits;
  const qualifies = phraseHits > 0 || salientHits >= 2;
  if (!qualifies) return 0;

  if (headline.feedCategory && headline.feedCategory === marketCategory) score += 1;
  return score;
}

/**
 * @param {Array} feeds  from scripts/config/feeds.json -> feeds[]
 * @param {Array} markets normalized markets (need id, question, category)
 * @param {object} cfg    { maxHeadlinesPerMarket, maxAgeDays }
 */
export async function fetchHeadlines(feeds, markets, cfg = {}) {
  const maxPer = cfg.maxHeadlinesPerMarket ?? 3;
  const maxAgeMs = (cfg.maxAgeDays ?? 5) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const settled = await Promise.allSettled(feeds.map((f) => fetchFeed(f)));
  const headlines = [];
  const feedErrors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") headlines.push(...r.value);
    else feedErrors.push({ feed: feeds[i].outlet, error: String(r.reason?.message || r.reason) });
  });

  // De-dupe by normalized title.
  const seen = new Set();
  const fresh = headlines.filter((h) => {
    const key = h.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    if (h.publishedAt && now - Date.parse(h.publishedAt) > maxAgeMs) return false;
    return true;
  });

  const byMarket = {};
  for (const market of markets) {
    const kw = marketKeywords(market);
    const scored = [];
    for (const h of fresh) {
      const s = scoreHeadline(h, kw, market.category);
      if (s >= 2) scored.push({ ...h, _score: s });
    }
    scored.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    });
    byMarket[market.id] = scored.slice(0, maxPer).map((h) => ({
      title: h.title,
      url: h.url,
      outlet: h.outlet,
      publishedAt: h.publishedAt,
    }));
  }

  return { byMarket, feedErrors, stats: { feeds: feeds.length, headlines: fresh.length } };
}
