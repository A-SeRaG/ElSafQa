// Client for the /admins finance app. All user data is written with textContent (never innerHTML).
type Tx = { id: number; kind: 'in' | 'out'; amount: number; at: string; purpose: string; note: string };
type Staff = {
  id: number; name: string; title: string; salary: number; startDate: string;
  targetPct: number; instructionsPct: number; bonus: number; deduction: number; note: string; net: number; paidAt: string | null;
  trading: { clients: number; live: number; managed: number; pnl: number; points: { day: string; value: number }[] } | null;
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const loginView = $('#login-view'), appView = $('#app-view'), appStatus = $('#app-status');
let currency = 'USD';
let txOffset = 0;
const PAGE = 50;

const ERRORS: Record<string, string> = {
  invalid: 'Please check the values and try again.',
  locked: 'Too many failed attempts. Try again in 15 minutes.',
  not_configured: 'The admin backend is not configured yet (see DOCUMENTATION.md, section 15).',
  already_paid: 'This salary is already recorded as paid for that month.',
  nothing_to_pay: 'Net pay for this month is zero.',
  network: 'Network error. Check your connection and try again.',
};
const explain = (code: string) => ERRORS[code] ?? 'Something went wrong. Please try again.';

class ApiError extends Error {}
async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError('network'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') { showLogin(); throw new ApiError('unauthorized'); }
  if (!res.ok) throw new ApiError(data.error || 'server');
  return data;
}

/* ---------- small helpers ---------- */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function fmt(n: number) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(n); }
  catch { return `${n.toFixed(2)} ${currency}`; }
}
const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function say(el: HTMLElement, text: string, tone: 'ok' | 'err' | 'mute' = 'err') {
  el.textContent = text;
  el.classList.remove('text-gold', 'text-signal', 'text-mute');
  el.classList.add(tone === 'ok' ? 'text-gold' : tone === 'err' ? 'text-signal' : 'text-mute');
}
const report = (e: unknown, el: HTMLElement = appStatus) => { if ((e as Error).message !== 'unauthorized') say(el, explain((e as Error).message)); };
// Destructive buttons ask for a second click instead of a blocking browser dialog.
function confirmClick(btn: HTMLButtonElement, action: () => void) {
  const label = btn.textContent;
  let armed = false;
  btn.addEventListener('click', () => {
    if (armed) return action();
    armed = true;
    btn.textContent = 'Click again to confirm';
    setTimeout(() => { armed = false; btn.textContent = label; }, 3500);
  });
}

/* ---------- views ---------- */
function showLogin() { appView.hidden = true; loginView.hidden = false; $<HTMLInputElement>('#email').focus(); }
async function showApp() {
  loginView.hidden = true; appView.hidden = false;
  $<HTMLInputElement>('#at').value = localInput(new Date());
  $<HTMLInputElement>('#staff-month').value = thisMonth();
  await refreshSummary();
}

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
function openTab(name: string) {
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    $(`#panel-${t.dataset.tab}`).hidden = !on;
  }
  say(appStatus, '');
  if (name === 'summary') refreshSummary();
  if (name === 'staff') loadStaff();
  if (name === 'clients') loadClients();
}
tabs.forEach((t) => t.addEventListener('click', () => openTab(t.dataset.tab!)));

