// Client for the /login app (admin finance app + staff view). All user data is written with textContent (never innerHTML).
type Tx = { id: number; kind: 'in' | 'out'; amount: number; at: string; purpose: string; note: string };
type Staff = {
  id: number; name: string; title: string; salary: number; startDate: string;
  targetPct: number; instructionsPct: number; bonus: number; deduction: number; note: string; net: number; paidAt: string | null;
  payType: 'fixed' | 'commission'; commissionPct: number; monthPnl: number; base: number;
  adjustments: { id: number; kind: 'bonus' | 'deduction'; amount: number; reason: string }[];
  email: string; hasLogin: boolean;
  trading: { clients: number; live: number; managed: number; wallets: { id: number; name: string; stocks: number[] }[] } | null;
  deals: { count: number; pnl: number; points: { day: string; value: number }[]; items: Deal[] };
};
type Deal = { id: number; title: string; side: string; amount: number; at: string; note: string; wallet: string };
type Instrument = { id: number; symbol: string };
type Wallet = { id: number; name: string; live: boolean; stocks: number[]; deposited: number; pnl: number; wallet: number; myDeals: number; myPnl: number; points: { day: string; value: number }[] };
let role: 'admin' | 'staff' = 'admin';

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
  timeout: 'The server took too long to answer. Please try again.',
  server: 'The server could not do that just now. Please try again in a moment.',
  email_taken: 'That sign-in email is already used by another account.',
  weak_password: 'A sign-in password needs an email and at least 8 characters.',
  forbidden: 'Your account is not allowed to do that.',
  stock_not_on_wallet: "That stock isn't enabled on this wallet. The admin sets each wallet's stocks in the Clients tab.",
};
const explain = (code: string) => ERRORS[code] ?? 'Something went wrong. Please try again.';

class ApiError extends Error {}
// "Loading…" next to Sign out while any request is open (shown only if it takes more than a moment).
let pending = 0, busyTimer = 0;
function busy(delta: number) {
  pending += delta;
  clearTimeout(busyTimer);
  if (pending > 0) busyTimer = window.setTimeout(() => { $('#busy').hidden = false; }, 250);
  else $('#busy').hidden = true;
}

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  busy(1);
  try {
    res = await fetch(`/api/admin/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000), // never wait forever
    });
  } catch (e) { throw new ApiError((e as Error).name === 'TimeoutError' ? 'timeout' : 'network'); }
  finally { busy(-1); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') { showLogin(); throw new ApiError('unauthorized'); }
  if (!res.ok) throw new ApiError(data.error || 'server', { cause: data.code || res.headers.get('x-vercel-error') || `HTTP ${res.status}` });
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
const monthName = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleString('en', { month: 'long', year: 'numeric' });
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function say(el: HTMLElement, text: string, tone: 'ok' | 'err' | 'mute' = 'err') {
  el.textContent = text;
  el.classList.remove('text-gold', 'text-signal', 'text-mute');
  el.classList.add(tone === 'ok' ? 'text-gold' : tone === 'err' ? 'text-signal' : 'text-mute');
}
const report = (e: unknown, el: HTMLElement = appStatus) => {
  const err = e as Error;
  if (err.message !== 'unauthorized') say(el, explain(err.message) + (err.cause ? ` (code ${err.cause})` : ''));
};
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
async function showApp(as: 'admin' | 'staff') {
  role = as;
  loginView.hidden = true; appView.hidden = false;
  $<HTMLInputElement>('#at').value = localInput(new Date());
  $<HTMLInputElement>('#staff-month').value = thisMonth();
  $<HTMLInputElement>('#me-month').value = thisMonth();
  // Staff see only Profile, Wallets and New deal. The server refuses everything else for them anyway.
  for (const t of tabs) t.hidden = (as === 'staff') !== ('staff' in t.dataset);
  openTab(as === 'staff' ? 'me' : 'summary');
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
  // The builder needs the full width; it loads the first time the tab opens.
  $('#main').classList.toggle('wide', name === 'email');
  if (name === 'email') { const f = $<HTMLIFrameElement>('#email-frame'); if (!f.src) f.src = '/api/admin/email-builder'; }
  if (name === 'me') loadMe();
  if (name === 'wallets') loadWallets();
  if (name === 'deal') loadDealForm();
}
tabs.forEach((t) => t.addEventListener('click', () => openTab(t.dataset.tab!)));

/* ---------- summary + history ---------- */
async function refreshSummary() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  try {
    // The three requests go out together instead of one after another.
    txOffset = 0;
    const [s, p, tx] = await Promise.all([
      api(`summary?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      api<{ opening: number; points: Point[] }>('progress'),
      fetchTx(),
    ]);
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
    chartData = p;
    $('#chart-empty').hidden = p.points.length > 0;
    redrawCharts();
    $('#tx-rows').replaceChildren();
    renderTx(tx); // drawn once the currency is known
  } catch (e) { report(e); }
}

