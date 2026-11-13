// Backend of the /admins finance app. Platform-neutral: api/admin.js (Vercel) passes in the
// database (Supabase Postgres) and the environment. Nothing here is reachable without a valid session.
//
// db contract: db.all(text, params) -> rows[]   |   db.exec(text) -> runs several statements, no params
// env: ADMIN_PASSWORD, SESSION_SECRET (required); ADMIN_EMAIL, RESEND_API_KEY, MAIL_FROM, ALERT_EMAIL_TO,
//      TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (optional)

const COOKIE = '__Host-esq_admin';
const SESSION_HOURS = 8;
const MAX_FAILS = 5; // failed logins per IP ...
const FAIL_WINDOW_MIN = 15; // ... inside this window
const S = 'elsafqa_admin'; // private schema: not exposed by the Supabase Data API

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
const fail = (error, status) => json({ ok: false, error }, status);

/* ---------- crypto helpers ---------- */
const enc = new TextEncoder();
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
// Compare two strings without leaking length or content through timing.
const sameString = async (secret, a, b) => safeEqual(await hmac(secret, a), await hmac(secret, b));

async function makeSession(secret) {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  return `${exp}.${hex(await hmac(secret, `session:${exp}`))}`;
}
async function hasSession(request, secret) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d{13})\\.([0-9a-f]{64})`));
  if (!m || Number(m[1]) < Date.now()) return false;
  return safeEqual(enc.encode(m[2]), enc.encode(hex(await hmac(secret, `session:${m[1]}`))));
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/* ---------- database ---------- */
const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS ${S};
CREATE TABLE IF NOT EXISTS ${S}.transactions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('in','out')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  at TEXT NOT NULL, purpose TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tx_at ON ${S}.transactions (at);
CREATE TABLE IF NOT EXISTS ${S}.employees (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, title TEXT NOT NULL, salary BIGINT NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ${S}.reviews (
  employee_id INTEGER NOT NULL, month TEXT NOT NULL,
  target_pct INTEGER NOT NULL DEFAULT 0, instructions_pct INTEGER NOT NULL DEFAULT 0,
  bonus BIGINT NOT NULL DEFAULT 0, deduction BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', paid_at TEXT,
  PRIMARY KEY (employee_id, month));
CREATE TABLE IF NOT EXISTS ${S}.clients (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', trader TEXT NOT NULL DEFAULT '',
  live INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ${S}.client_entries (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, client_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit','withdrawal','profit','loss')),
  amount BIGINT NOT NULL CHECK (amount > 0), at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_entries_client ON ${S}.client_entries (client_id, at);
CREATE TABLE IF NOT EXISTS ${S}.settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ${S}.login_attempts (ip TEXT NOT NULL, at BIGINT NOT NULL);
`;
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.exec(SCHEMA);
  schemaReady = true;
}
const first = async (db, text, params = []) => (await db.all(text, params))[0];
// Postgres returns BIGINT and SUM() as strings; amounts are integer cents, safely inside Number range.
const N = (v) => Number(v ?? 0);

/* ---------- input helpers ---------- */
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
// Money travels as a decimal number and is stored as integer cents.
function cents(v, { allowZero = false } = {}) {
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 1e13 || (!allowZero && n === 0)) return null;
  return n;
}
const pct = (v) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
function isoDate(v) {
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const money = (c) => N(c) / 100;
const txOut = (r) => ({ id: r.id, kind: r.kind, amount: money(r.amount), at: r.at, purpose: r.purpose, note: r.note });
const clientIp = (request) =>
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';

/* ---------- login alert ---------- */
async function loginAlert(request, env) {
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short' });
  const place = [request.headers.get('x-vercel-ip-city'), request.headers.get('x-vercel-ip-country')].filter(Boolean).map(decodeURIComponent).join(', ');
  const text = [
    'A new sign-in to the ElSafQa admin finance app just succeeded.',
    '',
    `Time (Cairo): ${when}`,
    `IP address: ${clientIp(request)}`,
    `Location: ${place || 'unknown'}`,
    `Device: ${clean(request.headers.get('User-Agent'), 200) || 'unknown'}`,
    '',
    'If this was not you, change ADMIN_PASSWORD and SESSION_SECRET in Vercel immediately.',
  ].join('\n');
  const signal = AbortSignal.timeout(5000); // never let a slow mail provider hang the sign-in

  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'ElSafQa Admin <admin@elsafqa.com>',
        to: [env.ALERT_EMAIL_TO || env.ADMIN_EMAIL || 'support@elsafqa.com'],
        subject: 'ElSafQa admin: new sign-in',
        text,
      }),
    });
    if (!r.ok) console.error('login alert email failed', r.status, await r.text());
  } else if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  }
}

