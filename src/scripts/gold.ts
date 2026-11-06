// Live gold price + trend. Talks ONLY to our own relay (the API key never reaches the browser).
type Labels = Record<string, string>;
const root = document.querySelector<HTMLElement>('#gold-ticker');

if (root) {
  const L: Labels = JSON.parse(root.dataset.labels ?? '{}');
  const priceEl = root.querySelector<HTMLElement>('#gold-price')!;
  const trendEl = root.querySelector<HTMLElement>('#gold-trend')!;
  const dotEl = root.querySelector<HTMLElement>('#gold-dot')!;
  const statusEl = root.querySelector<HTMLElement>('#gold-status')!;
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let last: number | null = null;
  let staleTimer: number | undefined;
  let demo = false;

  const setStatus = (key: 'live' | 'connecting' | 'offline' | 'closed') => {
    statusEl.textContent = (key === 'live' && demo ? L.demo : L[key]) ?? '';
    dotEl.className = 'inline-block h-2 w-2 rounded-full ' + (key === 'live' ? 'bg-up' : key === 'closed' ? 'bg-gold-deep' : 'bg-mute');
    priceEl.classList.toggle('stale', key !== 'live');
  };

  const onTick = (price: number) => {
    if (!Number.isFinite(price)) return;
    priceEl.textContent = fmt.format(price);
    if (last !== null && price !== last) {
      priceEl.classList.remove('tick-up', 'tick-down');
      priceEl.classList.add(price > last ? 'tick-up' : 'tick-down');
      window.setTimeout(() => priceEl.classList.remove('tick-up', 'tick-down'), 450);
    }
    last = price;
    setStatus('live');
    window.clearTimeout(staleTimer);
    staleTimer = window.setTimeout(() => setStatus('closed'), 30_000);
  };

  const onTrend = (dir: string, pct: number) => {
    const cls: Record<string, string> = { up: 'text-up', down: 'text-signal', flat: 'text-ivory', warming: 'text-mute' };
    const arrow: Record<string, string> = { up: '▲', down: '▼', flat: '▬', warming: '' };
    trendEl.className = 'font-semibold ' + (cls[dir] ?? 'text-mute');
    trendEl.textContent =
      dir === 'warming'
        ? L.warming
        : `${arrow[dir]} ${L[dir]} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}% ${L.over})`;
  };

  const connect = (url: string, attempt = 0) => {
    setStatus('connecting');
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'tick') onTick(m.price);
        else if (m.type === 'trend') onTrend(m.dir, m.pct);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      setStatus('offline');
      window.setTimeout(() => connect(url, attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
    };
    ws.onopen = () => { attempt = 0; };
  };

  const url = root.dataset.ws;
  if (url) connect(url);
  else if (import.meta.env.DEV) {
    // Local preview only: fake random walk, clearly labelled DEMO. Never included in production builds.
    demo = true;
    let p = 2650, n = 0;
    onTrend('warming', 0);
    window.setInterval(() => {
      p += (Math.random() - 0.48) * 0.8;
      onTick(p);
      if (++n === 6) onTrend('up', 0.34);
    }, 1000);
  } else {
    setStatus('offline');
    onTrend('warming', 0);
  }
}