const fetchTx = () => api<{ items: Tx[]; more: boolean }>(`transactions?limit=${PAGE}&offset=${txOffset}`);
async function loadTx() { renderTx(await fetchTx()); }
function renderTx(data: { items: Tx[]; more: boolean }) {
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

// One line of the pay breakdown: label on the left, amount on the right.
function payLine(label: string, amount: string, cls = '') {
  const li = h('li', 'flex items-baseline justify-between gap-3 py-1');
  li.append(h('span', 'text-mute', label), h('span', `font-semibold tabular-nums ${cls}`, amount));
  return li;
}
const baseLabel = (s: Staff) => (s.payType === 'commission'
  ? `${s.commissionPct}% of ${fmt(Math.max(0, s.monthPnl))} net profit`
  : 'Monthly salary');

function staffCard(s: Staff, month: string) {
  const admin = role === 'admin';
  const card = h('article', 'space-y-4 border border-edge bg-coal p-6');
  const head = h('div', 'flex items-start justify-between gap-4');
  const who = h('div');
  who.append(h('h3', 'text-lg font-semibold', s.name), h('p', 'text-sm text-gold', s.title));
  if (s.startDate) who.append(h('p', 'text-xs text-mute', `Since ${s.startDate}`));
  const pay = h('div', 'text-end');
  pay.append(h('p', 'text-xs uppercase tracking-widest text-mute', 'Net pay'), h('p', 'font-display text-xl font-extrabold tabular-nums', fmt(s.net)),
    h('p', 'text-xs text-mute', s.payType === 'commission' ? `${s.commissionPct}% of profit` : `Salary ${fmt(s.salary)}`));
  head.append(who, pay);

  const status = h('p', 'min-h-5 text-sm');
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await (admin ? loadStaff() : loadMe()); } catch (e) { report(e, status); }
  };

  card.append(head, meter('Targets achieved', s.targetPct), meter('Followed instructions', s.instructionsPct));

  // Clients this person trades for (admin view only).
  if (s.trading) {
    const t = s.trading;
    const line = h('div', 'flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-edge pt-4 text-sm text-mute');
    const managing = h('span', '', 'Managing '); managing.append(h('b', 'font-semibold text-ivory tabular-nums', fmt(t.managed)));
    line.append(h('span', `badge ${t.live ? 'badge-live' : ''}`, t.live ? `Live on ${t.live} of ${t.clients}` : 'Paused'),
      h('span', '', `${t.clients} client${t.clients === 1 ? '' : 's'}`), managing);
    card.append(line);
  }

  // Pay for the month: base, each bonus and deduction with its reason, net.
  const payBox = h('div', 'border-t border-edge pt-4 text-sm');
  payBox.append(h('p', 'mb-2 font-semibold text-gold', `Pay for ${monthName(month)}`));
  const lines = h('ul', '');
  lines.append(payLine(baseLabel(s), fmt(s.base)));
  for (const a of s.adjustments) {
    const li = payLine(`${a.kind === 'bonus' ? 'Bonus' : 'Deduction'}${a.reason ? `: ${a.reason}` : ''}`, `${a.kind === 'bonus' ? '+' : '−'}${fmt(a.amount)}`, a.kind === 'bonus' ? 'pos' : 'neg');
    if (admin && !s.paidAt) {
      const del = h('button', 'ms-3 text-xs font-normal text-mute hover:text-signal', 'Delete'); del.type = 'button';
      confirmClick(del, () => run(() => api(`adjustments/${a.id}`, 'DELETE')));
      li.lastElementChild!.append(del);
    }
    lines.append(li);
  }
  const total = payLine('Net pay', fmt(s.net), 'text-ivory');
  total.classList.add('border-t', 'border-edge', 'mt-1', 'pt-2');
  lines.append(total);
  payBox.append(lines, h('p', 'mt-2 text-xs text-mute', s.paidAt ? `Paid ${fmtDate(s.paidAt)}` : 'Not recorded as paid yet'));

  if (admin && !s.paidAt) {
    const af = h('form', 'mt-3 grid grid-cols-2 gap-3');
    const kindWrap = h('label', 'block text-sm text-mute', 'Add');
    const kind = h('select', 'field mt-1'); kind.name = 'kind';
    for (const [v, label] of [['bonus', 'Bonus'], ['deduction', 'Deduction']]) { const o = h('option', '', label); o.value = v; kind.append(o); }
    kindWrap.append(kind);
    const amount = numField('Amount', 'amount', 0);
    const ai = amount.querySelector('input')!; ai.value = ''; ai.min = '0.01';
    const reasonWrap = h('label', 'col-span-2 block text-sm text-mute', 'Reason');
    const reason = h('input', 'field mt-1'); reason.name = 'reason'; reason.maxLength = 200; reason.placeholder = 'e.g. Hit the monthly target';
    reasonWrap.append(reason);
    const add = h('button', 'btn btn-line col-span-2 !py-2', 'Add to this month'); add.type = 'submit';
    af.append(kindWrap, amount, reasonWrap, add);
    af.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!af.reportValidity()) return;
      const fd = new FormData(af);
      run(() => api(`staff/${s.id}/adjustments`, 'POST', { month, kind: fd.get('kind'), amount: Number(fd.get('amount')), reason: fd.get('reason') }));
    });
    payBox.append(af);
  }
  card.append(payBox);

  if (!admin) {
    if (s.note) card.append(h('p', 'border-t border-edge pt-4 text-sm text-ivory', s.note));
    card.append(...dealsBlock(s, run), status);
    return card;
  }

  // Evaluation for the month: the two scores and a note.
  const review = h('form', 'grid grid-cols-2 gap-3 border-t border-edge pt-4');
  review.append(h('p', 'col-span-2 text-sm font-semibold text-gold', `Evaluation for ${monthName(month)}`));
  const note = h('label', 'col-span-2 block text-sm text-mute', 'Evaluation note');
  const noteInput = h('textarea', 'field mt-1');
  noteInput.name = 'note'; noteInput.rows = 2; noteInput.maxLength = 1000; noteInput.value = s.note;
  note.append(noteInput);
  const save = h('button', 'btn btn-line col-span-2 !py-2', 'Save evaluation');
  save.type = 'submit';
  review.append(numField('Targets achieved %', 'targetPct', s.targetPct, 100), numField('Followed instructions %', 'instructionsPct', s.instructionsPct, 100), note, save);
  review.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!review.reportValidity()) return;
    const fd = new FormData(review);
    run(() => api(`staff/${s.id}/review`, 'PUT', { month, targetPct: Number(fd.get('targetPct')), instructionsPct: Number(fd.get('instructionsPct')), note: fd.get('note') }));
  });

  // Salary payment + remove
  const actions = h('div', 'flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4 text-sm');
  if (s.paidAt) actions.append(h('span', 'pos font-semibold', `Paid ${fmtDate(s.paidAt)}`));
  else {
    const payBtn = h('button', 'font-semibold text-gold hover:text-ivory', `Record salary payment (${fmt(s.net)})`);
    payBtn.type = 'button';
    confirmClick(payBtn, () => run(() => api(`staff/${s.id}/pay`, 'POST', { month })));
    actions.append(payBtn);
  }
  const remove = h('button', 'text-mute hover:text-signal', 'Remove employee');
  remove.type = 'button';
  confirmClick(remove, () => run(() => api(`staff/${s.id}`, 'DELETE')));
  actions.append(remove);

  // Edit details, pay and sign-in
  const edit = h('details', 'border-t border-edge pt-4 text-sm');
  edit.append(h('summary', 'text-mute hover:text-ivory', `Edit details, pay or sign-in (${s.hasLogin ? s.email : 'no sign-in yet'})`));
  const ef = h('form', 'mt-3 grid grid-cols-2 gap-3');
  const text = (label: string, name: string, value: string, type = 'text') => {
    const w = h('label', 'block text-sm text-mute', label);
    const i = h('input', 'field mt-1'); i.name = name; i.type = type; i.required = type === 'text'; i.maxLength = type === 'text' ? 80 : 200; i.value = value;
    if (type === 'password') { i.minLength = 8; i.autocomplete = 'new-password'; }
    w.append(i); return w;
  };
  const efSave = h('button', 'btn btn-line col-span-2 !py-2', 'Save');
  efSave.type = 'submit';
  const payFields = payTypeFields(s.payType, s.salary, s.commissionPct);
  ef.append(text('Name', 'name', s.name), text('Job title', 'title', s.title), ...payFields,
    text('Sign-in email (empty = no sign-in)', 'email', s.email, 'email'), text(s.hasLogin ? 'New password (empty = keep)' : 'Sign-in password', 'password', '', 'password'), efSave);
  ef.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ef.reportValidity()) return;
    const fd = new FormData(ef);
    run(() => api(`staff/${s.id}`, 'PUT', {
      name: fd.get('name'), title: fd.get('title'), payType: fd.get('payType'), salary: Number(fd.get('salary') || 0), commissionPct: Number(fd.get('commissionPct') || 0),
      startDate: s.startDate, email: fd.get('email'), password: fd.get('password'),
    }));
  });
  edit.append(ef);

  card.append(...dealsBlock(s, run), review, actions, edit, status);
  return card;
}

