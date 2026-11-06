const form = document.querySelector<HTMLFormElement>('#contact-form');
const status = document.querySelector<HTMLElement>('#form-status');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!status) return;
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const fd = new FormData(form);
  btn.disabled = true;
  status.className = 'text-sm text-mute';
  status.textContent = form.dataset.sending ?? '';
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fd.get('name'), email: fd.get('email'), message: fd.get('message'), lang: form.dataset.lang,
        website: fd.get('website'), token: fd.get('cf-turnstile-response'),
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    form.reset();
    status.className = 'text-sm text-gold';
    status.textContent = form.dataset.ok ?? '';
  } catch {
    status.className = 'text-sm text-signal';
    status.textContent = form.dataset.err ?? '';
  } finally {
    btn.disabled = false;
    (window as any).turnstile?.reset();
  }
});
