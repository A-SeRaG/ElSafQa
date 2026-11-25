// Backend of the /login app (admin finance app + staff view). Platform-neutral: api/admin.js (Vercel) passes in the
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

// `who` is "a" for the admin or "s<employee id>" for a staff member. `tag` ties a staff session to the
// current password hash, so changing or removing a password ends that person's open sessions at once.
const sign = async (secret, exp, who, tag) => hex(await hmac(secret, `session:${exp}:${who}:${tag}`));
async function makeSession(secret, who, tag = '') {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  return `${exp}.${who}.${await sign(secret, exp, who, tag)}`;
}
// Returns { who, valid(tag) } for an unexpired, well-formed cookie; the signature is checked by valid().
function readSession(request, secret) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d{13})\\.(a|s\\d{1,9})\\.([0-9a-f]{64})`));
  if (!m || Number(m[1]) < Date.now()) return null;
  return { who: m[2], valid: async (tag = '') => safeEqual(enc.encode(m[3]), enc.encode(await sign(secret, m[1], m[2], tag))) };
}

/* ---------- staff passwords (salted PBKDF2, never stored in plain text) ---------- */
const PBKDF2_ROUNDS = 100_000;
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((b) => parseInt(b, 16)));
async function pbkdf2(password, saltHex, rounds) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: rounds }, key, 256)));
}
async function hashPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PBKDF2_ROUNDS}$${salt}$${await pbkdf2(password, salt, PBKDF2_ROUNDS)}`;
}
async function verifyPassword(password, stored) {
  const [, rounds, salt, want] = String(stored).split('$');
  return safeEqual(enc.encode(await pbkdf2(password, salt || '00', Number(rounds) || PBKDF2_ROUNDS)), enc.encode(want || ''));
}
const DUMMY_HASH = `pbkdf2$${PBKDF2_ROUNDS}$00112233445566778899aabbccddeeff$${'0'.repeat(64)}`; // keeps timing equal for unknown emails
const TEST_STAFF_EMAIL = 'staff.test@elsafqa.com';
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/* ---------- database ---------- */
// Sent as one multi-statement query, which Postgres runs as one transaction. The advisory lock makes
// a second server that starts at the same moment wait for the first to finish, instead of racing it.
const SCHEMA = `
SELECT pg_advisory_xact_lock(72635401);
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
ALTER TABLE ${S}.employees ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE ${S}.employees ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_email ON ${S}.employees (lower(email)) WHERE email <> '';
CREATE TABLE IF NOT EXISTS ${S}.deals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, employee_id INTEGER NOT NULL,
  title TEXT NOT NULL, amount BIGINT NOT NULL CHECK (amount <> 0), -- cents: positive = earning, negative = loss
  at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_deals_employee ON ${S}.deals (employee_id, at);
ALTER TABLE ${S}.deals ADD COLUMN IF NOT EXISTS client_id INTEGER;  -- wallet the deal was traded on (NULL = none)
ALTER TABLE ${S}.deals ADD COLUMN IF NOT EXISTS entry_id INTEGER;   -- the profit/loss row it wrote into that wallet
CREATE INDEX IF NOT EXISTS idx_deals_entry ON ${S}.deals (entry_id);
ALTER TABLE ${S}.deals ADD COLUMN IF NOT EXISTS instrument TEXT NOT NULL DEFAULT '';
ALTER TABLE ${S}.deals ADD COLUMN IF NOT EXISTS side TEXT NOT NULL DEFAULT '';   -- 'buy' | 'sell' | '' (older deals)
-- The list traders pick a deal from. Removing one only hides it, so older deals keep their name.
CREATE TABLE IF NOT EXISTS ${S}.instruments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, symbol TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instrument_symbol ON ${S}.instruments (upper(symbol));
-- Pay: 'fixed' (monthly salary) or 'commission' (a share of the trader's net deals profit for the month).
ALTER TABLE ${S}.employees ADD COLUMN IF NOT EXISTS pay_type TEXT;
ALTER TABLE ${S}.employees ADD COLUMN IF NOT EXISTS commission_bp INTEGER NOT NULL DEFAULT 400; -- basis points: 400 = 4%
UPDATE ${S}.employees SET pay_type = 'commission' WHERE pay_type IS NULL AND lower(title) LIKE '%live trader%';
UPDATE ${S}.employees SET pay_type = 'fixed' WHERE pay_type IS NULL;
-- Bonuses and deductions, one row each, with a reason.
CREATE TABLE IF NOT EXISTS ${S}.adjustments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, employee_id INTEGER NOT NULL, month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bonus','deduction')), amount BIGINT NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_adjust_employee ON ${S}.adjustments (employee_id, month);
-- Stocks a client wallet may be traded in. A wallet with no rows here allows every stock in the deal list.
CREATE TABLE IF NOT EXISTS ${S}.client_instruments (
  client_id INTEGER NOT NULL, instrument_id INTEGER NOT NULL, PRIMARY KEY (client_id, instrument_id));
CREATE TABLE IF NOT EXISTS ${S}.reviews (
  employee_id INTEGER NOT NULL, month TEXT NOT NULL,
  target_pct INTEGER NOT NULL DEFAULT 0, instructions_pct INTEGER NOT NULL DEFAULT 0,
  bonus BIGINT NOT NULL DEFAULT 0, deduction BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', paid_at TEXT,
  PRIMARY KEY (employee_id, month));
INSERT INTO ${S}.adjustments (employee_id, month, kind, amount, reason, created_at)
  SELECT employee_id, month, 'bonus', bonus, 'Bonus', now()::text FROM ${S}.reviews WHERE bonus > 0;
INSERT INTO ${S}.adjustments (employee_id, month, kind, amount, reason, created_at)
  SELECT employee_id, month, 'deduction', deduction, 'Deduction', now()::text FROM ${S}.reviews WHERE deduction > 0;
UPDATE ${S}.reviews SET bonus = 0, deduction = 0 WHERE bonus > 0 OR deduction > 0;
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
// Bump when SCHEMA changes. A new function instance (cold start) then needs a single query to see that
// the database is already set up, instead of re-running every statement above.
const SCHEMA_VERSION = '2026-11-25c';
let setupDone = null;
function ensureSchema(db, env) {
  // One retry: if another server was setting up at the same moment, the second try finds it done.
  setupDone ??= setup(db, env)
    .catch(() => new Promise((r) => setTimeout(r, 300)).then(() => setup(db, env)))
    .catch((e) => { setupDone = null; throw e; });
  return setupDone;
}
async function setup(db, env) {
  // The marker also covers the test account's password (as a keyed fingerprint), so changing
  // TEST_STAFF_PASSWORD still takes effect at the next cold start.
  const testFp = env.TEST_STAFF_PASSWORD ? hex(await hmac(env.SESSION_SECRET, `test-staff:${env.TEST_STAFF_PASSWORD}`)) : 'off';
  const marker = `${SCHEMA_VERSION}|${testFp}`;
  try {
    const row = await first(db, `SELECT value FROM ${S}.settings WHERE key = 'setup'`);
    if (row?.value === marker) return;
  } catch { /* first run: the schema does not exist yet */ }
  await db.exec(SCHEMA);
  // Test staff account: exists and can sign in only while TEST_STAFF_PASSWORD is set.
  if (env.TEST_STAFF_PASSWORD) {
    const found = await first(db, `SELECT id, password_hash FROM ${S}.employees WHERE lower(email) = $1`, [TEST_STAFF_EMAIL]);
    // Re-hash only when the password actually changed, so the test account's open sessions survive cold starts.
    if (!found) {
      await db.all(`INSERT INTO ${S}.employees (name, title, salary, email, password_hash, created_at, pay_type) VALUES ('Test Staff', 'Test account', 0, $1, $2, $3, 'fixed') ON CONFLICT DO NOTHING`,
        [TEST_STAFF_EMAIL, await hashPassword(env.TEST_STAFF_PASSWORD), new Date().toISOString()]);
    } else if (!found.password_hash || !(await verifyPassword(env.TEST_STAFF_PASSWORD, found.password_hash))) {
      await db.all(`UPDATE ${S}.employees SET password_hash = $1 WHERE id = $2`, [await hashPassword(env.TEST_STAFF_PASSWORD), found.id]);
    }
  } else {
    await db.all(`UPDATE ${S}.employees SET password_hash = '' WHERE lower(email) = $1`, [TEST_STAFF_EMAIL]);
  }
  await db.all(`INSERT INTO ${S}.settings (key, value) VALUES ('setup', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [marker]);
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
async function loginAlert(request, env, account) {
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short' });
  const place = [request.headers.get('x-vercel-ip-city'), request.headers.get('x-vercel-ip-country')].filter(Boolean).map(decodeURIComponent).join(', ');
  const text = [
    'A new sign-in to the ElSafQa team app just succeeded.',
    '',
    `Account: ${account}`,
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
        subject: `ElSafQa sign-in: ${account}`,
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
  const email = clean(b.email, 200).toLowerCase(), password = String(b.password ?? '').slice(0, 500);
  let who = null, account = '', tag = '';
  if (await sameString(env.SESSION_SECRET, email, adminEmail)) {
    if (await sameString(env.SESSION_SECRET, password, env.ADMIN_PASSWORD)) { who = 'a'; account = `Admin (${adminEmail})`; }
  } else {
    const e = await first(db, `SELECT id, name, password_hash FROM ${S}.employees WHERE lower(email) = $1 AND password_hash <> ''`, [email]);
    const ok = await verifyPassword(password, e?.password_hash || DUMMY_HASH);
    if (e && ok) { who = `s${e.id}`; account = `Staff: ${e.name} (${email})`; tag = e.password_hash; }
  }
  if (!who) {
    await db.all(`INSERT INTO ${S}.login_attempts (ip, at) VALUES ($1, $2)`, [ip, Date.now()]);
    await db.all(`DELETE FROM ${S}.login_attempts WHERE at < $1`, [Date.now() - 86_400_000]);
    return fail('invalid', 401);
  }
  await db.all(`DELETE FROM ${S}.login_attempts WHERE ip = $1`, [ip]);
  await loginAlert(request, env, account).catch((e) => console.error('login alert failed', e));
  return json({ ok: true, role: who === 'a' ? 'admin' : 'staff' }, 200, { 'Set-Cookie': cookie(await makeSession(env.SESSION_SECRET, who, tag), SESSION_HOURS * 3600) });
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
  const r = await first(db,
    `SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END), 0) AS net,
            COALESCE(SUM(CASE WHEN kind = 'in' AND at >= $1 AND at < $2 THEN amount ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN kind = 'out' AND at >= $1 AND at < $2 THEN amount ELSE 0 END), 0) AS expenses,
            (SELECT value FROM ${S}.settings WHERE key = 'opening_capital') AS opening,
            (SELECT value FROM ${S}.settings WHERE key = 'currency') AS currency
     FROM ${S}.transactions`, [from, to]);
  const month = r, opening = Number(r.opening || 0);
  return json({
    ok: true,
    currency: r.currency || 'USD',
    opening: money(opening),
    capital: money(opening + N(r.net)),
    revenue: money(month.revenue),
    expenses: money(month.expenses),
    profit: money(N(month.revenue) - N(month.expenses)),
  });
}

// Capital at the end of every day that has transactions (running total on top of the opening capital).
async function progress(db) {
  const [rows, s] = await Promise.all([
    db.all(`SELECT substr(at, 1, 10) AS day, SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END) AS net
            FROM ${S}.transactions GROUP BY 1 ORDER BY 1`),
    getSettings(db),
  ]);
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

async function walletStocks(db) {
  const rows = await db.all(`SELECT client_id, instrument_id FROM ${S}.client_instruments ORDER BY instrument_id`);
  const map = new Map();
  for (const r of rows) map.set(r.client_id, [...(map.get(r.client_id) || []), r.instrument_id]);
  return map;
}

async function setWalletStocks(db, clientId, b) {
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!(await first(db, `SELECT id FROM ${S}.clients WHERE id = $1`, [clientId]))) return fail('not_found', 404);
  // One statement: clear the wallet's list, then insert the chosen stocks that exist.
  await db.all(
    `WITH cleared AS (DELETE FROM ${S}.client_instruments WHERE client_id = $1)
     INSERT INTO ${S}.client_instruments (client_id, instrument_id)
     SELECT $1, i.id FROM ${S}.instruments i WHERE i.id = ANY($2::int[])`, [clientId, ids]);
  return json({ ok: true });
}

async function listClients(db) {
  const [rows, days, stocks] = await Promise.all([clientRows(db), clientDays(db), walletStocks(db)]);
  return json({
    ok: true,
    items: rows.map((c) => {
      let running = 0;
      return {
        id: c.id, name: c.name, contact: c.contact, trader: c.trader, live: !!c.live, stocks: stocks.get(c.id) || [],
        deposited: money(c.deposited), pnl: money(c.pnl), wallet: money(N(c.deposited) + N(c.pnl)),
        points: days.filter((d) => d.client_id === c.id).map((d) => ({ day: d.day, value: money((running += N(d.net))) })),
      };
    }),
  });
}

// A client is assigned to a staff member when the client's "trader" field carries that person's name.
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// What a staff member does as a trader (admin view).
function tradingFor(name, rows, stocks = new Map()) {
  const mine = rows.filter((c) => sameName(c.trader, name));
  if (!mine.length) return null;
  return {
    clients: mine.length,
    live: mine.filter((c) => c.live).length,
    managed: money(mine.reduce((sum, c) => sum + N(c.deposited) + N(c.pnl), 0)),
    wallets: mine.map((c) => ({ id: c.id, name: c.name, stocks: stocks.get(c.id) || [] })),
  };
}

// The wallets a staff member trades on (staff view). Client contact details are left out on purpose.
async function staffWallets(db, staffId) {
  const [me, allRows, allDays, mine, settings, stocks] = await Promise.all([
    first(db, `SELECT name FROM ${S}.employees WHERE id = $1`, [staffId]),
    clientRows(db),
    clientDays(db),
    db.all(`SELECT client_id, COUNT(*) AS n, SUM(amount) AS pnl FROM ${S}.deals
            WHERE employee_id = $1 AND client_id IS NOT NULL GROUP BY client_id`, [staffId]),
    getSettings(db),
    walletStocks(db),
  ]);
  const rows = allRows.filter((c) => sameName(c.trader, me.name));
  const ids = new Set(rows.map((c) => c.id));
  const days = allDays.filter((d) => ids.has(d.client_id));
  return json({
    ok: true,
    currency: settings.currency,
    items: rows.map((c) => {
      let running = 0;
      const d = mine.find((x) => x.client_id === c.id);
      return {
        id: c.id, name: c.name, live: !!c.live, stocks: stocks.get(c.id) || [],
        deposited: money(c.deposited), pnl: money(c.pnl), wallet: money(N(c.deposited) + N(c.pnl)),
        myDeals: N(d?.n), myPnl: money(d?.pnl),
        points: days.filter((x) => x.client_id === c.id).map((x) => ({ day: x.day, value: money((running += N(x.net))) })),
      };
    }),
  });
}

function clientInput(b) {
  const name = clean(b.name, 80);
  return name ? [name, clean(b.contact, 120), clean(b.trader, 80), b.live ? 1 : 0] : null;
}

async function clientHistory(db, id) {
  const rows = await db.all(
    `SELECT e.id, e.kind, e.amount, e.at, e.note, emp.name AS by
     FROM ${S}.client_entries e
     LEFT JOIN ${S}.deals d ON d.entry_id = e.id
     LEFT JOIN ${S}.employees emp ON emp.id = d.employee_id
     WHERE e.client_id = $1 ORDER BY e.at DESC, e.id DESC LIMIT 500`, [id]);
  return json({ ok: true, items: rows.map((e) => ({ ...e, by: e.by ?? '', amount: money(e.amount) })) });
}

async function addEntry(db, id, b) {
  const kind = ['deposit', 'withdrawal', 'profit', 'loss'].includes(b.kind) ? b.kind : null;
  const amount = cents(b.amount), at = isoDate(b.at);
  if (!kind || amount === null || !at) return fail('invalid', 422);
  if (!(await first(db, `SELECT id FROM ${S}.clients WHERE id = $1`, [id]))) return fail('not_found', 404);
  await db.all(`INSERT INTO ${S}.client_entries (client_id, kind, amount, at, note) VALUES ($1, $2, $3, $4, $5)`, [id, kind, amount, at, clean(b.note, 500)]);
  return json({ ok: true }, 201);
}

/* ---------- pay ---------- */
// A month is counted in Cairo time, so a deal at 00:30 on the 1st belongs to that month.
const monthOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7);

