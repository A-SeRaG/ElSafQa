import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// TODO: replace with the real domain
export default defineConfig({
  site: 'https://elsafqa.com',
  integrations: [sitemap({ filter: (page) => !page.includes('/admins') })], // keep the private admin page out of the sitemap
  // External CSS only => strict CSP without 'unsafe-inline' for styles
  build: { inlineStylesheets: 'never' },
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } }, // never inline scripts (CSP)
});
