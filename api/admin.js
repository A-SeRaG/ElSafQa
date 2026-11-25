// Vercel Function: /api/admin/*  (vercel.json rewrites every /api/admin/... request here)
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   DATABASE_URL    Supabase "Transaction pooler" connection string, port 6543 (required)
//   ADMIN_PASSWORD, SESSION_SECRET (required); see DOCUMENTATION.md section 15 for the optional ones
//
// Connections follow the method Vercel and Supabase recommend for Fluid compute: a `pg` pool created
// once per instance and registered with attachDatabasePool, which closes idle connections before
// Vercel pauses the instance. That is what keeps queries from hanging on connections that died
// during a pause.
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { handle } from '../lib/admin-core.js';

let pool = null;
function getPool() {
  if (pool || !process.env.DATABASE_URL) return pool;
  // Supabase's pooler uses its own certificate authority. Drop any sslmode in the URL so the ssl
  // setting below applies (encrypted, without checking the certificate chain).
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false }, // 'off' is for local tests only
    max: 5,                         // a few, so the queries of one page run side by side
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000, // fail clearly instead of waiting when the database can't be reached
    query_timeout: 15_000,
  });
  pool.on('error', (e) => console.error('database pool error', e)); // a dropped idle connection must not crash the function
  attachDatabasePool(pool);
  return pool;
}

function database() {
  const p = getPool();
  if (!p) return null;
  return {
    all: async (text, params = []) => (await p.query(text, params)).rows,
    exec: (text) => p.query(text), // several statements in one string run as one transaction
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