/* ---------- handlers ---------- */
async function login(request, db, env, b) {
  const ip = clientIp(request);
  const since = Date.now() - FAIL_WINDOW_MIN * 60_000;
  const { n } = await first(db, `SELECT COUNT(*) AS n FROM ${S}.login_attempts WHERE ip = $1 AND at > $2`, [ip, since]);
  if (N(n) >= MAX_FAILS) return fail('locked', 429);

  const adminEmail = (env.ADMIN_EMAIL || 'support@elsafqa.com').toLowerCase();
  const emailOk = await sameString(env.SESSION_SECRET, clean(b.email, 200).toLowerCase(), adminEmail);
  const passOk = await sameString(env.SESSION_SECRET, String(b.password ?? '').slice(0, 500), env.ADMIN_PASSWORD);
  if (!(emailOk && passOk)) {
    await db.all(`INSERT INTO ${S}.login_attempts (ip, at) VALUES ($1, $2)`, [ip, Date.now()]);
    await db.all(`DELETE FROM ${S}.login_attempts WHERE at < $1`, [Date.now() - 86_400_000]);
    return fail('invalid', 401);
  }
  await db.all(`DELETE FROM ${S}.login_attempts WHERE ip = $1`, [ip]);
  await loginAlert(request, env).catch((e) => console.error('login alert failed', e));
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(await makeSession(env.SESSION_SECRET), SESSION_HOURS * 3600) });
}

async function getSettings(db) {
  const rows = await db.all(`SELECT key, value FROM ${S}.settings`);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { opening: Number(s.opening_capital || 0), currency: s.currency || 'USD' };
}

async function summary(db, url) {
  const from = isoDate(url.searchParams.get('from'));
  const to = isoDate(url.searchParams.get('to'));
  if (!from || !to) return fail('bad_range', 422);
  const all = await first(db, `SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END), 0) AS net FROM ${S}.transactions`);
  const month = await first(db,
    `SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE kind WHEN 'out' THEN amount ELSE 0 END), 0) AS expenses
     FROM ${S}.transactions WHERE at >= $1 AND at < $2`, [from, to]);
  const s = await getSettings(db);
  return json({
    ok: true,
    currency: s.currency,
    opening: money(s.opening),
    capital: money(s.opening + N(all.net)),
    revenue: money(month.revenue),
    expenses: money(month.expenses),
    profit: money(N(month.revenue) - N(month.expenses)),
  });
}

// Capital at the end of every day that has transactions (running total on top of the opening capital).
async function progress(db) {
  const rows = await db.all(
    `SELECT substr(at, 1, 10) AS day, SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END) AS net
     FROM ${S}.transactions GROUP BY 1 ORDER BY 1`);
  const s = await getSettings(db);
  let running = s.opening;
  return json({ ok: true, opening: money(s.opening), points: rows.map((r) => ({ day: r.day, capital: money((running += N(r.net))) })) });
}

async function saveSettings(db, b) {
  const opening = cents(b.opening, { allowZero: true });
  const currency = clean(b.currency, 3).toUpperCase();
  if (opening === null || !/^[A-Z]{3}$/.test(currency)) return fail('invalid', 422);
  const up = `INSERT INTO ${S}.settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
  await db.all(up, ['opening_capital', String(opening)]);
  await db.all(up, ['currency', currency]);
  return json({ ok: true });
}

async function listTx(db, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const rows = await db.all(`SELECT * FROM ${S}.transactions ORDER BY at DESC, id DESC LIMIT $1 OFFSET $2`, [limit + 1, offset]);
  return json({ ok: true, more: rows.length > limit, items: rows.slice(0, limit).map(txOut) });
}

async function addTx(db, b) {
  const kind = b.kind === 'in' || b.kind === 'out' ? b.kind : null;
  const amount = cents(b.amount);
  const at = isoDate(b.at);
  const purpose = clean(b.purpose, 120);
  if (!kind || amount === null || !at || !purpose) return fail('invalid', 422);
  const r = await first(db,
    `INSERT INTO ${S}.transactions (kind, amount, at, purpose, note, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [kind, amount, at, purpose, clean(b.note, 1000), new Date().toISOString()]);
  return json({ ok: true, id: r.id }, 201);
}

