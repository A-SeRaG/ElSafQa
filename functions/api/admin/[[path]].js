// Cloudflare Pages Function: /api/admin/*  (backend of the /admins finance app)
// Binding:  DB (D1 database)
// Secrets:  ADMIN_PASSWORD, SESSION_SECRET
// Optional: ADMIN_EMAIL (default support@elsafqa.com), RESEND_API_KEY, MAIL_FROM, ALERT_EMAIL_TO
//           TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are reused as a fallback login alert.

const COOKIE = '__Host-esq_admin';
const SESSION_HOURS = 8;
const MAX_FAILS = 5; // failed logins per IP ...
const FAIL_WINDOW_MIN = 15; // ... inside this window

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
  return enc.encode(m[2]).length === 64 && safeEqual(enc.encode(m[2]), enc.encode(hex(await hmac(secret, `session:${m[1]}`))));
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/* ---------- database ---------- */
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      at TEXT NOT NULL, purpose TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_tx_at ON transactions (at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, title TEXT NOT NULL, salary INTEGER NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
      employee_id INTEGER NOT NULL, month TEXT NOT NULL,
      target_pct INTEGER NOT NULL DEFAULT 0, instructions_pct INTEGER NOT NULL DEFAULT 0,
      bonus INTEGER NOT NULL DEFAULT 0, deduction INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '', paid_at TEXT,
      PRIMARY KEY (employee_id, month))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', trader TEXT NOT NULL DEFAULT '',
      live INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS client_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('deposit','withdrawal','profit','loss')),
      amount INTEGER NOT NULL CHECK (amount > 0), at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '')`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_entries_client ON client_entries (client_id, at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)`),
  ]);
  schemaReady = true;
}

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
const money = (c) => c / 100;
const txOut = (r) => ({ id: r.id, kind: r.kind, amount: money(r.amount), at: r.at, purpose: r.purpose, note: r.note });

/* ---------- login alert ---------- */
async function loginAlert(request, env) {
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short' });
  const text = [
    'A new sign-in to the ElSafQa admin finance app just succeeded.',
    '',
    `Time (Cairo): ${when}`,
    `IP address: ${request.headers.get('CF-Connecting-IP') || 'unknown'}`,
    `Location: ${[request.cf?.city, request.cf?.country].filter(Boolean).join(', ') || 'unknown'}`,
    `Device: ${clean(request.headers.get('User-Agent'), 200) || 'unknown'}`,
    '',
    'If this was not you, change ADMIN_PASSWORD and SESSION_SECRET in Cloudflare immediately.',
  ].join('\n');

  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  }
}

/* ---------- handlers ---------- */
async function login(ctx, b) {
  const { request, env } = ctx;
  const db = env.DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const since = Date.now() - FAIL_WINDOW_MIN * 60_000;
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first();
  if (n >= MAX_FAILS) return fail('locked', 429);

  const adminEmail = (env.ADMIN_EMAIL || 'support@elsafqa.com').toLowerCase();
  const emailOk = await sameString(env.SESSION_SECRET, clean(b.email, 200).toLowerCase(), adminEmail);
  const passOk = await sameString(env.SESSION_SECRET, String(b.password ?? '').slice(0, 500), env.ADMIN_PASSWORD);
  if (!(emailOk && passOk)) {
    await db.batch([
      db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()),
      db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(Date.now() - 86_400_000),
    ]);
    return fail('invalid', 401);
  }
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  ctx.waitUntil(loginAlert(request, env).catch((e) => console.error('login alert failed', e)));
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(await makeSession(env.SESSION_SECRET), SESSION_HOURS * 3600) });
}

async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { opening: Number(s.opening_capital || 0), currency: s.currency || 'USD' };
}

async function summary(db, url) {
  const from = isoDate(url.searchParams.get('from'));
  const to = isoDate(url.searchParams.get('to'));
  if (!from || !to) return fail('bad_range', 422);
  const [all, month, s] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END), 0) AS net FROM transactions`).first(),
    db.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE 0 END), 0) AS revenue,
                       COALESCE(SUM(CASE kind WHEN 'out' THEN amount ELSE 0 END), 0) AS expenses
                FROM transactions WHERE at >= ? AND at < ?`).bind(from, to).first(),
    getSettings(db),
  ]);
  return json({
    ok: true,
    currency: s.currency,
    opening: money(s.opening),
    capital: money(s.opening + all.net),
    revenue: money(month.revenue),
    expenses: money(month.expenses),
    profit: money(month.revenue - month.expenses),
  });
}

// Capital at the end of every day that has transactions (running total on top of the opening capital).
async function progress(db) {
  const [{ results }, s] = await Promise.all([
    db.prepare(`SELECT substr(at, 1, 10) AS day, SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END) AS net
                FROM transactions GROUP BY day ORDER BY day`).all(),
    getSettings(db),
  ]);
  let running = s.opening;
  return json({ ok: true, opening: money(s.opening), points: results.map((r) => ({ day: r.day, capital: money((running += r.net)) })) });
}

