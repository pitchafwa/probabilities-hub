// Polymarket Gamma API provider.
// Read-only, no auth. Docs: https://gamma-api.polymarket.com
//
// Exposes the provider contract used by providers.mjs:
//   platform: string
//   fetchMarkets(entries) -> normalized market objects (see normalize())
//
// `entries` are watchlist rows: { id, platform, question, category, addedDate, outcomeIndex? }

const GAMMA = "https://gamma-api.polymarket.com";
const BATCH = 20; // ids per request

function toNum(v, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "probabilities-hub/1.0" },
  });
  if (!res.ok) throw new Error(`Gamma ${res.status} for ${url}`);
  return res.json();
}

// Build the public Polymarket URL for a market. Prefer the parent event slug.
function marketUrl(raw) {
  const eventSlug = raw?.events?.[0]?.slug;
  if (eventSlug) return `https://polymarket.com/event/${eventSlug}`;
  if (raw?.slug) return `https://polymarket.com/market/${raw.slug}`;
  return "https://polymarket.com";
}

function normalize(raw, entry) {
  const outcomes = parseJsonArray(raw.outcomes);
  const prices = parseJsonArray(raw.outcomePrices).map((p) => toNum(p));
  const idx = Number.isInteger(entry.outcomeIndex) ? entry.outcomeIndex : 0;
  const price = prices[idx];
  const probability =
    price != null && Number.isFinite(price) ? Math.round(price * 1000) / 10 : null;

  return {
    id: String(raw.id),
    platform: "polymarket",
    question: raw.question || entry.question || `Market ${raw.id}`,
    category: entry.category || "uncategorized",
    addedDate: entry.addedDate || null,
    outcomeIndex: idx,
    outcomeLabel: outcomes[idx] || "Yes",
    probability, // 0-100 or null
    volume: Math.round(toNum(raw.volumeNum ?? raw.volume)),
    volume24hr: Math.round(toNum(raw.volume24hr)),
    liquidity: Math.round(toNum(raw.liquidityNum ?? raw.liquidity)),
    closed: Boolean(raw.closed),
    active: raw.active !== false,
    endDate: raw.endDate || raw.endDateIso || null,
    slug: raw.events?.[0]?.slug || raw.slug || null,
    eventId: raw.events?.[0]?.id != null ? String(raw.events[0].id) : null,
    url: marketUrl(raw),
    // Polymarket's own change fields, kept as a cross-check / fallback for deltas.
    oneWeekPriceChange: raw.oneWeekPriceChange != null ? toNum(raw.oneWeekPriceChange) : null,
    // Populated by enrichMultiOutcome() when the parent event has 3+ live outcomes.
    isMultiOutcome: false,
    outcomeCount: null,
    outcomes: null,
    fetchedAt: new Date().toISOString(),
  };
}

// Minimum probability (%) for a sibling market to count as a "serious" outcome
// worth listing. Filters out the dead "Party C / Party D" placeholder legs.
const SERIOUS_MIN_PCT = 1;
const TOP_OUTCOMES = 5;

// For markets whose parent event is a multi-way race (Super Bowl winner, a
// crowded primary, MVP, ...), attach the leading outcomes so the card can show a
// mini leaderboard instead of a single Yes price. History / deltas continue to
// track the specific outcome on the watchlist (the one marked `tracked`).
async function enrichMultiOutcome(markets) {
  const eventIds = [...new Set(markets.map((m) => m.eventId).filter(Boolean))];
  if (!eventIds.length) return;

  const events = await Promise.all(
    eventIds.map(async (id) => {
      try {
        return [id, await getJson(`${GAMMA}/events/${id}`)];
      } catch {
        return [id, null];
      }
    })
  );
  const byEvent = new Map(events);

  for (const m of markets) {
    const ev = byEvent.get(m.eventId);
    if (!ev || !Array.isArray(ev.markets)) continue;

    const rows = ev.markets
      .filter((x) => !x.closed && x.active !== false)
      .map((x) => {
        const price = parseJsonArray(x.outcomePrices).map((p) => toNum(p))[0];
        return {
          id: String(x.id),
          label: x.groupItemTitle || x.question || "—",
          probability: Number.isFinite(price) ? Math.round(price * 1000) / 10 : null,
        };
      })
      .filter((r) => r.probability != null && r.probability >= SERIOUS_MIN_PCT)
      .sort((a, b) => b.probability - a.probability);

    if (rows.length < 3) continue; // 2-way (most elections) -> keep single-value card

    const top = rows.slice(0, TOP_OUTCOMES);
    if (!top.some((r) => r.id === m.id)) {
      const tracked = rows.find((r) => r.id === m.id);
      if (tracked) top.push({ ...tracked, outside: true });
    }
    m.isMultiOutcome = true;
    m.outcomeCount = rows.length;
    m.outcomes = top.map((r) => ({ ...r, tracked: r.id === m.id }));
  }
}

async function fetchMarkets(entries) {
  const ids = entries.map((e) => String(e.id)).filter(Boolean);
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const out = [];
  const errors = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const qs = chunk.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    try {
      const rows = await getJson(`${GAMMA}/markets?${qs}`);
      const seen = new Set();
      for (const raw of rows || []) {
        const entry = byId.get(String(raw.id));
        if (!entry) continue;
        seen.add(String(raw.id));
        out.push(normalize(raw, entry));
      }
      for (const id of chunk) {
        if (!seen.has(id)) errors.push({ id, error: "not returned by Gamma" });
      }
    } catch (err) {
      for (const id of chunk) errors.push({ id, error: String(err.message || err) });
    }
  }

  try {
    await enrichMultiOutcome(out);
  } catch (err) {
    errors.push({ id: "*", error: `multi-outcome enrichment: ${String(err.message || err)}` });
  }

  return { markets: out, errors };
}

// Live client-side search is done in the browser (assets/app.js); this mirror
// is here so scripts/tooling can reuse the same shape if ever needed.
async function search(query, { limit = 12 } = {}) {
  const url = `${GAMMA}/public-search?q=${encodeURIComponent(query)}&limit_per_type=${limit}&events_status=active`;
  const j = await getJson(url);
  const results = [];
  for (const ev of j.events || []) {
    for (const m of ev.markets || []) {
      if (m.closed) continue;
      const prices = parseJsonArray(m.outcomePrices).map((p) => toNum(p));
      results.push({
        id: String(m.id),
        platform: "polymarket",
        question: m.groupItemTitle ? `${ev.title} — ${m.groupItemTitle}` : m.question,
        eventTitle: ev.title,
        description: (ev.description || m.description || "").slice(0, 240),
        probability: prices[0] != null ? Math.round(prices[0] * 1000) / 10 : null,
        volume: Math.round(toNum(m.volumeNum)),
        url: `https://polymarket.com/event/${ev.slug}`,
      });
    }
  }
  return results.slice(0, limit);
}

export default { platform: "polymarket", fetchMarkets, search };