// Base pay for the month: the fixed salary, or the commission rate of the month's net deals profit
// (earnings minus losses; nothing when the month is a net loss).
function basePay(e, monthPnl) {
  if (e.pay_type === 'commission') return Math.round((Math.max(0, monthPnl) * N(e.commission_bp)) / 10_000);
  return N(e.salary);
}

/* ---------- instruments (the deal list) ---------- */
const instrumentList = (db, all = false) =>
  db.all(`SELECT id, symbol, active FROM ${S}.instruments ${all ? '' : 'WHERE active = 1'} ORDER BY upper(symbol)`);

async function addInstrument(db, b) {
  const symbol = clean(b.symbol, 30).toUpperCase();
  if (!symbol) return fail('invalid', 422);
  await db.all(
    `INSERT INTO ${S}.instruments (symbol, active, created_at) VALUES ($1, 1, $2)
     ON CONFLICT (upper(symbol)) DO UPDATE SET active = 1`, [symbol, new Date().toISOString()]);
  return json({ ok: true }, 201);
}

/* ---------- staff ---------- */
// Staff cards for a month. `onlyId` limits the result to one employee (a staff member's own view).
async function staffItems(db, month, onlyId = null) {
  const [staff, deals, rows, adjustments, stocks] = await Promise.all([
    db.all(
      `SELECT e.*, r.target_pct, r.instructions_pct, r.note, r.paid_at
       FROM ${S}.employees e LEFT JOIN ${S}.reviews r ON r.employee_id = e.id AND r.month = $1
       WHERE $2::int IS NULL OR e.id = $2::int
       ORDER BY lower(e.name)`, [month, onlyId]),
    db.all(
      `SELECT d.id, d.employee_id, d.title, d.amount, d.at, d.note, d.client_id, d.side, c.name AS wallet
       FROM ${S}.deals d LEFT JOIN ${S}.clients c ON c.id = d.client_id
       WHERE $1::int IS NULL OR d.employee_id = $1::int ORDER BY d.at DESC, d.id DESC LIMIT 5000`, [onlyId]),
    onlyId ? [] : clientRows(db),
    db.all(`SELECT id, employee_id, kind, amount, reason FROM ${S}.adjustments
            WHERE month = $1 AND ($2::int IS NULL OR employee_id = $2::int) ORDER BY id`, [month, onlyId]),
    onlyId ? new Map() : walletStocks(db),
  ]);
  return staff.map((e) => {
    const mine = deals.filter((d) => d.employee_id === e.id);
    const monthPnl = mine.filter((d) => monthOf(d.at) === month).reduce((sum, d) => sum + N(d.amount), 0);
    const adj = adjustments.filter((a) => a.employee_id === e.id);
    const bonus = adj.filter((a) => a.kind === 'bonus').reduce((sum, a) => sum + N(a.amount), 0);
    const deduction = adj.filter((a) => a.kind === 'deduction').reduce((sum, a) => sum + N(a.amount), 0);
    const base = basePay(e, monthPnl);
    const byDay = new Map();
    for (const d of mine) byDay.set(d.at.slice(0, 10), (byDay.get(d.at.slice(0, 10)) || 0) + N(d.amount));
    let running = 0;
    return {
      id: e.id, name: e.name, title: e.title, salary: money(e.salary), startDate: e.start_date,
      email: e.email, hasLogin: !!e.password_hash,
      payType: e.pay_type || 'fixed', commissionPct: N(e.commission_bp) / 100, monthPnl: money(monthPnl), base: money(base),
      targetPct: e.target_pct ?? 0, instructionsPct: e.instructions_pct ?? 0,
      bonus: money(bonus), deduction: money(deduction), note: e.note ?? '',
      adjustments: adj.map((a) => ({ id: a.id, kind: a.kind, amount: money(a.amount), reason: a.reason })),
      net: money(base + bonus - deduction), paidAt: e.paid_at ?? null,
      trading: onlyId ? null : tradingFor(e.name, rows, stocks),
      deals: {
        count: mine.length,
        pnl: money(mine.reduce((sum, d) => sum + N(d.amount), 0)),
        points: [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, v]) => ({ day, value: money((running += v)) })),
        items: mine.slice(0, 100).map((d) => ({ id: d.id, title: d.title, side: d.side, amount: money(d.amount), at: d.at, note: d.note, wallet: d.wallet ?? '' })),
      },
    };
  });
}