async function saveSettings(db, b) {
  const opening = cents(b.opening, { allowZero: true });
  const currency = clean(b.currency, 3).toUpperCase();
  if (opening === null || !/^[A-Z]{3}$/.test(currency)) return fail('invalid', 422);
  const up = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
  await db.batch([db.prepare(up).bind('opening_capital', String(opening)), db.prepare(up).bind('currency', currency)]);
  return json({ ok: true });
}

async function listTx(db, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const { results } = await db.prepare('SELECT * FROM transactions ORDER BY at DESC, id DESC LIMIT ? OFFSET ?').bind(limit + 1, offset).all();
  return json({ ok: true, more: results.length > limit, items: results.slice(0, limit).map(txOut) });
}

async function addTx(db, b) {
  const kind = b.kind === 'in' || b.kind === 'out' ? b.kind : null;
  const amount = cents(b.amount);
  const at = isoDate(b.at);
  const purpose = clean(b.purpose, 120);
  if (!kind || amount === null || !at || !purpose) return fail('invalid', 422);
  const r = await db.prepare('INSERT INTO transactions (kind, amount, at, purpose, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(kind, amount, at, purpose, clean(b.note, 1000), new Date().toISOString()).run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}

async function listStaff(db, url) {
  const month = url.searchParams.get('month') || '';
  if (!isMonth(month)) return fail('bad_month', 422);
  const { results } = await db.prepare(
    `SELECT e.*, r.target_pct, r.instructions_pct, r.bonus, r.deduction, r.note, r.paid_at
     FROM employees e LEFT JOIN reviews r ON r.employee_id = e.id AND r.month = ?
     ORDER BY e.name COLLATE NOCASE`).bind(month).all();
  return json({
    ok: true,
    items: results.map((e) => ({
      id: e.id, name: e.name, title: e.title, salary: money(e.salary), startDate: e.start_date,
      targetPct: e.target_pct ?? 0, instructionsPct: e.instructions_pct ?? 0,
      bonus: money(e.bonus ?? 0), deduction: money(e.deduction ?? 0), note: e.note ?? '',
      net: money(e.salary + (e.bonus ?? 0) - (e.deduction ?? 0)), paidAt: e.paid_at ?? null,
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
  if (!(await db.prepare('SELECT id FROM employees WHERE id = ?').bind(id).first())) return fail('not_found', 404);
  await db.prepare(
    `INSERT INTO reviews (employee_id, month, target_pct, instructions_pct, bonus, deduction, note) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, month) DO UPDATE SET target_pct = excluded.target_pct, instructions_pct = excluded.instructions_pct,
       bonus = excluded.bonus, deduction = excluded.deduction, note = excluded.note`)
    .bind(id, b.month, pct(b.targetPct), pct(b.instructionsPct), bonus, deduction, clean(b.note, 1000)).run();
  return json({ ok: true });
}

// Records the month's net salary as an "out" transaction, once per employee per month.
async function paySalary(db, id, b) {
  if (!isMonth(b.month)) return fail('bad_month', 422);
  const e = await db.prepare(
    `SELECT e.name, e.salary, r.bonus, r.deduction, r.paid_at FROM employees e
     LEFT JOIN reviews r ON r.employee_id = e.id AND r.month = ? WHERE e.id = ?`).bind(b.month, id).first();
  if (!e) return fail('not_found', 404);
  if (e.paid_at) return fail('already_paid', 409);
  const net = e.salary + (e.bonus ?? 0) - (e.deduction ?? 0);
  if (net <= 0) return fail('nothing_to_pay', 422);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO transactions (kind, amount, at, purpose, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('out', net, now, `Salary: ${e.name}`, `Salary for ${b.month}`, now),
    db.prepare(`INSERT INTO reviews (employee_id, month, paid_at) VALUES (?, ?, ?)
                ON CONFLICT(employee_id, month) DO UPDATE SET paid_at = excluded.paid_at`).bind(id, b.month, now),
  ]);
  return json({ ok: true });
}

/* ---------- clients ---------- */
// A client's wallet is client money, kept apart from the company's own capital.
async function listClients(db) {
  const { results } = await db.prepare(
    `SELECT c.*,
       COALESCE(SUM(CASE e.kind WHEN 'deposit' THEN e.amount WHEN 'withdrawal' THEN -e.amount ELSE 0 END), 0) AS deposited,
       COALESCE(SUM(CASE e.kind WHEN 'profit' THEN e.amount WHEN 'loss' THEN -e.amount ELSE 0 END), 0) AS pnl
     FROM clients c LEFT JOIN client_entries e ON e.client_id = c.id
     GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all();
  return json({
    ok: true,
    items: results.map((c) => ({
      id: c.id, name: c.name, contact: c.contact, trader: c.trader, live: !!c.live,
      deposited: money(c.deposited), pnl: money(c.pnl), wallet: money(c.deposited + c.pnl),
    })),
  });
}

function clientInput(b) {
  const name = clean(b.name, 80);
  return name ? [name, clean(b.contact, 120), clean(b.trader, 80), b.live ? 1 : 0] : null;
}

async function clientHistory(db, id) {
  const { results } = await db.prepare('SELECT id, kind, amount, at, note FROM client_entries WHERE client_id = ? ORDER BY at DESC, id DESC LIMIT 500').bind(id).all();
  return json({ ok: true, items: results.map((e) => ({ ...e, amount: money(e.amount) })) });
}

async function addEntry(db, id, b) {
  const kind = ['deposit', 'withdrawal', 'profit', 'loss'].includes(b.kind) ? b.kind : null;
  const amount = cents(b.amount), at = isoDate(b.at);
  if (!kind || amount === null || !at) return fail('invalid', 422);
  if (!(await db.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first())) return fail('not_found', 404);
  await db.prepare('INSERT INTO client_entries (client_id, kind, amount, at, note) VALUES (?, ?, ?, ?, ?)').bind(id, kind, amount, at, clean(b.note, 500)).run();
  return json({ ok: true }, 201);
}

/* ---------- router ---------- */
export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const method = request.method;
  const path = [].concat(params.path || []).join('/');
  const url = new URL(request.url);

  if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return fail('not_configured', 503);

  let body = {};
  if (method !== 'GET') {
    // CSRF: state-changing requests must come from this site.
    if (request.headers.get('Origin') !== url.origin) return fail('forbidden', 403);
    if (Number(request.headers.get('Content-Length') || 0) > 8000) return fail('too_large', 413);
    if (method !== 'DELETE') {
      try { body = (await request.json()) || {}; } catch { return fail('bad_json', 400); }
    }
  }

  try {
    const db = env.DB;
    await ensureSchema(db);

    if (path === 'login' && method === 'POST') return login(ctx, body);
    if (path === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });

    if (!(await hasSession(request, env.SESSION_SECRET))) return fail('unauthorized', 401);

    if (path === 'session' && method === 'GET') return json({ ok: true });
    if (path === 'summary' && method === 'GET') return summary(db, url);
    if (path === 'progress' && method === 'GET') return progress(db);
    if (path === 'clients' && method === 'GET') return listClients(db);
    if (path === 'clients' && method === 'POST') {
      const v = clientInput(body);
      if (!v) return fail('invalid', 422);
      const r = await db.prepare('INSERT INTO clients (name, contact, trader, live, created_at) VALUES (?, ?, ?, ?, ?)').bind(...v, new Date().toISOString()).run();
      return json({ ok: true, id: r.meta.last_row_id }, 201);
    }
    const c = path.match(/^clients\/(\d{1,12})(?:\/(history|entries)(?:\/(\d{1,12}))?)?$/);
    if (c) {
      const id = Number(c[1]);
      if (c[2] === 'history' && !c[3] && method === 'GET') return clientHistory(db, id);
      if (c[2] === 'entries' && !c[3] && method === 'POST') return addEntry(db, id, body);
      if (c[2] === 'entries' && c[3] && method === 'DELETE') {
        await db.prepare('DELETE FROM client_entries WHERE id = ? AND client_id = ?').bind(Number(c[3]), id).run();
        return json({ ok: true });
      }
      if (!c[2] && method === 'PUT') {
        const v = clientInput(body);
        if (!v) return fail('invalid', 422);
        await db.prepare('UPDATE clients SET name = ?, contact = ?, trader = ?, live = ? WHERE id = ?').bind(...v, id).run();
        return json({ ok: true });
      }
      if (!c[2] && method === 'DELETE') {
        await db.batch([db.prepare('DELETE FROM client_entries WHERE client_id = ?').bind(id), db.prepare('DELETE FROM clients WHERE id = ?').bind(id)]);
        return json({ ok: true });
      }
    }
    if (path === 'settings' && method === 'PUT') return saveSettings(db, body);
    if (path === 'transactions' && method === 'GET') return listTx(db, url);
    if (path === 'transactions' && method === 'POST') return addTx(db, body);
    if (path === 'staff' && method === 'GET') return listStaff(db, url);
    if (path === 'staff' && method === 'POST') {
      const v = employeeInput(body);
      if (!v) return fail('invalid', 422);
      const r = await db.prepare('INSERT INTO employees (name, title, salary, start_date, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(...v, new Date().toISOString()).run();
      return json({ ok: true, id: r.meta.last_row_id }, 201);
    }

    const m = path.match(/^(transactions|staff)\/(\d{1,12})(?:\/(review|pay))?$/);
    if (m) {
      const id = Number(m[2]);
      if (m[1] === 'transactions' && !m[3] && method === 'DELETE') {
        await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }
      if (m[1] === 'staff') {
        if (m[3] === 'review' && method === 'PUT') return saveReview(db, id, body);
        if (m[3] === 'pay' && method === 'POST') return paySalary(db, id, body);
        if (!m[3] && method === 'PUT') {
          const v = employeeInput(body);
          if (!v) return fail('invalid', 422);
          await db.prepare('UPDATE employees SET name = ?, title = ?, salary = ?, start_date = ? WHERE id = ?').bind(...v, id).run();
          return json({ ok: true });
        }
        if (!m[3] && method === 'DELETE') {
          await db.batch([
            db.prepare('DELETE FROM reviews WHERE employee_id = ?').bind(id),
            db.prepare('DELETE FROM employees WHERE id = ?').bind(id),
          ]);
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
