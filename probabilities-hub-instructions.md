# Build: Probabilities Hub (GitHub Pages)

## What this is
A personal, single-user dashboard hosted on GitHub Pages that shows live-ish probabilities from prediction markets (politics/elections, NFL, NBA), lets me search and pin markets I care about, tracks trending movers, and pulls relevant headlines — all without any paid API or Claude API usage at runtime.

## Architecture (important — read first)
GitHub Pages only serves static files; there is no server. So:
- **Data refresh**: a scheduled **GitHub Actions workflow** (cron, every 15–30 min) runs a Node or Python script that fetches market data and headlines, and commits the results as JSON files into the repo (e.g. `/data/markets.json`, `/data/headlines.json`, `/data/history.json`). The static site just reads these committed JSON files. Do not attempt live client-side fetching from Polymarket as the primary data path — use it only as a fallback if useful.
- **Market source**: use **Polymarket's Gamma API** (`https://gamma-api.polymarket.com`) for market discovery/search and current prices. It requires no authentication for reads. Structure the fetch code so a second provider (Kalshi) could be added later without rewriting the pipeline — abstract "get market data" behind a single function/module.
- **Watchlist (which markets to track)**: stored as `/data/watchlist.json` in the repo, `[{id, platform, question, category, addedDate}]`. This is the source of truth the Actions workflow reads to know what to fetch.
- **Search-and-add flow**: market *search* can be a live client-side call to Polymarket's public search/markets endpoints (read-only, no auth, so this is fine to do straight from the browser). When the user adds a market, the frontend calls the **GitHub Contents API** to commit an updated `watchlist.json` directly to the repo, using a fine-grained Personal Access Token the user enters once per device and which is stored in `localStorage` (never sent anywhere but GitHub's API). Build a small settings panel for entering/clearing this token.
- **Trending calculation**: each Actions run appends a timestamped snapshot of each tracked market's probability to `/data/history.json` (cap history length, e.g. keep 30 days, prune older entries). The frontend computes 24h/7d deltas from this file to show trend arrows and populate a "Trending" section (biggest movers across all tracked markets).
- **Headlines**: in the same Actions workflow, fetch **RSS feeds** (no API key) from a curated list of reputable outlets and keyword-match headline titles against each tracked market's question/category to attach 0–3 relevant headlines per market in `headlines.json`. Suggested starter feed list (use each outlet's general or section-level RSS where available): NYT (Politics, and top news), AP News, Reuters, BBC, Politico, The Hill (politics); ESPN, CBS Sports, The Athletic if it has a free feed (NFL/NBA). Keep this list in a config file so it's easy to edit.
- **No Claude/LLM calls at runtime** — matching, formatting, and delta calculation should all be plain code (keyword/substring matching is fine for v1).

## Pages/sections
- Header: site title, live/last-updated timestamp, dark/light toggle (persisted in localStorage), settings icon (for the GitHub PAT).
- **Politics & Elections** section — card grid.
- **Sports (NFL/NBA)** section — card grid.
- **Trending** section — top movers (up and down) across all tracked markets in the last 24h, regardless of category.
- Leave room in the layout for additional category sections later (see backlog) without a redesign — sections should be data-driven off each market's `category` field, not hardcoded.
- "Add market" — a search bar/modal that queries Polymarket's markets endpoint live, shows matching results with a short description, and an "Add to dashboard" button.
- Each card shows: question/title, current probability, 7-day delta with color (green up / red down) and arrow, trading volume, date added, and 0–3 attached headlines with outlet + link. Clicking a card opens the market on Polymarket in a new tab. Include a remove/unpin control on each card.

## Visual design
Build the **"Ticker Tape / Terminal"** direction: dark background (near-black, e.g. `#05070a`/`#0a0d10`), monospace font, amber (`#e8b339`) as the primary accent with green (`#2ecc71`)/red (`#e5533d`) for up/down deltas, thin hairline borders, dense uniform card grid, a scrolling ticker strip along the top showing all tracked markets' current price and daily delta. Light mode should invert to a clean off-white terminal look (not just a lazy color-invert — keep the amber accent, adjust contrast deliberately). Reference mockup: `probabilities-hub-mockups.html` (Concept A), already shared — build to that direction, refining as needed.

## Tech stack
- Plain HTML/CSS/vanilla JS (or a minimal framework if genuinely simpler — no build-heavy framework needed for a static JSON-reading dashboard).
- GitHub Actions workflow file (`.github/workflows/refresh-data.yml`) on a cron schedule, running a Node or Python script in `/scripts/`.
- No backend server, no database, no paid APIs, no Claude API calls.

## Build order (suggested)
1. Scaffold repo structure, GitHub Pages config (`/docs` or root, whichever Pages setup is simpler), basic HTML shell with dark/light toggle.
2. Write the fetch script for Polymarket market data + write `markets.json`/`history.json`; wire up the Actions cron workflow; verify it runs and commits.
3. Write the RSS fetch + keyword-match script; write `headlines.json`.
4. Build the frontend to read the JSON files and render the three sections in the Terminal design.
5. Build the search-and-add flow (live Polymarket search) and the GitHub PAT settings panel + Contents API write for `watchlist.json`.
6. Build the Trending section from `history.json` deltas.
7. Polish: empty states, error states (e.g. Actions run fails, stale-data indicator), mobile responsiveness, accessibility (keyboard focus, reduced motion).

## Product backlog (not v1, but leave hooks for)
- Upgrade headline matching from RSS/keyword to a proper News API (e.g. NewsAPI.org/GNews) using a free-tier key stored as a GitHub Actions secret — swap-in replacement for the RSS module, same `headlines.json` output shape.
- Add Kalshi as a second data source (via the abstracted provider module) for markets Polymarket doesn't cover well.
- Additional dashboard categories to consider: economics/Fed policy, crypto, entertainment/awards.