// Pay type select, plus the field that goes with it (salary for fixed pay, rate for commission).
function payTypeFields(type: string, salary: number, pctValue: number) {
  const typeWrap = h('label', 'col-span-2 block text-sm text-mute', 'Pay');
  const sel = h('select', 'field mt-1'); sel.name = 'payType';
  for (const [v, label] of [['fixed', 'Fixed monthly salary'], ['commission', 'Percentage of monthly net profit (live trader)']]) { const o = h('option', '', label); o.value = v; sel.append(o); }
  sel.value = type;
  typeWrap.append(sel);
  const sal = numField('Monthly salary', 'salary', salary);
  const rate = numField('Share of net profit %', 'commissionPct', pctValue, 100);
  rate.querySelector('input')!.step = '0.01';
  const sync = () => {
    const c = sel.value === 'commission';
    sal.hidden = c; rate.hidden = !c;
    sal.querySelector('input')!.required = !c; rate.querySelector('input')!.required = c;
  };
  sel.addEventListener('change', sync); sync();
  return [typeWrap, sal, rate];
}

/* ---------- the deal list (stocks) ---------- */
let instruments: Instrument[] = [];
async function fetchInstruments() {
  instruments = (await api<{ items: Instrument[] }>('instruments')).items;
  return instruments;
}
// The stocks a wallet allows: its own list, or the whole deal list when none were chosen for it.
const stocksFor = (ids: number[] | undefined) => (ids?.length ? instruments.filter((i) => ids.includes(i.id)) : instruments);
function fillInstrumentSelect(sel: HTMLSelectElement, list: Instrument[] = instruments) {
  const keep = sel.value;
  sel.replaceChildren(...list.map((i) => { const o = h('option', '', i.symbol); o.value = String(i.id); return o; }));
  if (list.some((i) => String(i.id) === keep)) sel.value = keep;
  return list.length;
}

