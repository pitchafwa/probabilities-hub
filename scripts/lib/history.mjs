// Timestamped probability snapshots per market, used by the frontend to compute
// 24h / 7d deltas and the Trending section.
//
// Shape of data/history.json:
//   {
//     updatedAt: ISO,
//     retentionDays: 30,
//     series: {
//       "<marketId>": [ { t: ISO, p: <prob 0-100>, v: <volume> }, ... ]  // oldest -> newest
//     }
//   }

const DEFAULT_RETENTION_DAYS = 30;
// Don't record a point if the last one is younger than this (guards against
// manual / double workflow runs bloating the file).
const MIN_GAP_MS = 5 * 60 * 1000;

export function appendSnapshot(history, markets, now = new Date()) {
  const retentionDays = history.retentionDays || DEFAULT_RETENTION_DAYS;
  const series = { ...(history.series || {}) };
  const nowIso = now.toISOString();
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  const liveIds = new Set(markets.map((m) => m.id));

  for (const m of markets) {
    if (m.probability == null) continue;
    // For whole-event cards `p` is the current favorite's probability; `l` tags
    // which outcome that was, so the frontend can void a delta across a lead change.
    const point = { t: nowIso, p: m.probability, v: m.volume ?? 0 };
    if (m.leaderLabel) point.l = m.leaderLabel;
    const points = Array.isArray(series[m.id]) ? series[m.id].slice() : [];
    const last = points[points.length - 1];
    if (last && now.getTime() - new Date(last.t).getTime() < MIN_GAP_MS) {
      points[points.length - 1] = point; // refresh newest rather than stack a near-duplicate
    } else {
      points.push(point);
    }
    series[m.id] = points.filter((pt) => new Date(pt.t).getTime() >= cutoff);
  }

  // Drop series for markets no longer on the watchlist (keep file lean).
  for (const id of Object.keys(series)) {
    if (!liveIds.has(id)) delete series[id];
  }

  return { updatedAt: nowIso, retentionDays, series };
}