/* ---------- clients ---------- */
// A client's wallet is client money, kept apart from the company's own capital.
const clientRows = (db) => db.all(
  `SELECT c.id, c.name, c.contact, c.trader, c.live,
     COALESCE(SUM(CASE e.kind WHEN 'deposit' THEN e.amount WHEN 'withdrawal' THEN -e.amount ELSE 0 END), 0) AS deposited,
     COALESCE(SUM(CASE e.kind WHEN 'profit' THEN e.amount WHEN 'loss' THEN -e.amount ELSE 0 END), 0) AS pnl
   FROM ${S}.clients c LEFT JOIN ${S}.client_entries e ON e.client_id = c.id
   GROUP BY c.id ORDER BY lower(c.name)`);

// Per client and day: change of the wallet (net) and the trading result alone (pnl).
const clientDays = (db) => db.all(
  `SELECT client_id, substr(at, 1, 10) AS day,
     SUM(CASE WHEN kind IN ('deposit','profit') THEN amount ELSE -amount END) AS net,
     SUM(CASE kind WHEN 'profit' THEN amount WHEN 'loss' THEN -amount ELSE 0 END) AS pnl
   FROM ${S}.client_entries GROUP BY client_id, 2 ORDER BY 2`);

async function listClients(db) {
  const rows = await clientRows(db), days = await clientDays(db);
  return json({
    ok: true,
    items: rows.map((c) => {
      let running = 0;
      return {
        id: c.id, name: c.name, contact: c.contact, trader: c.trader, live: !!c.live,
        deposited: money(c.deposited), pnl: money(c.pnl), wallet: money(N(c.deposited) + N(c.pnl)),
        points: days.filter((d) => d.client_id === c.id).map((d) => ({ day: d.day, value: money((running += N(d.net))) })),
      };
    }),
  });
}

// What a staff member does as a trader: the clients whose "trader" field carries their name.
function tradingFor(name, rows, days) {
  const key = name.trim().toLowerCase();
  const mine = rows.filter((c) => c.trader.trim().toLowerCase() === key);
  if (!mine.length) return null;
  const ids = new Set(mine.map((c) => c.id));
  const byDay = new Map();
  for (const d of days) if (ids.has(d.client_id) && N(d.pnl)) byDay.set(d.day, (byDay.get(d.day) || 0) + N(d.pnl));
  let running = 0;
  return {
    clients: mine.length,
    live: mine.filter((c) => c.live).length,
    managed: money(mine.reduce((sum, c) => sum + N(c.deposited) + N(c.pnl), 0)),
    pnl: money(mine.reduce((sum, c) => sum + N(c.pnl), 0)),
    points: [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, v]) => ({ day, value: money((running += v)) })),
  };
}

function clientInput(b) {
  const name = clean(b.name, 80);
  return name ? [name, clean(b.contact, 120), clean(b.trader, 80), b.live ? 1 : 0] : null;
}

async function clientHistory(db, id) {
  const rows = await db.all(`SELECT id, kind, amount, at, note FROM ${S}.client_entries WHERE client_id = $1 ORDER BY at DESC, id DESC LIMIT 500`, [id]);
  return json({ ok: true, items: rows.map((e) => ({ ...e, amount: money(e.amount) })) });
}

async function addEntry(db, id, b) {
  const kind = ['deposit', 'withdrawal', 'profit', 'loss'].includes(b.kind) ? b.kind : null;
  const amount = cents(b.amount), at = isoDate(b.at);
  if (!kind || amount === null || !at) return fail('invalid', 422);
  if (!(await first(db, `SELECT id FROM ${S}.clients WHERE id = $1`, [id]))) return fail('not_found', 404);
  await db.all(`INSERT INTO ${S}.client_entries (client_id, kind, amount, at, note) VALUES ($1, $2, $3, $4, $5)`, [id, kind, amount, at, clean(b.note, 500)]);
  return json({ ok: true }, 201);
}

