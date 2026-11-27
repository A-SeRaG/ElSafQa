// USD -> EGP exchange rate, shared by /api/rate (display) and the admin API (converting EGP entries).
// Free sources update hourly (exchangerate.fun) or daily (ExchangeRate-API, the backup);
// a true tick-by-tick rate needs a paid data feed. Cached per server instance for 30 minutes.
const TTL = 30 * 60_000;
let cache = null;

const SOURCES = [
  { name: 'exchangerate.fun', url: 'https://api.exchangerate.fun/latest?base=USD', site: 'https://exchangerate.fun',
    read: (j) => ({ rate: j?.rates?.EGP, updated: j?.timestamp && j.timestamp * 1000 }) },
  { name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/USD', site: 'https://www.exchangerate-api.com',
    read: (j) => ({ rate: j?.rates?.EGP, updated: j?.time_last_update_unix && j.time_last_update_unix * 1000 }) },
];

async function fetchRate() {
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const { rate, updated } = s.read(await r.json());
      if (typeof rate === 'number' && rate > 1 && rate < 10_000) {
        return { rate, updated: new Date(updated || Date.now()).toISOString(), source: s.name, sourceUrl: s.site };
      }
    } catch { /* try the next source */ }
  }
  return null;
}

// { rate, updated, source, sourceUrl } or null when no source answers.
export async function usdEgp() {
  if (!cache || Date.now() - cache.at > TTL) {
    const fresh = await fetchRate();
    if (fresh) cache = { at: Date.now(), data: fresh };
  }
  return cache?.data ?? null;
}
