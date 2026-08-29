// Data refresh orchestrator. Run by .github/workflows/refresh-data.yml on a cron.
//
//   node scripts/refresh.mjs
//
// Reads   data/watchlist.json
// Writes  data/markets.json, data/history.json, data/headlines.json
//
// Exits 0 even on partial failure (some markets/feeds down) so the workflow still
// commits fresh data; exits 1 only if it can't produce a usable markets.json.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getMarketData } from "./lib/providers.mjs";
import { appendSnapshot } from "./lib/history.mjs";
import { fetchHeadlines } from "./lib/rss.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const p = (...s) => join(DATA, ...s);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (fallback !== undefined) {
      console.warn(`! could not read ${path} (${err.message}); using fallback`);
      return fallback;
    }
    throw err;
  }
}

async function writeJson(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function main() {
  const startedAt = new Date();
  console.log(`refresh start ${startedAt.toISOString()}`);

  const watchlist = await readJson(p("watchlist.json"));
  if (!Array.isArray(watchlist)) throw new Error("watchlist.json is not an array");
  console.log(`watchlist: ${watchlist.length} market(s)`);

  // 1. Market data via the provider abstraction.
  const { markets, errors } = await getMarketData(watchlist);
  console.log(`fetched ${markets.length} market(s), ${errors.length} error(s)`);
  for (const e of errors) console.warn(`  ! market ${e.id}: ${e.error}`);

  if (markets.length === 0) {
    // Keep whatever we had rather than nuking the dashboard.
    console.error("no markets fetched — leaving existing data files untouched");
    process.exit(1);
  }

  await writeJson(p("markets.json"), {
    updatedAt: startedAt.toISOString(),
    source: "polymarket",
    errors,
    markets,
  });

  // 2. History snapshot (append + prune).
  const history = await readJson(p("history.json"), { retentionDays: 30, series: {} });
  const nextHistory = appendSnapshot(history, markets, startedAt);
  await writeJson(p("history.json"), nextHistory);
  console.log(`history: ${Object.keys(nextHistory.series).length} series`);

  // 3. Headlines via RSS + keyword match.
  let headlinesOut = { updatedAt: startedAt.toISOString(), byMarket: {} };
  try {
    const feedCfg = await readJson(join(ROOT, "scripts", "config", "feeds.json"));
    const { byMarket, feedErrors, stats } = await fetchHeadlines(
      feedCfg.feeds || [],
      markets,
      feedCfg
    );
    headlinesOut = { updatedAt: startedAt.toISOString(), byMarket };
    console.log(
      `headlines: scanned ${stats.headlines} items from ${stats.feeds} feeds, ${feedErrors.length} feed error(s)`
    );
    for (const fe of feedErrors) console.warn(`  ! feed ${fe.feed}: ${fe.error}`);
  } catch (err) {
    console.warn(`! headline step failed: ${err.message} — keeping previous headlines`);
    headlinesOut = await readJson(p("headlines.json"), headlinesOut);
    headlinesOut.updatedAt = startedAt.toISOString();
  }
  await writeJson(p("headlines.json"), headlinesOut);

  console.log(`refresh done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("refresh failed:", err);
  process.exit(1);
});
