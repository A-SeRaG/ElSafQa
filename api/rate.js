// Vercel Function: GET /api/rate  ->  { ok, rate, day, updated, source, sourceUrl }
// USD -> EGP rate of the day for showing EGP next to dollar amounts (team app and landing page). See lib/rate.js.
import { usdEgp } from '../lib/rate.js';
import { database } from '../lib/db.js';
import { ensureSchema } from '../lib/admin-core.js';

export default {
  async fetch() {
    const db = database();
    if (db) await ensureSchema(db, process.env).catch((e) => console.error('schema check failed', e));
    const data = await usdEgp(db);
    if (!data) return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ ok: true, ...data }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=600' },
    });
  },
};
