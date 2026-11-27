// Vercel Function: GET /api/rate  ->  { ok, rate, updated, source, sourceUrl }
// USD -> EGP rate for showing EGP next to dollar amounts (team app and landing page). See lib/rate.js.
import { usdEgp } from '../lib/rate.js';

export default {
  async fetch() {
    const data = await usdEgp();
    if (!data) return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ ok: true, ...data }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600' },
    });
  },
};
