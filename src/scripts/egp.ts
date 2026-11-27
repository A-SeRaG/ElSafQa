// Shows the EGP value under each dollar price, from the live USD -> EGP rate (/api/rate).
// If the rate can't be loaded, the prices simply stay in dollars.
const els = document.querySelectorAll<HTMLElement>('[data-usd]');
if (els.length) {
  fetch('/api/rate').then((r) => r.json()).then((j) => {
    if (!j.ok) return;
    const ar = document.documentElement.lang === 'ar';
    for (const el of els) {
      const n = Math.round(Number(el.dataset.usd) * j.rate).toLocaleString('en');
      el.textContent = ar ? `≈ ${n} جنيه مصري` : `≈ EGP ${n}`;
      el.title = ar ? `بسعر اليوم: 1 دولار = ${j.rate.toFixed(2)} جنيه` : `At today's rate: 1 USD = ${j.rate.toFixed(2)} EGP`;
    }
  }).catch(() => {});
}
