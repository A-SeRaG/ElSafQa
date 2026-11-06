// Run: ALLTICK_TOKEN=xxx node scripts/test-gold.mjs   (Node 22+)
const ws = new WebSocket(`wss://quote.alltick.co/quote-b-ws-api?token=${process.env.ALLTICK_TOKEN}`);
let seq = 0;
const send = (cmd_id, data = {}) => ws.send(JSON.stringify({ cmd_id, seq_id: ++seq, trace: crypto.randomUUID(), data }));
ws.onopen = () => { send(22004, { symbol_list: [{ code: 'GOLD', depth_level: 5 }] }); setInterval(() => send(22000), 10000); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.cmd_id === 22998) for (const t of m.data?.tick_list ?? []) console.log(new Date(t.tick_time).toISOString(), t.price); else console.log(m); };
ws.onclose = (e) => console.log('closed', e.code);
