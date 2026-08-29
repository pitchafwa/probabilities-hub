// Provider abstraction: "get market data" behind one entry point so a second
// source (e.g. Kalshi) can be dropped in later without touching refresh.mjs.
//
// To add a provider: implement { platform, fetchMarkets(entries) } in its own
// module and register it in PROVIDERS below.

import polymarket from "./polymarket.mjs";

const PROVIDERS = {
  polymarket,
  // kalshi,  // <- future: same contract, register here
};

export function providerFor(platform) {
  return PROVIDERS[platform] || null;
}

// Group watchlist entries by platform, fetch each group with its provider,
// and return a flat list of normalized markets plus any per-id errors.
export async function getMarketData(watchlist) {
  const groups = new Map();
  for (const entry of watchlist) {
    const platform = entry.platform || "polymarket";
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform).push({ ...entry, platform });
  }

  const markets = [];
  const errors = [];

  for (const [platform, entries] of groups) {
    const provider = providerFor(platform);
    if (!provider) {
      for (const e of entries) errors.push({ id: e.id, error: `no provider for "${platform}"` });
      continue;
    }
    try {
      const res = await provider.fetchMarkets(entries);
      markets.push(...(res.markets || []));
      errors.push(...(res.errors || []));
    } catch (err) {
      for (const e of entries) errors.push({ id: e.id, error: String(err.message || err) });
    }
  }

  // Preserve watchlist order.
  const order = new Map(watchlist.map((e, i) => [String(e.id), i]));
  markets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { markets, errors };
}