// Deals: what the person traded and what each deal earned or lost.
const openDeals = new Set<number>();
function dealsBlock(s: Staff, run: (fn: () => Promise<unknown>) => Promise<void>) {
  const d = s.deals;
  const line = h('div', 'flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-edge pt-4 text-sm text-mute');
  const total = h('span', '', 'Deals profit / loss '); total.append(h('b', `font-semibold tabular-nums ${d.pnl > 0 ? 'pos' : d.pnl < 0 ? 'neg' : 'text-ivory'}`, signed(d.pnl)));
  line.append(h('span', '', `${d.count} deal${d.count === 1 ? '' : 's'}`), total);

  const box = h('details', 'border-t border-edge pt-4 text-sm');
  box.append(h('summary', 'font-semibold text-gold hover:text-ivory', role === 'staff' ? 'Deals history' : 'Deals: add or review'));
  box.open = role === 'staff' || openDeals.has(s.id);
  box.addEventListener('toggle', () => { if (box.open) openDeals.add(s.id); else openDeals.delete(s.id); });

  if (role === 'admin') {
    const f = h('form', 'mt-3 grid grid-cols-2 gap-3');
    const select = (label: string, name: string, options: [string, string][], wide = false) => {
      const w = h('label', `${wide ? 'col-span-2 ' : ''}block text-sm text-mute`, label);
      const el = h('select', 'field mt-1'); el.name = name;
      for (const [v, t] of options) { const o = h('option', '', t); o.value = v; el.append(o); }
      w.append(el); return w;
    };
    const wallet = select('Wallet', 'clientId', [['', 'No wallet (record the deal only)'], ...(s.trading?.wallets ?? []).map((w): [string, string] => [String(w.id), w.name])], true);
    const stock = select('Stock', 'instrumentId', []);
    const stockSel = stock.querySelector('select')!; stockSel.required = true;
    const walletSel = wallet.querySelector('select')!;
    const syncStocks = () => fillInstrumentSelect(stockSel, stocksFor(s.trading?.wallets.find((w) => String(w.id) === walletSel.value)?.stocks));
    walletSel.addEventListener('change', syncStocks); syncStocks();
    const side = select('Buy / Sell', 'side', [['buy', 'Buy'], ['sell', 'Sell']]);
    const res = select('Result', 'result', [['profit', 'Earning'], ['loss', 'Loss']]);
    const amount = numField('Amount', 'amount', 0);
    const ai = amount.querySelector('input')!; ai.value = ''; ai.min = '0.01';
    const atWrap = h('label', 'col-span-2 block text-sm text-mute', 'Date and time');
    const at = h('input', 'field mt-1'); at.type = 'datetime-local'; at.name = 'at'; at.required = true; at.value = localInput(new Date());
    atWrap.append(at);
    const add = h('button', 'btn btn-gold col-span-2 !py-2', 'Save deal'); add.type = 'submit';
    if (!instruments.length) f.append(h('p', 'col-span-2 text-mute', 'Add stocks to the deal list (top of this tab) to record deals.'));
    else f.append(wallet, stock, side, res, amount, atWrap, add);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.reportValidity()) return;
      const fd = new FormData(f);
      run(() => api(`staff/${s.id}/deals`, 'POST', {
        clientId: Number(fd.get('clientId')) || null, instrumentId: Number(fd.get('instrumentId')), side: fd.get('side'),
        result: fd.get('result'), amount: Number(fd.get('amount')), at: new Date(String(fd.get('at'))).toISOString(),
      }));
    });
    box.append(f);
  }

  const list = h('ul', 'mt-4');
  if (!d.items.length) list.append(h('li', 'py-2 text-mute', 'No deals recorded yet.'));
  for (const deal of d.items) {
    const li = h('li', 'flex items-baseline justify-between gap-3 border-t border-edge py-2');
    const left = h('div');
    left.append(h('p', 'font-semibold', deal.title), h('p', 'text-xs text-mute', [fmtDate(deal.at), deal.wallet && `Wallet: ${deal.wallet}`, deal.note].filter(Boolean).join(' · ')));
    const right = h('div', 'flex items-baseline gap-3 whitespace-nowrap');
    right.append(h('span', `font-semibold tabular-nums ${deal.amount > 0 ? 'pos' : 'neg'}`, signed(deal.amount)));
    if (role === 'admin') {
      const del = h('button', 'text-xs text-mute hover:text-signal', 'Delete'); del.type = 'button';
      confirmClick(del, () => run(() => api(`deals/${deal.id}`, 'DELETE')));
      right.append(del);
    }
    li.append(left, right);
    list.append(li);
  }
  box.append(list);
  return [line, chartBlock('Deals profit / loss over time', toSeries(d.points), { zero: true, signed: true }), box];
}