// A deal: what it was, how much it earned or lost, and the client wallet it was traded on.
// On a wallet, the deal also writes that wallet's "Trading profit" / "Trading loss" row, in the same statement.
// Staff must pick one of their own wallets; the admin may also record a deal with no wallet.
async function addDeal(db, employeeId, b, { staff = false } = {}) {
  const note = staff ? '' : clean(b.note, 500);
  const amount = cents(b.amount);
  const at = staff || !b.at ? new Date().toISOString() : isoDate(b.at); // staff deals are timed by the server
  const sign = b.result === 'profit' ? 1 : b.result === 'loss' ? -1 : 0;
  const side = b.side === 'buy' || b.side === 'sell' ? b.side : null;
  const clientId = Number(b.clientId) || null;
  const inst = await first(db, `SELECT symbol FROM ${S}.instruments WHERE id = $1 AND active = 1`, [Number(b.instrumentId) || 0]);
  if (!inst || !side || amount === null || !at || !sign || (staff && !clientId)) return fail('invalid', 422);
  const title = `${inst.symbol} ${side === 'buy' ? 'Buy' : 'Sell'}`;
  const emp = await first(db, `SELECT id, name FROM ${S}.employees WHERE id = $1`, [employeeId]);
  if (!emp) return fail('not_found', 404);
  const now = new Date().toISOString();

  if (!clientId) {
    await db.all(`INSERT INTO ${S}.deals (employee_id, title, amount, at, note, created_at, instrument, side) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [employeeId, title, sign * amount, at, note, now, inst.symbol, side]);
    return json({ ok: true }, 201);
  }
  const client = await first(db, `SELECT id, trader FROM ${S}.clients WHERE id = $1`, [clientId]);
  if (!client) return fail('not_found', 404);
  if (staff && !sameName(client.trader, emp.name)) return fail('forbidden', 403); // not this trader's wallet
  const allowed = await first(db,
    `SELECT COUNT(*) AS n, COALESCE(bool_or(instrument_id = $2), false) AS ok FROM ${S}.client_instruments WHERE client_id = $1`,
    [clientId, Number(b.instrumentId)]);
  if (N(allowed.n) > 0 && !allowed.ok) return fail('stock_not_on_wallet', 422);

  await db.all(
    `WITH entry AS (
       INSERT INTO ${S}.client_entries (client_id, kind, amount, at, note) VALUES ($1, $2, $3, $4, $5) RETURNING id)
     INSERT INTO ${S}.deals (employee_id, title, amount, at, note, created_at, client_id, entry_id, instrument, side)
     SELECT $6, $7, $8::bigint, $4, $9, $10, $1, id, $11, $12 FROM entry`,
    [clientId, sign > 0 ? 'profit' : 'loss', amount, at, note ? `${title} · ${note}`.slice(0, 500) : title,
     employeeId, title, sign * amount, note, now, inst.symbol, side]);
  return json({ ok: true }, 201);
}

// Create or update an employee, including the optional sign-in (email + password).
async function saveEmployee(db, env, b, id = null) {
  const name = clean(b.name, 80), title = clean(b.title, 80);
  const payType = b.payType === 'commission' ? 'commission' : 'fixed';
  const salary = cents(b.salary || 0, { allowZero: true }); // not used for commission pay
  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.startDate || '') ? b.startDate : '';
  const email = clean(b.email, 200).toLowerCase(), password = String(b.password ?? '');
  const bp = Math.round(Number(b.commissionPct ?? 4) * 100);
  if (!name || !title || salary === null || (email && !isEmail(email))) return fail('invalid', 422);
  if (!Number.isFinite(bp) || bp < 0 || bp > 10_000) return fail('invalid', 422);
  if (email === (env.ADMIN_EMAIL || 'support@elsafqa.com').toLowerCase()) return fail('email_taken', 409);
  if (password && (password.length < 8 || password.length > 200 || !email)) return fail('weak_password', 422);
  try {
    if (id === null) {
      const r = await first(db,
        `INSERT INTO ${S}.employees (name, title, salary, start_date, email, password_hash, created_at, pay_type, commission_bp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [name, title, salary, start, email, password ? await hashPassword(password) : '', new Date().toISOString(), payType, bp]);
      return json({ ok: true, id: r.id }, 201);
    }
    // Empty email removes the sign-in; empty password keeps the current one.
    await db.all(
      `UPDATE ${S}.employees SET name = $1, title = $2, salary = $3, start_date = $4, email = $5,
         password_hash = CASE WHEN $5 = '' THEN '' WHEN $6 <> '' THEN $6 ELSE password_hash END,
         pay_type = $8, commission_bp = $9
       WHERE id = $7`, [name, title, salary, start, email, password ? await hashPassword(password) : '', id, payType, bp]);
    return json({ ok: true });
  } catch (e) {
    if (e?.code === '23505') return fail('email_taken', 409);
    throw e;
  }
}

