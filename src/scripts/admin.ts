// Client for the /admins finance app. All user data is written with textContent (never innerHTML).
type Tx = { id: number; kind: 'in' | 'out'; amount: number; at: string; purpose: string; note: string };
type Staff = {
  id: number; name: string; title: string; salary: number; startDate: string;
  targetPct: number; instructionsPct: number; bonus: number; deduction: number; note: string; net: number; paidAt: string | null;
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

  card.append(head, meter('Targets achieved', s.targetPct), meter('Followed instructions', s.instructionsPct), review, actions, edit, status);
  return card;
}

async function loadStaff() {
  const month = monthInput.value || thisMonth();
  try {
    const data = await api<{ items: Staff[] }>(`staff?month=${month}`);
    $('#staff-list').replaceChildren(...data.items.map((s) => staffCard(s, month)));
    $('#staff-empty').hidden = data.items.length > 0;
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