async function loadStaff() {
  const month = monthInput.value || thisMonth();
  try {
    const [data] = await Promise.all([api<{ items: Staff[]; currency?: string }>(`staff?month=${month}`), fetchInstruments()]);
    renderInstruments();
    if (data.currency) currency = data.currency;
    $('#staff-list').replaceChildren(...data.items.map((s) => staffCard(s, month)));
    $('#staff-empty').hidden = data.items.length > 0;
    redrawCharts();
  } catch (e) { report(e); }
}

/* ---------- staff: profile, wallets, new deal ---------- */
const meMonth = $<HTMLInputElement>('#me-month');
meMonth.addEventListener('change', loadMe);

async function loadMe() {
  const month = meMonth.value || thisMonth();
  try {
    const data = await api<{ items: Staff[]; currency?: string }>(`me?month=${month}`);
    if (data.currency) currency = data.currency;
    const s = data.items[0];
    const card = staffCard(s, month);
    if (s.email) card.querySelector('h3')!.after(h('p', 'text-xs text-mute', s.email));
    $('#me-card').replaceChildren(card);
    redrawCharts();
  } catch (e) { report(e); }
}

let myWallets: Wallet[] = [];
async function fetchWallets() {
  const data = await api<{ items: Wallet[]; currency?: string }>('me/wallets');
  if (data.currency) currency = data.currency;
  myWallets = data.items;
  return myWallets;
}

