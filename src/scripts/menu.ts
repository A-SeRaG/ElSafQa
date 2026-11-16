// Close the phone menu after choosing a link, on Escape, or when tapping outside it.
const menu = document.querySelector<HTMLDetailsElement>('#menu');
if (menu) {
  menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) menu.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.open = false; });
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
}