/* ---------- summary + history ---------- */
async function refreshSummary() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  try {
    const s = await api(`summary?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    currency = s.currency;
    $('#capital').textContent = fmt(s.capital);
    $('#m-expenses').textContent = fmt(s.expenses);
    $('#m-revenue').textContent = fmt(s.revenue);
    const profit = $('#m-profit');
    profit.textContent = fmt(s.profit);
    profit.classList.toggle('pos', s.profit > 0);
    profit.classList.toggle('neg', s.profit < 0);
    $('#m-label').textContent = `in ${now.toLocaleString('en', { month: 'long', year: 'numeric' })}`;
    $<HTMLInputElement>('#opening').value = String(s.opening);
    $<HTMLInputElement>('#currency').value = s.currency;
    const p = await api<{ opening: number; points: Point[] }>('progress');
    chartData = p;
    $('#chart-empty').hidden = p.points.length > 0;
    redrawCharts();
    txOffset = 0;
    $('#tx-rows').replaceChildren();
    await loadTx();
  } catch (e) { report(e); }
}

async function loadTx() {
  const data = await api<{ items: Tx[]; more: boolean }>(`transactions?limit=${PAGE}&offset=${txOffset}`);
  const rows = $('#tx-rows');
  for (const t of data.items) {
    const tr = h('tr', 'border-t border-edge align-top');
    tr.append(
      h('td', 'whitespace-nowrap px-4 py-3 text-mute', fmtDate(t.at)),
      h('td', 'px-4 py-3 font-semibold', t.purpose),
      h('td', 'max-w-xs px-4 py-3 text-mute', t.note),
      h('td', `whitespace-nowrap px-4 py-3 text-end font-semibold tabular-nums ${t.kind === 'in' ? 'pos' : 'neg'}`, `${t.kind === 'in' ? '+' : '−'}${fmt(t.amount)}`),
    );
    const del = h('button', 'text-xs text-mute hover:text-signal', 'Delete');
    del.type = 'button';
    confirmClick(del, async () => { try { await api(`transactions/${t.id}`, 'DELETE'); await refreshSummary(); } catch (e) { report(e); } });
    const td = h('td', 'whitespace-nowrap px-4 py-3 text-end');
    td.append(del);
    tr.append(td);
    rows.append(tr);
  }
  txOffset += data.items.length;
  $('#tx-empty').hidden = txOffset > 0;
  $('#tx-more').hidden = !data.more;
}
$('#tx-more').addEventListener('click', () => loadTx().catch(report));

$('#settings-toggle').addEventListener('click', () => { const f = $('#settings-form'); f.hidden = !f.hidden; });
$<HTMLFormElement>('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement;
  if (!f.reportValidity()) return;
  const fd = new FormData(f);
  try {
    await api('settings', 'PUT', { opening: Number(fd.get('opening')), currency: fd.get('currency') });
    f.hidden = true;
    await refreshSummary();
  } catch (err) { report(err); }
});

/* ---------- new transaction ---------- */
$<HTMLFormElement>('#tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement, status = $('#tx-status');
  if (!f.reportValidity()) return;
  const fd = new FormData(f);
  const btn = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
  btn.disabled = true;
  try {
    await api('transactions', 'POST', {
      kind: fd.get('kind'), amount: Number(fd.get('amount')),
      at: new Date(String(fd.get('at'))).toISOString(), // local time -> UTC
      purpose: fd.get('purpose'), note: fd.get('note'),
    });
    f.reset();
    $<HTMLInputElement>('#at').value = localInput(new Date());
    say(status, 'Saved. It now appears in the summary.', 'ok');
  } catch (err) { report(err, status); }
  finally { btn.disabled = false; }
});

/* ---------- staff ---------- */
const monthInput = $<HTMLInputElement>('#staff-month');
monthInput.addEventListener('change', loadStaff);

function numField(label: string, name: string, value: number, max?: number) {
  const wrap = h('label', 'block text-sm text-mute', label);
  const input = h('input', 'field mt-1');
  input.type = 'number'; input.name = name; input.min = '0'; input.required = true;
  input.step = max ? '1' : '0.01'; if (max) input.max = String(max);
  input.value = String(value);
  wrap.append(input);
  return wrap;
}
function meter(label: string, value: number) {
  const wrap = h('div');
  const row = h('div', 'mb-1 flex justify-between text-sm');
  row.append(h('span', 'text-mute', label), h('span', 'font-semibold tabular-nums', `${value}%`));
  const bar = h('progress', 'meter');
  bar.max = 100; bar.value = value;
  bar.setAttribute('aria-label', label);
  wrap.append(row, bar);
  return wrap;
}

function staffCard(s: Staff, month: string) {
  const card = h('article', 'space-y-4 border border-edge bg-coal p-6');
  const head = h('div', 'flex items-start justify-between gap-4');
  const who = h('div');
  who.append(h('h3', 'text-lg font-semibold', s.name), h('p', 'text-sm text-gold', s.title));
  if (s.startDate) who.append(h('p', 'text-xs text-mute', `Since ${s.startDate}`));
  const pay = h('div', 'text-end');
  pay.append(h('p', 'text-xs uppercase tracking-widest text-mute', 'Net pay'), h('p', 'font-display text-xl font-extrabold tabular-nums', fmt(s.net)),
    h('p', 'text-xs text-mute', `Base ${fmt(s.salary)}`));
  head.append(who, pay);

  const status = h('p', 'min-h-5 text-sm');
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await loadStaff(); } catch (e) { report(e, status); } };

  // Monthly evaluation
  const review = h('form', 'grid grid-cols-2 gap-3 border-t border-edge pt-4');
  const note = h('label', 'col-span-2 block text-sm text-mute', 'Evaluation note');
  const noteInput = h('textarea', 'field mt-1');
  noteInput.name = 'note'; noteInput.rows = 2; noteInput.maxLength = 1000; noteInput.value = s.note;
  note.append(noteInput);
  const save = h('button', 'btn btn-line col-span-2 !py-2', 'Save evaluation');
  save.type = 'submit';
  review.append(
    numField('Targets achieved %', 'targetPct', s.targetPct, 100), numField('Followed instructions %', 'instructionsPct', s.instructionsPct, 100),
    numField('Bonus', 'bonus', s.bonus), numField('Deduction', 'deduction', s.deduction), note, save,
  );
  review.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!review.reportValidity()) return;
    const fd = new FormData(review);
    run(() => api(`staff/${s.id}/review`, 'PUT', {
      month, targetPct: Number(fd.get('targetPct')), instructionsPct: Number(fd.get('instructionsPct')),
      bonus: Number(fd.get('bonus')), deduction: Number(fd.get('deduction')), note: fd.get('note'),
    }));
  });

  // Salary payment + edit/remove
  const actions = h('div', 'flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4 text-sm');
  if (s.paidAt) actions.append(h('span', 'pos font-semibold', `Paid ${fmtDate(s.paidAt)}`));
  else {
    const payBtn = h('button', 'font-semibold text-gold hover:text-ivory', 'Record salary payment');
    payBtn.type = 'button';
    confirmClick(payBtn, () => run(() => api(`staff/${s.id}/pay`, 'POST', { month })));
    actions.append(payBtn);
  }
  const remove = h('button', 'text-mute hover:text-signal', 'Remove employee');
  remove.type = 'button';
  confirmClick(remove, () => run(() => api(`staff/${s.id}`, 'DELETE')));
  actions.append(remove);

  const edit = h('details', 'border-t border-edge pt-4 text-sm');
  edit.append(h('summary', 'text-mute hover:text-ivory', 'Edit name, job title or salary'));
  const ef = h('form', 'mt-3 grid grid-cols-2 gap-3');
  const text = (label: string, name: string, value: string) => {
    const w = h('label', 'block text-sm text-mute', label);
    const i = h('input', 'field mt-1'); i.name = name; i.required = true; i.maxLength = 80; i.value = value;
    w.append(i); return w;
  };
  const efSave = h('button', 'btn btn-line !py-2 self-end', 'Save');
  efSave.type = 'submit';
  ef.append(text('Name', 'name', s.name), text('Job title', 'title', s.title), numField('Monthly salary', 'salary', s.salary), efSave);
  ef.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ef.reportValidity()) return;
    const fd = new FormData(ef);
    run(() => api(`staff/${s.id}`, 'PUT', { name: fd.get('name'), title: fd.get('title'), salary: Number(fd.get('salary')), startDate: s.startDate }));
  });
  edit.append(ef);

  card.append(head, meter('Targets achieved', s.targetPct), meter('Followed instructions', s.instructionsPct));
  // Trading performance, for staff who are assigned to clients as their trader.
  if (s.trading) {
    const t = s.trading;
    const line = h('div', 'flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-edge pt-4 text-sm text-mute');
    const managing = h('span', '', 'Managing '); managing.append(h('b', 'font-semibold text-ivory tabular-nums', fmt(t.managed)));
    const result = h('span', '', 'Client profit / loss '); result.append(h('b', `font-semibold tabular-nums ${t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : 'text-ivory'}`, signed(t.pnl)));
    line.append(h('span', `badge ${t.live ? 'badge-live' : ''}`, t.live ? `Live on ${t.live} of ${t.clients}` : 'Paused'),
      h('span', '', `${t.clients} client${t.clients === 1 ? '' : 's'}`), managing, result);
    card.append(line, chartBlock('Client profit / loss over time', toSeries(t.points), { zero: true, signed: true }));
  }
  card.append(review, actions, edit, status);
  return card;
}

async function loadStaff() {
  const month = monthInput.value || thisMonth();
  try {
    const data = await api<{ items: Staff[] }>(`staff?month=${month}`);
    $('#staff-list').replaceChildren(...data.items.map((s) => staffCard(s, month)));
    $('#staff-empty').hidden = data.items.length > 0;
    redrawCharts();
  } catch (e) { report(e); }
}

$<HTMLFormElement>('#staff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement;
  if (!f.reportValidity()) return;
  const fd = new FormData(f);
  try {
    await api('staff', 'POST', { name: fd.get('name'), title: fd.get('title'), salary: Number(fd.get('salary')), startDate: fd.get('startDate') });
    f.reset();
    await loadStaff();
  } catch (err) { report(err); }
});

/* ---------- capital chart ---------- */
type Point = { day: string; capital: number };
let chartData: { opening: number; points: Point[] } | null = null;
const NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>, text = '') {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text) el.textContent = text;
  return el;
}
const compact = (n: number) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n); }
  catch { return String(Math.round(n)); }
};
const dayLabel = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function niceStep(range: number, count: number) {
  const raw = range / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

type Pt = { t: number; v: number };
type ChartOpts = { height?: number; zero?: boolean; signed?: boolean };
const DAY = 86_400_000;
// Daily values -> chart points, with a starting point the day before the first movement.
const toSeries = (points: { day: string; value: number }[], start = 0): Pt[] =>
  points.length ? [{ t: Date.parse(points[0].day) - DAY, v: start }, ...points.map((p) => ({ t: Date.parse(p.day), v: p.value }))] : [];

// Every chart on the page registers here so it can be redrawn on resize or after its card is attached.
const charts = new Map<HTMLElement, () => void>();
function mountChart(box: HTMLElement, getPts: () => Pt[], opts: ChartOpts = {}) { charts.set(box, () => renderChart(box, getPts(), opts)); }
function redrawCharts() { for (const [box, draw] of charts) { if (box.isConnected) draw(); else charts.delete(box); } }

function renderChart(box: HTMLElement, pts: Pt[], opts: ChartOpts) {
  if (!box.clientWidth) return; // hidden tab: drawn when it opens
  box.replaceChildren();
  if (pts.length < 2) return;
  const show = (v: number) => (opts.signed ? signed(v) : fmt(v));
  const W = Math.max(240, box.clientWidth), H = opts.height ?? 240, top = 16, bottom = 26, right = 10;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, H < 200 ? 2 : 3);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * (W - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const base = opts.zero ? y(0) : H - bottom; // the area hangs from zero when the series can go negative

  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  for (let v = lo; v <= hi + step / 2; v += step) {
    root.append(svg('line', { class: 'chart-grid', x1: 0, x2: W, y1: y(v), y2: y(v) }), svg('text', { class: 'chart-text', x: 0, y: y(v) - 5 }, compact(v)));
  }
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  root.append(
    svg('path', { class: 'chart-area', d: `${path}L${x(t1)},${base}L0,${base}Z` }),
    svg('path', { class: 'chart-line', d: path }),
    svg('text', { class: 'chart-text', x: 0, y: H - 6 }, dayLabel(t0)),
    svg('text', { class: 'chart-text', x: W - right, y: H - 6, 'text-anchor': 'end' }, dayLabel(t1)),
  );
  const last = pts[pts.length - 1];
  const cross = svg('line', { class: 'chart-cross', y1: top, y2: H - bottom, visibility: 'hidden' });
  const dot = svg('circle', { class: 'chart-dot', r: 5, cx: x(t1), cy: y(last.v) });
  root.append(cross, dot);

  // Hover / touch: crosshair snaps to the nearest day and a tooltip shows its value.
  const tip = h('div', 'chart-tip');
  tip.hidden = true;
  const tipDate = h('div', 'text-mute'), tipValue = h('div', 'font-semibold text-ivory tabular-nums');
  tip.append(tipDate, tipValue);
  root.addEventListener('pointermove', (e) => {
    const px = e.clientX - root.getBoundingClientRect().left;
    const p = pts.reduce((a, b) => (Math.abs(x(b.t) - px) < Math.abs(x(a.t) - px) ? b : a));
    const cx = x(p.t);
    cross.setAttribute('x1', String(cx)); cross.setAttribute('x2', String(cx)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', String(cx)); dot.setAttribute('cy', String(y(p.v)));
    tipDate.textContent = dayLabel(p.t); tipValue.textContent = show(p.v);
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(0, cx - tip.offsetWidth / 2), W - tip.offsetWidth)}px`; // CSSOM, allowed by the CSP
    tip.style.top = `${Math.max(0, y(p.v) - tip.offsetHeight - 12)}px`;
  });
  root.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden'); tip.hidden = true;
    dot.setAttribute('cx', String(x(t1))); dot.setAttribute('cy', String(y(last.v)));
  });
  box.append(root, tip);
}
// A titled chart block for a card; says so when there is nothing to plot yet.
function chartBlock(title: string, pts: Pt[], opts: ChartOpts) {
  const wrap = h('div', 'border-t border-edge pt-4');
  wrap.append(h('p', 'text-xs uppercase tracking-widest text-mute', title));
  if (pts.length < 2) { wrap.append(h('p', 'mt-2 text-sm text-mute', 'No movements to plot yet.')); return wrap; }
  const box = h('div', 'relative mt-2');
  box.setAttribute('role', 'img'); box.setAttribute('aria-label', title);
  mountChart(box, () => pts, { height: 170, ...opts });
  wrap.append(box);
  return wrap;
}