async function saveReview(db, id, b) {
  if (!isMonth(b.month)) return fail('bad_month', 422);
  if (!(await first(db, `SELECT id FROM ${S}.employees WHERE id = $1`, [id]))) return fail('not_found', 404);
  await db.all(
    `INSERT INTO ${S}.reviews (employee_id, month, target_pct, instructions_pct, note) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, month) DO UPDATE SET target_pct = excluded.target_pct, instructions_pct = excluded.instructions_pct,
       note = excluded.note`,
    [id, b.month, pct(b.targetPct), pct(b.instructionsPct), clean(b.note, 1000)]);
  return json({ ok: true });
}

// One bonus or deduction for a month, with its reason. Not allowed once that month's salary is recorded as paid.
async function addAdjustment(db, id, b) {
  const kind = b.kind === 'bonus' || b.kind === 'deduction' ? b.kind : null;
  const amount = cents(b.amount);
  if (!isMonth(b.month) || !kind || amount === null) return fail('invalid', 422);
  if (!(await first(db, `SELECT id FROM ${S}.employees WHERE id = $1`, [id]))) return fail('not_found', 404);
  if (await first(db, `SELECT 1 FROM ${S}.reviews WHERE employee_id = $1 AND month = $2 AND paid_at IS NOT NULL`, [id, b.month])) return fail('already_paid', 409);
  await db.all(`INSERT INTO ${S}.adjustments (employee_id, month, kind, amount, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, b.month, kind, amount, clean(b.reason, 200), new Date().toISOString()]);
  return json({ ok: true }, 201);
}

// Records the month's net salary as an "out" transaction, once per employee per month.
// One statement, so marking the month as paid and writing the transaction succeed or fail together.
async function paySalary(db, id, b) {
  if (!isMonth(b.month)) return fail('bad_month', 422);
  const [e] = await staffItems(db, b.month, id);
  if (!e) return fail('not_found', 404);
  if (e.paidAt) return fail('already_paid', 409);
  const net = Math.round(e.net * 100);
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
    await ensureSchema(db, env);

    if (path === 'login' && method === 'POST') return await login(request, db, env, body);
    if (path === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });

    const session = readSession(request, env.SESSION_SECRET);
    if (!session) return fail('unauthorized', 401);
    const who = session.who;

    // Staff accounts: their own card and adding their own deals. Nothing else.
    if (who !== 'a') {
      const staffId = Number(who.slice(1));
      const me = await first(db, `SELECT id, password_hash FROM ${S}.employees WHERE id = $1 AND password_hash <> ''`, [staffId]);
      // Refused when the account was removed, its sign-in disabled, or its password changed since the cookie was issued.
      if (!me || !(await session.valid(me.password_hash))) return fail('unauthorized', 401);
      if (path === 'session' && method === 'GET') return json({ ok: true, role: 'staff' });
      if (path === 'me' && method === 'GET') {
        const month = url.searchParams.get('month') || '';
        if (!isMonth(month)) return fail('bad_month', 422);
        return json({ ok: true, currency: (await getSettings(db)).currency, items: await staffItems(db, month, staffId) });
      }
      if (path === 'me/wallets' && method === 'GET') return await staffWallets(db, staffId);
      if (path === 'instruments' && method === 'GET') return json({ ok: true, items: await instrumentList(db) });
      if (path === 'deals' && method === 'POST') return await addDeal(db, staffId, body, { staff: true });
      return fail('forbidden', 403);
    }

    if (!(await session.valid())) return fail('unauthorized', 401);
    if (path === 'session' && method === 'GET') return json({ ok: true, role: 'admin' });
    if (path === 'summary' && method === 'GET') return await summary(db, url);
    if (path === 'progress' && method === 'GET') return await progress(db);
    if (path === 'settings' && method === 'PUT') return await saveSettings(db, body);
    if (path === 'transactions' && method === 'GET') return await listTx(db, url);
    if (path === 'transactions' && method === 'POST') return await addTx(db, body);
    if (path === 'staff' && method === 'GET') {
      const month = url.searchParams.get('month') || '';
      if (!isMonth(month)) return fail('bad_month', 422);
      return json({ ok: true, items: await staffItems(db, month) });
    }
    if (path === 'instruments' && method === 'GET') return json({ ok: true, items: await instrumentList(db) });
    if (path === 'instruments' && method === 'POST') return await addInstrument(db, body);
    const ins = path.match(/^instruments\/(\d{1,9})$/);
    if (ins && method === 'DELETE') {
      await db.all(`UPDATE ${S}.instruments SET active = 0 WHERE id = $1`, [Number(ins[1])]);
      return json({ ok: true });
    }
    const adj = path.match(/^adjustments\/(\d{1,9})$/);
    if (adj && method === 'DELETE') {
      const gone = await db.all(
        `DELETE FROM ${S}.adjustments a WHERE a.id = $1 AND NOT EXISTS (
           SELECT 1 FROM ${S}.reviews r WHERE r.employee_id = a.employee_id AND r.month = a.month AND r.paid_at IS NOT NULL)
         RETURNING a.id`, [Number(adj[1])]);
      return gone.length ? json({ ok: true }) : fail('already_paid', 409);
    }
    if (path === 'staff/names' && method === 'GET') {
      return json({ ok: true, items: await db.all(`SELECT id, name FROM ${S}.employees ORDER BY lower(name)`) });
    }
    if (path === 'staff' && method === 'POST') return await saveEmployee(db, env, body);
    if (path === 'clients' && method === 'GET') return await listClients(db);
    if (path === 'clients' && method === 'POST') {
      const v = clientInput(body);
      if (!v) return fail('invalid', 422);
      const r = await first(db, `INSERT INTO ${S}.clients (name, contact, trader, live, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [...v, new Date().toISOString()]);
      return json({ ok: true, id: r.id }, 201);
    }

    const c = path.match(/^clients\/(\d{1,9})(?:\/(history|entries|stocks)(?:\/(\d{1,9}))?)?$/);
    if (c) {
      const id = Number(c[1]);
      if (c[2] === 'history' && !c[3] && method === 'GET') return await clientHistory(db, id);
      if (c[2] === 'stocks' && !c[3] && method === 'PUT') return await setWalletStocks(db, id, body);
      if (c[2] === 'entries' && !c[3] && method === 'POST') return await addEntry(db, id, body);
      if (c[2] === 'entries' && c[3] && method === 'DELETE') {
        await db.all(
          `WITH gone AS (DELETE FROM ${S}.client_entries WHERE id = $1 AND client_id = $2 RETURNING id)
           DELETE FROM ${S}.deals WHERE entry_id IN (SELECT id FROM gone)`, [Number(c[3]), id]);
        return json({ ok: true });
      }
      if (!c[2] && method === 'PUT') {
        const v = clientInput(body);
        if (!v) return fail('invalid', 422);
        await db.all(`UPDATE ${S}.clients SET name = $1, contact = $2, trader = $3, live = $4 WHERE id = $5`, [...v, id]);
        return json({ ok: true });
      }
      if (!c[2] && method === 'DELETE') {
        await db.all(`UPDATE ${S}.deals SET client_id = NULL, entry_id = NULL WHERE client_id = $1`, [id]); // keep the trader's history
        await db.all(`DELETE FROM ${S}.client_entries WHERE client_id = $1`, [id]);
        await db.all(`DELETE FROM ${S}.client_instruments WHERE client_id = $1`, [id]);
        await db.all(`DELETE FROM ${S}.clients WHERE id = $1`, [id]);
        return json({ ok: true });
      }
    }

    const m = path.match(/^(transactions|staff|deals)\/(\d{1,9})(?:\/(review|pay|deals|adjustments))?$/);
    if (m) {
      const id = Number(m[2]);
      if (m[1] === 'transactions' && !m[3] && method === 'DELETE') {
        await db.all(`DELETE FROM ${S}.transactions WHERE id = $1`, [id]);
        return json({ ok: true });
      }
      if (m[1] === 'deals' && !m[3] && method === 'DELETE') {
        // Removing a deal also removes the profit/loss row it wrote into the client's wallet.
        await db.all(
          `WITH gone AS (DELETE FROM ${S}.deals WHERE id = $1 RETURNING entry_id)
           DELETE FROM ${S}.client_entries WHERE id IN (SELECT entry_id FROM gone WHERE entry_id IS NOT NULL)`, [id]);
        return json({ ok: true });
      }
      if (m[1] === 'staff') {
        if (m[3] === 'deals' && method === 'POST') return await addDeal(db, id, body);
        if (m[3] === 'review' && method === 'PUT') return await saveReview(db, id, body);
        if (m[3] === 'adjustments' && method === 'POST') return await addAdjustment(db, id, body);
        if (m[3] === 'pay' && method === 'POST') return await paySalary(db, id, body);
        if (!m[3] && method === 'PUT') return await saveEmployee(db, env, body, id);
        if (!m[3] && method === 'DELETE') {
          await db.all(`DELETE FROM ${S}.deals WHERE employee_id = $1`, [id]);
          await db.all(`DELETE FROM ${S}.reviews WHERE employee_id = $1`, [id]);
          await db.all(`DELETE FROM ${S}.adjustments WHERE employee_id = $1`, [id]);
          await db.all(`DELETE FROM ${S}.employees WHERE id = $1`, [id]);
          return json({ ok: true });
        }
      }
    }
    return fail('not_found', 404);
  } catch (e) {
    console.error('admin api error', e);
    // A short code says what failed without exposing any data: a database code (e.g. 42P01), a connection
    // code (e.g. CONNECT_TIMEOUT), or the kind of program error (e.g. TypeError).
    const raw = String(e?.code || (/did not answer/.test(e?.message) ? 'DB_TIMEOUT' : e?.name || ''));
    const code = /^[A-Za-z0-9_]{2,40}$/.test(raw) ? raw : undefined;
    return json({ ok: false, error: 'server', code }, 500);
  }
}
