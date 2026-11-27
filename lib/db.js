// Database pool shared by the Vercel Functions (api/admin.js, api/rate.js).
// Connections follow the method Vercel and Supabase recommend for Fluid compute: a `pg` pool created
// once per instance and registered with attachDatabasePool, which closes idle connections before
// Vercel pauses the instance.
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

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

export function database() {
  const p = getPool();
  if (!p) return null;
  return {
    all: async (text, params = []) => (await p.query(text, params)).rows,
    exec: (text) => p.query(text), // several statements in one string run as one transaction
  };
}