function walletCard(w: Wallet) {
  const card = h('article', 'space-y-4 border border-edge bg-coal p-6');
  const head = h('div', 'flex items-start justify-between gap-4');
  const who = h('div');
  who.append(h('h3', 'text-lg font-semibold', w.name), h('span', `badge mt-2 ${w.live ? 'badge-live' : ''}`, w.live ? 'Live' : 'Paused'));
  const bal = h('div', 'text-end');
  bal.append(h('p', 'text-xs uppercase tracking-widest text-mute', 'Wallet'), h('p', 'font-display text-2xl font-extrabold text-gold tabular-nums', fmt(w.wallet)));
  head.append(who, bal);

  const split = h('p', 'flex flex-wrap gap-x-6 gap-y-1 text-sm text-mute');
  const dep = h('span', '', 'Net deposits '); dep.append(h('b', 'font-semibold text-ivory tabular-nums', fmt(w.deposited)));
  const pnl = h('span', '', 'Profit / loss '); pnl.append(h('b', `font-semibold tabular-nums ${w.pnl > 0 ? 'pos' : w.pnl < 0 ? 'neg' : 'text-ivory'}`, signed(w.pnl)));
  split.append(dep, pnl);

  const mine = h('p', 'border-t border-edge pt-4 text-sm text-mute', `My deals on this wallet: ${w.myDeals} `);
  mine.append(h('b', `font-semibold tabular-nums ${w.myPnl > 0 ? 'pos' : w.myPnl < 0 ? 'neg' : 'text-ivory'}`, `(${signed(w.myPnl)})`));

  const add = h('button', 'btn btn-line w-full !py-2', 'Add a deal on this wallet');
  add.type = 'button';
  add.addEventListener('click', () => { pendingWallet = w.id; openTab('deal'); });

  card.append(head, split, chartBlock('Wallet over time', toSeries(w.points), {}), mine, add);
  return card;
}

async function loadWallets() {
  try {
    const items = await fetchWallets();
    $('#wallet-list').replaceChildren(...items.map(walletCard));
    $('#wallet-empty').hidden = items.length > 0;
    $('#wallets-total').textContent = fmt(items.reduce((sum, w) => sum + w.wallet, 0));
    redrawCharts();
  } catch (e) { report(e); }
}

let pendingWallet = 0; // wallet chosen with "Add a deal on this wallet"
const dealForm = $<HTMLFormElement>('#deal-form');
const walletSelect = $<HTMLSelectElement>('#d-wallet');
function showWalletInfo() {
  const w = myWallets.find((x) => x.id === Number(walletSelect.value));
  $('#d-wallet-info').textContent = w ? `Balance ${fmt(w.wallet)} · ${w.live ? 'Live' : 'Paused'}` : '';
  // Only the stocks this wallet allows.
  const n = fillInstrumentSelect($<HTMLSelectElement>('#d-stock'), stocksFor(w?.stocks));
  $('#d-stock-none').hidden = n > 0;
  dealForm.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = n === 0;
}
walletSelect.addEventListener('change', showWalletInfo);