/* ---------- staff ---------- */
async function listStaff(db, url) {
  const month = url.searchParams.get('month') || '';
  if (!isMonth(month)) return fail('bad_month', 422);
  const staff = await db.all(
    `SELECT e.*, r.target_pct, r.instructions_pct, r.bonus, r.deduction, r.note, r.paid_at
     FROM ${S}.employees e LEFT JOIN ${S}.reviews r ON r.employee_id = e.id AND r.month = $1
     ORDER BY lower(e.name)`, [month]);
  const rows = await clientRows(db), days = await clientDays(db);
  return json({
    ok: true,
    items: staff.map((e) => ({
      id: e.id, name: e.name, title: e.title, salary: money(e.salary), startDate: e.start_date,
      targetPct: e.target_pct ?? 0, instructionsPct: e.instructions_pct ?? 0,
      bonus: money(e.bonus), deduction: money(e.deduction), note: e.note ?? '',
      net: money(N(e.salary) + N(e.bonus) - N(e.deduction)), paidAt: e.paid_at ?? null,
      trading: tradingFor(e.name, rows, days),
    })),
  });
}

function employeeInput(b) {
  const name = clean(b.name, 80), title = clean(b.title, 80);
  const salary = cents(b.salary, { allowZero: true });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.startDate || '') ? b.startDate : '';
  return name && title && salary !== null ? [name, title, salary, start] : null;
}

async function saveReview(db, id, b) {
  if (!isMonth(b.month)) return fail('bad_month', 422);
  const bonus = cents(b.bonus, { allowZero: true }), deduction = cents(b.deduction, { allowZero: true });
  if (bonus === null || deduction === null) return fail('invalid', 422);
  if (!(await first(db, `SELECT id FROM ${S}.employees WHERE id = $1`, [id]))) return fail('not_found', 404);
  await db.all(
    `INSERT INTO ${S}.reviews (employee_id, month, target_pct, instructions_pct, bonus, deduction, note) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (employee_id, month) DO UPDATE SET target_pct = excluded.target_pct, instructions_pct = excluded.instructions_pct,
       bonus = excluded.bonus, deduction = excluded.deduction, note = excluded.note`,
    [id, b.month, pct(b.targetPct), pct(b.instructionsPct), bonus, deduction, clean(b.note, 1000)]);
  return json({ ok: true });
}

// Records the month's net salary as an "out" transaction, once per employee per month.
// One statement, so marking the month as paid and writing the transaction succeed or fail together.
async function paySalary(db, id, b) {
  if (!isMonth(b.month)) return fail('bad_month', 422);
  const e = await first(db,
    `SELECT e.name, e.salary, r.bonus, r.deduction, r.paid_at FROM ${S}.employees e
     LEFT JOIN ${S}.reviews r ON r.employee_id = e.id AND r.month = $1 WHERE e.id = $2`, [b.month, id]);
  if (!e) return fail('not_found', 404);
  if (e.paid_at) return fail('already_paid', 409);
  const net = N(e.salary) + N(e.bonus) - N(e.deduction);
  if (net <= 0) return fail('nothing_to_pay', 422);
  const now = new Date().toISOString();
  const done = await db.all(
    `WITH marked AS (
       INSERT INTO ${S}.reviews (employee_id, month, paid_at) VALUES ($1, $2, $3)
       ON CONFLICT (employee_id, month) DO UPDATE SET paid_at = excluded.paid_at WHERE ${S}.reviews.paid_at IS NULL
       RETURNING 1)
     INSERT INTO ${S}.transactions (kind, amount, at, purpose, note, created_at)
     SELECT 'out', $4::bigint, $3, $5, $6, $3 FROM marked RETURNING id`,
    [id, b.month, now, net, `Salary: ${e.name}`, `Salary for ${b.month}`]);
  return done.length ? json({ ok: true }) : fail('already_paid', 409);
}