mountChart($('#chart'), () => (chartData ? toSeries(chartData.points.map((p) => ({ day: p.day, value: p.capital })), chartData.opening) : []));
let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(redrawCharts, 150); });

/* ---------- clients ---------- */
type Client = { id: number; name: string; contact: string; trader: string; live: boolean; deposited: number; pnl: number; wallet: number; points: { day: string; value: number }[] };
type Entry = { id: number; kind: 'deposit' | 'withdrawal' | 'profit' | 'loss'; amount: number; at: string; note: string };
const ENTRY_LABEL = { deposit: 'Deposit', withdrawal: 'Withdrawal', profit: 'Trading profit', loss: 'Trading loss' };
const openHistory = new Set<number>();
const signed = (n: number) => `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`;

async function fillHistory(c: Client, list: HTMLElement, status: HTMLElement) {
  try {
    const data = await api<{ items: Entry[] }>(`clients/${c.id}/history`);
    list.replaceChildren();
    if (!data.items.length) list.append(h('li', 'py-2 text-mute', 'No movements yet.'));
    for (const e of data.items) {
      const plus = e.kind === 'deposit' || e.kind === 'profit';
      const li = h('li', 'flex items-baseline justify-between gap-3 border-t border-edge py-2');
      const left = h('div');
      left.append(h('p', 'font-semibold', ENTRY_LABEL[e.kind]), h('p', 'text-xs text-mute', [fmtDate(e.at), e.note].filter(Boolean).join(' · ')));
      const right = h('div', 'flex items-baseline gap-3 whitespace-nowrap');
      const del = h('button', 'text-xs text-mute hover:text-signal', 'Delete');
      del.type = 'button';
      confirmClick(del, async () => { try { await api(`clients/${c.id}/entries/${e.id}`, 'DELETE'); await loadClients(); } catch (err) { report(err, status); } });
      right.append(h('span', `font-semibold tabular-nums ${plus ? 'pos' : 'neg'}`, signed(plus ? e.amount : -e.amount)), del);
      li.append(left, right);
      list.append(li);
    }
  } catch (err) { report(err, status); }
}