async function loadDealForm() {
  try {
    const keep = pendingWallet || Number(walletSelect.value);
    pendingWallet = 0;
    const [items] = await Promise.all([fetchWallets(), fetchInstruments()]);
    walletSelect.replaceChildren(...items.map((w) => { const o = h('option', '', `${w.name}${w.live ? '' : ' (paused)'}`); o.value = String(w.id); return o; }));
    if (items.some((w) => w.id === keep)) walletSelect.value = String(keep);
    const ready = items.length > 0 && instruments.length > 0;
    dealForm.hidden = !ready;
    $('#deal-empty').textContent = !items.length
      ? 'You have no wallets to trade on yet, so there is nothing to record. The admin assigns wallets by setting you as the trader on a client.'
      : 'The deal list is empty. The admin adds the stocks you can pick in the Staff tab.';
    $('#deal-empty').hidden = ready;
    showWalletInfo();
  } catch (e) { report(e); }
}

dealForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#deal-status');
  if (!dealForm.reportValidity()) return;
  const fd = new FormData(dealForm);
  const btn = dealForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
  btn.disabled = true;
  try {
    const clientId = Number(fd.get('clientId'));
    await api('deals', 'POST', {
      clientId, instrumentId: Number(fd.get('instrumentId')), side: fd.get('side'), result: fd.get('result'), amount: Number(fd.get('amount')),
    });
    $<HTMLInputElement>('#d-amount').value = '';
    await loadDealForm();
    walletSelect.value = String(clientId);
    showWalletInfo();
    const w = myWallets.find((x) => x.id === clientId);
    say(status, `Saved.${w ? ` ${w.name} is now ${fmt(w.wallet)}.` : ''}`, 'ok');
  } catch (err) { report(err, status); }
  finally { btn.disabled = false; }
});

function renderInstruments() {
  $('#instrument-list').replaceChildren(...instruments.map((i) => {
    const li = h('li', 'flex items-center gap-2 border border-edge px-3 py-1 text-sm');
    const del = h('button', 'text-mute hover:text-signal', '×'); del.type = 'button'; del.setAttribute('aria-label', `Remove ${i.symbol}`);
    del.addEventListener('click', async () => { try { await api(`instruments/${i.id}`, 'DELETE'); await loadStaff(); } catch (err) { report(err); } });
    li.append(h('span', 'font-semibold', i.symbol), del);
    return li;
  }));
  $('#instrument-empty').hidden = instruments.length > 0;
}
$<HTMLFormElement>('#instrument-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement;
  if (!f.reportValidity()) return;
  try {
    await api('instruments', 'POST', { symbol: new FormData(f).get('symbol') });
    f.reset();
    await loadStaff();
  } catch (err) { report(err); }
});

// Add employee: pay type picks which field shows; "live trader" in the job title suggests commission.
const newPay = $<HTMLSelectElement>('#s-pay');
function syncNewPay() {
  const c = newPay.value === 'commission';
  $('#s-salary-box').hidden = c; $('#s-rate-box').hidden = !c;
  $<HTMLInputElement>('#s-salary').required = !c; $<HTMLInputElement>('#s-rate').required = c;
}
newPay.addEventListener('change', syncNewPay);
$<HTMLInputElement>('#s-title').addEventListener('change', (e) => {
  if (/live\s*trader/i.test((e.target as HTMLInputElement).value)) { newPay.value = 'commission'; syncNewPay(); }
});
syncNewPay();