/* ---------- router ---------- */
// `path` is what follows /api/admin/ (for example "transactions/12").
export async function handle(request, path, db, env) {
  const method = request.method;
  const url = new URL(request.url);

  if (!db || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return fail('not_configured', 503);

  let body = {};
  if (method !== 'GET') {
    // CSRF: state-changing requests must come from this site.
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
    let originHost = '';
    try { originHost = new URL(request.headers.get('Origin') || '').host; } catch { /* missing or malformed Origin */ }
    if (!originHost || originHost !== host) return fail('forbidden', 403);
    if (Number(request.headers.get('Content-Length') || 0) > 8000) return fail('too_large', 413);
    if (method !== 'DELETE') {
      try { body = (await request.json()) || {}; } catch { return fail('bad_json', 400); }
    }
  }

  try {
    await ensureSchema(db);

    if (path === 'login' && method === 'POST') return await login(request, db, env, body);
    if (path === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });

    if (!(await hasSession(request, env.SESSION_SECRET))) return fail('unauthorized', 401);

    if (path === 'session' && method === 'GET') return json({ ok: true });
    if (path === 'summary' && method === 'GET') return await summary(db, url);
    if (path === 'progress' && method === 'GET') return await progress(db);
    if (path === 'settings' && method === 'PUT') return await saveSettings(db, body);
    if (path === 'transactions' && method === 'GET') return await listTx(db, url);
    if (path === 'transactions' && method === 'POST') return await addTx(db, body);
    if (path === 'staff' && method === 'GET') return await listStaff(db, url);
    if (path === 'staff' && method === 'POST') {
      const v = employeeInput(body);
      if (!v) return fail('invalid', 422);
      const r = await first(db, `INSERT INTO ${S}.employees (name, title, salary, start_date, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [...v, new Date().toISOString()]);
      return json({ ok: true, id: r.id }, 201);
    }
    if (path === 'clients' && method === 'GET') return await listClients(db);
    if (path === 'clients' && method === 'POST') {
      const v = clientInput(body);
      if (!v) return fail('invalid', 422);
      const r = await first(db, `INSERT INTO ${S}.clients (name, contact, trader, live, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [...v, new Date().toISOString()]);
      return json({ ok: true, id: r.id }, 201);
    }

    const c = path.match(/^clients\/(\d{1,9})(?:\/(history|entries)(?:\/(\d{1,9}))?)?$/);
    if (c) {
      const id = Number(c[1]);
      if (c[2] === 'history' && !c[3] && method === 'GET') return await clientHistory(db, id);
      if (c[2] === 'entries' && !c[3] && method === 'POST') return await addEntry(db, id, body);
      if (c[2] === 'entries' && c[3] && method === 'DELETE') {
        await db.all(`DELETE FROM ${S}.client_entries WHERE id = $1 AND client_id = $2`, [Number(c[3]), id]);
        return json({ ok: true });
      }
      if (!c[2] && method === 'PUT') {
        const v = clientInput(body);
        if (!v) return fail('invalid', 422);
        await db.all(`UPDATE ${S}.clients SET name = $1, contact = $2, trader = $3, live = $4 WHERE id = $5`, [...v, id]);
        return json({ ok: true });
      }
      if (!c[2] && method === 'DELETE') {
        await db.all(`DELETE FROM ${S}.client_entries WHERE client_id = $1`, [id]);
        await db.all(`DELETE FROM ${S}.clients WHERE id = $1`, [id]);
        return json({ ok: true });
      }
    }

    const m = path.match(/^(transactions|staff)\/(\d{1,9})(?:\/(review|pay))?$/);
    if (m) {
      const id = Number(m[2]);
      if (m[1] === 'transactions' && !m[3] && method === 'DELETE') {
        await db.all(`DELETE FROM ${S}.transactions WHERE id = $1`, [id]);
        return json({ ok: true });
      }
      if (m[1] === 'staff') {
        if (m[3] === 'review' && method === 'PUT') return await saveReview(db, id, body);
        if (m[3] === 'pay' && method === 'POST') return await paySalary(db, id, body);
        if (!m[3] && method === 'PUT') {
          const v = employeeInput(body);
          if (!v) return fail('invalid', 422);
          await db.all(`UPDATE ${S}.employees SET name = $1, title = $2, salary = $3, start_date = $4 WHERE id = $5`, [...v, id]);
          return json({ ok: true });
        }
        if (!m[3] && method === 'DELETE') {
          await db.all(`DELETE FROM ${S}.reviews WHERE employee_id = $1`, [id]);
          await db.all(`DELETE FROM ${S}.employees WHERE id = $1`, [id]);
          return json({ ok: true });
        }
      }
    }
    return fail('not_found', 404);
  } catch (e) {
    console.error('admin api error', e);
    return fail('server', 500);
  }
}
