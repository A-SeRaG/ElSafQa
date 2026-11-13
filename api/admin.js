// Vercel Function: /api/admin/*  (vercel.json rewrites every /api/admin/... request here)
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   DATABASE_URL    Supabase "Transaction pooler" connection string (required)
//   ADMIN_PASSWORD, SESSION_SECRET (required); see DOCUMENTATION.md section 15 for the optional ones
import postgres from 'postgres';
import { handle } from '../lib/admin-core.js';

// One small connection per warm function instance. `prepare: false` is required by Supabase's transaction pooler.
let sql;
function database() {
  if (!process.env.DATABASE_URL) return null;
  sql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, ssl: process.env.DATABASE_SSL === 'off' ? false : 'require', onnotice: () => {} }); // DATABASE_SSL=off is for local tests only
  return {
    all: (text, params = []) => sql.unsafe(text, params),
    exec: (text) => sql.unsafe(text),
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // The sub-path arrives either as ?path= (from the rewrite) or still in the pathname.
    const path = (url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/admin\/?/, '')).replace(/^\/+|\/+$/g, '');
    return handle(request, path, database(), process.env);
  },
};
