# Probabilities Hub

Personal, single-user dashboard of prediction-market probabilities (politics/elections,
NFL, NBA, and any category you add). Hosted on **GitHub Pages** — no server, no paid APIs,
no LLM calls at runtime.

## How it works

```
GitHub Actions (cron, every 20 min)
  └─ node scripts/refresh.mjs
       ├─ reads  data/watchlist.json         (what to track — source of truth)
       ├─ fetches Polymarket Gamma API        (current prices, volume)
       ├─ fetches curated RSS feeds           (headlines, keyword-matched)
       └─ commits data/markets.json
                  data/history.json           (timestamped snapshots → 24h/7d deltas)
                  data/headlines.json
                                                          │
static site (index.html) reads those JSON files ─────────┘
```

The site never fetches Polymarket for the *main* view — it only reads the committed
JSON. Live client-side calls to Polymarket happen only in the **+ Add** search box.

## Files

| Path | What |
|---|---|
| `index.html`, `assets/` | the dashboard (Pages serves the repo root) |
| `data/watchlist.json` | markets to track: `[{id, platform, question, category, addedDate}]` |
| `data/markets.json` | generated — current state of each tracked market |
| `data/history.json` | generated — probability snapshots, pruned to `retentionDays` |
| `data/headlines.json` | generated — 0–3 matched headlines per market |
| `scripts/refresh.mjs` | pipeline orchestrator |
| `scripts/lib/providers.mjs` | provider abstraction — add Kalshi here later |
| `scripts/lib/polymarket.mjs` | Polymarket Gamma implementation |
| `scripts/lib/rss.mjs` | RSS fetch + keyword matcher (swap for a News API later) |
| `scripts/lib/history.mjs` | snapshot append + prune |
| `scripts/config/feeds.json` | RSS feed list + matching config — edit freely |
| `.github/workflows/refresh-data.yml` | the cron job |

## One-time GitHub setup

1. **Pages**: Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
2. **Actions write access**: Settings → Actions → General → *Workflow permissions* →
   **Read and write permissions**. (The workflow commits the refreshed JSON back with
   the built-in `GITHUB_TOKEN`; no PAT or secret required.)
3. Run the workflow once manually: Actions → **refresh-data** → *Run workflow*.

## Adding / removing markets from the UI

The dashboard can edit `data/watchlist.json` directly via the GitHub Contents API.
In **⚙ Settings**, paste a **fine-grained personal access token** scoped to this repo
with **Contents: Read and write**. It is stored only in that browser's `localStorage`
and sent only to `api.github.com`. Enter it once per device.

Without a token the dashboard is fully read-only (still fine — edit `watchlist.json`
by hand and the next refresh picks it up).

## Local development

```bash
npx serve . -l 4180        # then open http://localhost:4180
node scripts/refresh.mjs   # regenerate data/*.json locally
```

## Backlog (hooks are in place)

- Replace the RSS/keyword matcher with a News API (free-tier key as an Actions secret);
  keep the `data/headlines.json` shape.
- Add Kalshi as a second provider via `scripts/lib/providers.mjs`.
- More categories (economics/Fed, crypto, entertainment) — already data-driven off each
  market's `category`, no code change needed to add a section.