function clientCard(c: Client) {
  const card = h('article', 'space-y-4 border border-edge bg-coal p-6');
  const status = h('p', 'min-h-5 text-sm');
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await loadClients(); } catch (e) { report(e, status); } };
  const update = (patch: Partial<Client>) => run(() => api(`clients/${c.id}`, 'PUT', { name: c.name, contact: c.contact, trader: c.trader, live: c.live, ...patch }));

  const head = h('div', 'flex items-start justify-between gap-4');
  const who = h('div');
  who.append(h('h3', 'text-lg font-semibold', c.name));
  if (c.contact) who.append(h('p', 'text-sm text-mute', c.contact));
  const wallet = h('div', 'text-end');
  wallet.append(h('p', 'text-xs uppercase tracking-widest text-mute', 'Wallet'), h('p', 'font-display text-2xl font-extrabold text-gold tabular-nums', fmt(c.wallet)));
  head.append(who, wallet);

  const split = h('p', 'flex flex-wrap gap-x-6 gap-y-1 text-sm text-mute');
  const dep = h('span', '', 'Net deposits '); dep.append(h('b', 'font-semibold text-ivory tabular-nums', fmt(c.deposited)));
  const pnl = h('span', '', 'Profit / loss '); pnl.append(h('b', `font-semibold tabular-nums ${c.pnl > 0 ? 'pos' : c.pnl < 0 ? 'neg' : 'text-ivory'}`, signed(c.pnl)));
  split.append(dep, pnl);

  // Live trader
  const trader = h('div', 'flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4 text-sm');
  const tl = h('div', 'flex items-center gap-3');
  const tname = h('span', 'text-mute', 'Trader ');
  tname.append(h('b', 'font-semibold text-ivory', c.trader || 'not assigned'));
  tl.append(tname, h('span', `badge ${c.live ? 'badge-live' : ''}`, c.live ? 'Live' : 'Paused'));
  const toggle = h('button', 'font-semibold text-gold hover:text-ivory', c.live ? 'Pause trading' : 'Go live');
  toggle.type = 'button';
  toggle.addEventListener('click', () => update({ live: !c.live }));
  trader.append(tl, toggle);

  // History + new movement
  const hist = h('details', 'border-t border-edge pt-4 text-sm');
  hist.append(h('summary', 'font-semibold text-gold hover:text-ivory', 'History and new movement'));
  const ef = h('form', 'mt-3 grid grid-cols-2 gap-3');
  const kindWrap = h('label', 'block text-sm text-mute', 'Type');
  const kind = h('select', 'field mt-1'); kind.name = 'kind';
  for (const [v, label] of Object.entries(ENTRY_LABEL)) { const o = h('option', '', label); o.value = v; kind.append(o); }
  kindWrap.append(kind);
  const amount = numField('Amount', 'amount', 0);
  const amountInput = amount.querySelector('input')!; amountInput.value = ''; amountInput.min = '0.01';
  const atWrap = h('label', 'block text-sm text-mute', 'Date and time');
  const at = h('input', 'field mt-1'); at.type = 'datetime-local'; at.name = 'at'; at.required = true; at.value = localInput(new Date());
  atWrap.append(at);
  const noteWrap = h('label', 'block text-sm text-mute', 'Note');
  const note = h('input', 'field mt-1'); note.name = 'note'; note.maxLength = 500;
  noteWrap.append(note);
  const add = h('button', 'btn btn-line col-span-2 !py-2', 'Add to history'); add.type = 'submit';
  ef.append(kindWrap, amount, atWrap, noteWrap, add);
  ef.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ef.reportValidity()) return;
    const fd = new FormData(ef);
    run(() => api(`clients/${c.id}/entries`, 'POST', { kind: fd.get('kind'), amount: Number(fd.get('amount')), at: new Date(String(fd.get('at'))).toISOString(), note: fd.get('note') }));
  });
  const list = h('ul', 'mt-4');
  hist.append(ef, list);
  hist.addEventListener('toggle', () => { if (hist.open) { openHistory.add(c.id); fillHistory(c, list, status); } else openHistory.delete(c.id); });
  if (openHistory.has(c.id)) hist.open = true;

  // Edit / remove
  const edit = h('details', 'border-t border-edge pt-4 text-sm');
  edit.append(h('summary', 'text-mute hover:text-ivory', 'Edit client or change trader'));
  const df = h('form', 'mt-3 grid grid-cols-2 gap-3');
  const text = (label: string, name: string, value: string, required = false) => {
    const w = h('label', 'block text-sm text-mute', label);
    const i = h('input', 'field mt-1'); i.name = name; i.required = required; i.maxLength = 120; i.value = value;
    if (name === 'trader') i.setAttribute('list', 'trader-names');
    w.append(i); return w;
  };
  const save = h('button', 'btn btn-line !py-2 self-end', 'Save'); save.type = 'submit';
  df.append(text('Name', 'name', c.name, true), text('Contact', 'contact', c.contact), text('Trader', 'trader', c.trader), save);
  df.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!df.reportValidity()) return;
    const fd = new FormData(df);
    update({ name: String(fd.get('name')), contact: String(fd.get('contact')), trader: String(fd.get('trader')) });
  });
  const remove = h('button', 'mt-4 text-mute hover:text-signal', 'Remove client and their history');
  remove.type = 'button';
  confirmClick(remove, () => run(() => api(`clients/${c.id}`, 'DELETE')));
  edit.append(df, remove);

  card.append(head, split, chartBlock('Wallet over time', toSeries(c.points), {}), trader, hist, edit, status);
  return card;
}