$<HTMLFormElement>('#staff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget as HTMLFormElement;
  if (!f.reportValidity()) return;
  const fd = new FormData(f);
  try {
    await api('staff', 'POST', {
      name: fd.get('name'), title: fd.get('title'), payType: fd.get('payType'), salary: Number(fd.get('salary') || 0), commissionPct: Number(fd.get('commissionPct') || 0),
      startDate: fd.get('startDate'), email: fd.get('email'), password: fd.get('password'),
    });
    f.reset();
    syncNewPay();
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
type Client = { id: number; name: string; contact: string; trader: string; live: boolean; stocks: number[]; deposited: number; pnl: number; wallet: number; points: { day: string; value: number }[] };
type Entry = { id: number; kind: 'deposit' | 'withdrawal' | 'profit' | 'loss'; amount: number; at: string; note: string; by: string };
const ENTRY_LABEL = { deposit: 'Deposit', withdrawal: 'Withdrawal', profit: 'Trading profit', loss: 'Trading loss' };
const openHistory = new Set<number>();
const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmt(Math.abs(n))}`;

async function fillHistory(c: Client, list: HTMLElement, status: HTMLElement) {
  try {
    const data = await api<{ items: Entry[] }>(`clients/${c.id}/history`);
    list.replaceChildren();
    if (!data.items.length) list.append(h('li', 'py-2 text-mute', 'No movements yet.'));
    for (const e of data.items) {
      const plus = e.kind === 'deposit' || e.kind === 'profit';
      const li = h('li', 'flex items-baseline justify-between gap-3 border-t border-edge py-2');
      const left = h('div');
      left.append(h('p', 'font-semibold', ENTRY_LABEL[e.kind]), h('p', 'text-xs text-mute', [fmtDate(e.at), e.by && `by ${e.by}`, e.note].filter(Boolean).join(' · ')));
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

  // Stocks this wallet may be traded in.
  const stocksBox = h('details', 'border-t border-edge pt-4 text-sm');
  const chosen = instruments.filter((i) => c.stocks.includes(i.id)).map((i) => i.symbol);
  stocksBox.append(h('summary', 'text-mute hover:text-ivory', `Stocks on this wallet: ${chosen.length ? chosen.join(', ') : 'all stocks in the deal list'}`));
  const sf = h('form', 'mt-3 space-y-3');
  if (!instruments.length) sf.append(h('p', 'text-mute', 'The deal list is empty. Add stocks at the top of the Staff tab first.'));
  else {
    const boxes = h('div', 'flex flex-wrap gap-2');
    for (const i of instruments) {
      const l = h('label', 'flex items-center gap-2 border border-edge px-3 py-2');
      const cb = h('input', 'h-4 w-4 accent-gold'); cb.type = 'checkbox'; cb.name = 'stock'; cb.value = String(i.id); cb.checked = c.stocks.includes(i.id);
      l.append(cb, h('span', 'font-semibold', i.symbol));
      boxes.append(l);
    }
    const save = h('button', 'btn btn-line !py-2', 'Save stocks'); save.type = 'submit';
    sf.append(boxes, h('p', 'text-xs text-mute', 'Traders can pick only the ticked stocks for this wallet. Tick none to allow every stock in the deal list.'), save);
  }
  sf.addEventListener('submit', (e) => {
    e.preventDefault();
    const ids = [...sf.querySelectorAll<HTMLInputElement>('input[name=stock]:checked')].map((x) => Number(x.value));
    run(() => api(`clients/${c.id}/stocks`, 'PUT', { ids }));
  });
  stocksBox.append(sf);

  card.append(head, split, chartBlock('Wallet over time', toSeries(c.points), {}), trader, stocksBox, hist, edit, status);
  return card;
}

async function loadClients() {
  try {
    const [data, staff] = await Promise.all([api<{ items: Client[] }>('clients'), api<{ items: { id: number; name: string }[] }>('staff/names'), fetchInstruments()]);
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
    const r = await api<{ role: 'admin' | 'staff' }>('login', 'POST', { email: fd.get('email'), password: fd.get('password') });
    f.reset();
    say(status, '');
    await showApp(r.role);
  } catch (err) {
    const code = (err as Error).message;
    say(status, code === 'invalid' ? 'Wrong email or password.' : explain(code));
  } finally { btn.disabled = false; }
});
// Sign out, then reload so nothing from the signed-in session stays in the page.
// If the request failed (offline), the reload shows the app again instead of pretending to be signed out.
$('#logout').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#logout');
  btn.disabled = true;
  await api('logout', 'POST', {}).catch(() => {});
  location.replace('/login');
});

// Boot: go straight to the app when a valid session cookie already exists.
fetch('/api/admin/session', { credentials: 'same-origin' })
  .then(async (r) => (r.ok ? showApp((await r.json()).role) : showLogin()))
  .catch(showLogin);
