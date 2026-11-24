// Vercel Function: /api/admin/*  (vercel.json rewrites every /api/admin/... request here)
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   DATABASE_URL    Supabase "Transaction pooler" connection string (required)
//   ADMIN_PASSWORD, SESSION_SECRET (required); see DOCUMENTATION.md section 15 for the optional ones
import postgres from 'postgres';
import { handle } from '../lib/admin-core.js';

// Vercel pauses a function between requests. A database connection left open during a pause can be
// dead when the function wakes up, and a query on it would wait with no end. So:
//  - after IDLE_MS without a query, the next request starts on fresh connections;
//  - no query may take longer than QUERY_MS: the connections are dropped and the request fails cleanly.
const IDLE_MS = 10_000;
const QUERY_MS = 15_000;
let sql = null;
let lastUsed = 0;

function dropConnections() {
  const old = sql;
  sql = null;
  old?.end({ timeout: 0 }).catch(() => {});
}

function client() {
  if (sql && Date.now() - lastUsed > IDLE_MS) dropConnections();
  // A few connections, so queries that don't depend on each other run side by side.
  // `prepare: false` is required by Supabase's transaction pooler. DATABASE_SSL=off is for local tests only.
  sql ??= postgres(process.env.DATABASE_URL, {
    prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10,
    ssl: process.env.DATABASE_SSL === 'off' ? false : 'require', onnotice: () => {},
  });
  return sql;
}

async function query(run) {
  let timer;
  const conn = client();
  try {
    return await Promise.race([
      run(conn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('database did not answer in time')), QUERY_MS); }),
    ]);
  } catch (e) {
    if (sql === conn) dropConnections(); // never reuse connections that just failed or hung
    throw e;
  } finally {
    clearTimeout(timer);
    lastUsed = Date.now();
  }
}

function database() {
  if (!process.env.DATABASE_URL) return null;
  return {
    all: (text, params = []) => query((c) => c.unsafe(text, params)),
    exec: (text) => query((c) => c.unsafe(text)),
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
