// USD -> EGP exchange rate of the day, shared by /api/rate (display) and the admin API (converting EGP entries).
// One rate per day (Cairo time), kept in elsafqa_admin.fx_rates so every page and every saved transaction
// uses the same number all day. The first request of a new day fetches that day's rate from a free source;
// the admin can also set the day's rate by hand (Home > Settings), e.g. to the bank rate. If no source
// answers, the last known rate stays in use.
const S = 'elsafqa_admin';
const TTL = 10 * 60_000; // per-instance cache, so most requests need no query
let cache = null;

const SOURCES = [
  { name: 'exchangerate.fun', url: 'https://api.exchangerate.fun/latest?base=USD', site: 'https://exchangerate.fun',
    read: (j) => j?.rates?.EGP },
  { name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/USD', site: 'https://www.exchangerate-api.com',
    read: (j) => j?.rates?.EGP },
];

export const cairoDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); // YYYY-MM-DD

async function fetchRate() {
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const rate = s.read(await r.json());
      if (typeof rate === 'number' && rate > 1 && rate < 10_000) return { rate, source: s.name, sourceUrl: s.site };
    } catch { /* try the next source */ }
  }
  return null;
}

const out = (row) => row && ({ rate: Number(row.rate), day: row.day, updated: new Date(row.updated_at).toISOString(), source: row.source, sourceUrl: row.source_url || '' });
const latest = async (db) => (await db.all(`SELECT * FROM ${S}.fx_rates ORDER BY day DESC LIMIT 1`))[0];

// { rate, day, updated, source, sourceUrl } or null when there is no rate at all.
export async function usdEgp(db) {
  const today = cairoDay();
  if (cache && cache.data.day === today && Date.now() - cache.at < TTL) return cache.data;
  let data = null;
  try {
    let row = db && await latest(db);
    if (!row || row.day !== today) {
      const fresh = await fetchRate();
      if (fresh && db) {
        // DO NOTHING: a rate the admin already set for today wins.
        await db.all(`INSERT INTO ${S}.fx_rates (day, rate, source, source_url, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (day) DO NOTHING`,
          [today, fresh.rate, fresh.source, fresh.sourceUrl]);
        row = await latest(db);
      } else if (fresh) {
        data = { ...fresh, day: today, updated: new Date().toISOString() };
      }
    }
    data ??= out(row);
  } catch (e) {
    console.error('rate lookup failed', e);
    const fresh = await fetchRate();
    data = fresh ? { ...fresh, day: today, updated: new Date().toISOString() } : cache?.data ?? null;
  }
  // A stale rate (no source answered today) is cached briefly so a later request tries again.
  if (data) cache = { at: data.day === today ? Date.now() : Date.now() - TTL + 60_000, data };
  return data;
}

// Admin sets the rate of the day by hand.
export async function setTodayRate(db, rate) {
  await db.all(`INSERT INTO ${S}.fx_rates (day, rate, source, source_url, updated_at) VALUES ($1, $2, 'Set by admin', '', now())
                ON CONFLICT (day) DO UPDATE SET rate = excluded.rate, source = excluded.source, source_url = '', updated_at = now()`, [cairoDay(), rate]);
  cache = null;
}
