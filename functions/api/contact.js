// Cloudflare Pages Function: POST /api/contact
// Required secrets: TURNSTILE_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return json({ ok: false }, 403);
  if (Number(request.headers.get('Content-Length') || 0) > 8000) return json({ ok: false }, 413);

  let b;
  try { b = await request.json(); } catch { return json({ ok: false }, 400); }

  if (b.website) return json({ ok: true }); // honeypot: pretend success to bots

  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  const name = clean(b.name, 80), handle = clean(b.handle, 120), message = clean(b.message, 1500);
  if (!name || !handle || message.length < 5) return json({ ok: false }, 422);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(b.token || ''), remoteip: ip }),
  }).then((r) => r.json()).catch(() => ({ success: false }));
  if (!v.success) return json({ ok: false }, 403);

  const text = `New ElSafQa message\nName: ${name}\nContact: ${handle}\n\n${message}`;
  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  return tg.ok ? json({ ok: true }) : json({ ok: false }, 502);
}

export const onRequest = () => json({ ok: false }, 405); // any non-POST method
