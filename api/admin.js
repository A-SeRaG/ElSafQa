// Vercel Function: /api/admin/*  (vercel.json rewrites every /api/admin/... request here)
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   DATABASE_URL    Supabase "Transaction pooler" connection string, port 6543 (required)
//   ADMIN_PASSWORD, SESSION_SECRET (required); see DOCUMENTATION.md section 15 for the optional ones
// The database pool is in lib/db.js.
import { handle } from '../lib/admin-core.js';
import { database } from '../lib/db.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // The sub-path arrives either as ?path= (from the rewrite) or still in the pathname.
    const path = (url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/admin\/?/, '')).replace(/^\/+|\/+$/g, '');
    return handle(request, path, database(), process.env);
  },
};