async function loadClients() {
  try {
    const [data, staff] = await Promise.all([api<{ items: Client[] }>('clients'), api<{ items: Staff[] }>(`staff?month=${thisMonth()}`)]);
    $('#client-list').replaceChildren(...data.items.map(clientCard));
    $('#client-empty').hidden = data.items.length > 0;
    redrawCharts();
    $('#clients-total').textContent = fmt(data.items.reduce((sum, c) => sum + c.wallet, 0));
    // Suggest staff names when choosing a trader.
    $('#trader-names').replaceChildren(...staff.items.map((s) => { const o = h('option'); o.value = s.name; return o; }));
  } catch (e) { report(e); }
}

$<HTMLFormElement>('#client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement;
  if (!f.reportValidity()) return;
  const fd = new FormData(f);
  try {
    const { id } = await api<{ id: number }>('clients', 'POST', { name: fd.get('name'), contact: fd.get('contact'), trader: fd.get('trader'), live: fd.get('live') === 'on' });
    const deposit = Number(fd.get('deposit'));
    if (deposit > 0) await api(`clients/${id}/entries`, 'POST', { kind: 'deposit', amount: deposit, at: new Date().toISOString(), note: 'First deposit' });
    f.reset();
    await loadClients();
  } catch (err) { report(err); }
});

/* ---------- sign in / out ---------- */
$<HTMLFormElement>('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement, status = $('#login-status');
  if (!f.reportValidity()) return;
  const fd = new FormData(f);
  const btn = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
  btn.disabled = true;
  say(status, 'Signing in…', 'mute');
  try {
    await api('login', 'POST', { email: fd.get('email'), password: fd.get('password') });
    f.reset();
    say(status, '');
    await showApp();
  } catch (err) {
    const code = (err as Error).message;
    say(status, code === 'invalid' ? 'Wrong email or password.' : explain(code));
  } finally { btn.disabled = false; }
});
$('#logout').addEventListener('click', async () => { await api('logout', 'POST', {}).catch(() => {}); showLogin(); });

// Boot: go straight to the app when a valid session cookie already exists.
fetch('/api/admin/session', { credentials: 'same-origin' })
  .then((r) => (r.ok ? showApp() : showLogin()))
  .catch(showLogin);
