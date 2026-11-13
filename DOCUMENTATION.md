# ElSafQa Landing Page: Feature Documentation

**Stack:** Astro 5 (static) + Tailwind CSS 4 + Cloudflare Pages + one Pages Function (contact form)
**Languages:** English (`/`) and Arabic RTL (`/ar/`)
**Brand identity:** black and gold, taken from the supplied emblem, wordmark and Scalp Channel banner.

---

## 1. Quick start

```bash
npm install
cp .env.example .env      # fill in values (see section 8)
npm run dev               # http://localhost:4321
npm run build             # outputs ./dist
npm run audit             # checks dependencies for known vulnerabilities
```

## 2. Project structure

```
elsafqa-landing/
├─ astro.config.mjs          Site URL, sitemap, Tailwind, build security settings
├─ DOCUMENTATION.md          This file
├─ .env.example              All environment variables
├─ functions/api/contact.js  Cloudflare Pages Function: contact form backend
├─ public/
│  ├─ _headers               Security headers + cache rules (CSP, HSTS, ...)
│  ├─ robots.txt
│  ├─ favicon.png
│  └─ images/                Optimized brand assets (see section 3)
└─ src/
   ├─ config.ts              Telegram link, Turnstile site key, site name
   ├─ i18n/content.ts        ALL page text, English + Arabic
   ├─ layouts/Base.astro     <head>/SEO, header, footer, language switch
   ├─ components/
   │  ├─ Landing.astro       The home page (all sections)
   │  └─ Legal.astro         Risk / privacy / terms page
   ├─ pages/                 index, legal  (+ ar/index, ar/legal)
   ├─ scripts/contact.ts     Form submit logic
   └─ styles/global.css      Brand tokens + shared component styles
```

## 3. Brand identity

| Token | Value | Used for |
|---|---|---|
| `ink` | `#000000` | Page background (matches the logo's black) |
| `coal` | `#0c0b09` | Alternate sections, footer, form fields |
| `edge` | `#2a2417` | Borders and dividers |
| `gold` | `#f5b81c` | Primary accent, CTAs, key headings |
| `gold-deep` | `#b8860b` | Secondary button, step numerals |
| `ivory` | `#f3ead6` | Body text |
| `signal` | `#e5232a` | Red from the logo arrow. Used **only** for risk warnings and errors |

**Typography:** Saira (angular, echoes the logo's cut letters) for headings; Cairo for body text and all Arabic. Both are self-hosted through Fontsource (no Google Fonts requests).

**Assets** (`public/images/`):

| File | Source | Use |
|---|---|---|
| `emblem.webp` / `emblem-480.webp` | Glossy Gold emblem | Hero (960px), footer (480px) |
| `wordmark.webp` | Gold and Black logo, cropped | Header |
| `scalp-channel.webp` / `-800.webp` | Scalp Channel banner | Channel section (responsive `srcset`) |
| `og-image.jpg` | Banner cropped to 1200x630 | Link previews (WhatsApp, Telegram, X, Facebook) |
| `icon-256.png`, `apple-touch-icon.png`, `favicon.png` | Emblem | Favicons and structured data |

The slanted button shape is a deliberate nod to the italic "E" in the logo.

## 4. Page features

### 4.1 Header
- Sticky, translucent black bar with the wordmark.
- Anchor navigation: About, How it works, Channel, FAQ, Contact (desktop).
- **Language switch** (English / العربية) goes to the matching page in the other language.
- "Join the free channel" button (opens Telegram).
- "Skip to content" link for keyboard users.

### 4.2 Hero
- Headline "Think smart. Trade wise." (taken from the banner tagline), supporting line, two buttons and a short risk note.
- The emblem is the focal point, with a gold glow and a single entrance animation on load (disabled for users who prefer reduced motion).

### 4.3 About
Three principles: gold focus, risk first, open community.

### 4.4 How it works
A real three-step sequence (join, read the idea, decide yourself), so it is numbered.

### 4.5 Channel
The Scalp Channel banner, a short description and the Telegram button.

### 4.6 Risk strip
A highlighted warning with a red edge. Always visible on the page, not only in the footer.

### 4.7 FAQ
Accessible accordion built with native `<details>` (works with no JavaScript).

### 4.8 Contact form
- Fields: name, email or Telegram username, message.
- Protections: Cloudflare Turnstile, hidden honeypot field, length limits, same-origin check, server-side validation.
- Messages are forwarded to a private Telegram chat through a bot (nothing is stored in a database).
- Live status messages in the user's language (sending, success, error).

### 4.9 Footer
Emblem, legal disclaimer, link to the legal page, Telegram link and copyright (year updates automatically at build time).

### 4.10 Legal page (`/legal`, `/ar/legal`)
Risk disclosure, privacy and terms of use. **This is draft text. Have a lawyer review it before launch.**

## 5. Bilingual and RTL
- Each language has its own URL (`/` and `/ar/`), which is best for SEO.
- `<html lang>` and `dir` are set per page; `hreflang` tags link the two versions.
- Layout uses logical Tailwind utilities (`ps-`, `border-s-`, `text-start`, `start-`), so RTL needs no separate CSS.
- To edit text, change only `src/i18n/content.ts`.

## 6. Security

| Measure | Where | What it does |
|---|---|---|
| Static site | Astro build | No server or database to attack for page views |
| Strict CSP | `public/_headers` | Only your own files plus Cloudflare Turnstile may run. No inline scripts or styles |
| HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP | `public/_headers` | Forces HTTPS, blocks MIME sniffing, limits browser features |
| `frame-ancestors 'none'` | CSP | Prevents clickjacking |
| Scripts and CSS never inlined | `astro.config.mjs` | Lets the CSP stay strict |
| Self-hosted fonts | Fontsource | No third-party font requests (privacy and speed) |
| Turnstile + honeypot + origin check | Form and function | Blocks bots and cross-site abuse |
| Secrets as environment variables | Cloudflare dashboard | Tokens never reach the browser |
| `npm run audit` | package.json | Finds vulnerable dependencies |

**Recommended Cloudflare settings (dashboard):** enable DNSSEC, "Always Use HTTPS", Bot Fight Mode, and add a WAF rate-limit rule for `/api/contact` (for example, 5 requests per minute per IP).

**Email:** set SPF, DKIM and DMARC on your domain so nobody can spoof ElSafQa emails.

## 7. Performance
- Zero framework JavaScript. The only script is the small form handler, plus Turnstile.
- Images are WebP with explicit width/height (no layout shift), lazy loading below the fold and `srcset` for the banner.
- Hero emblem loads with `fetchpriority="high"`.
- Long-term immutable caching for `/_astro/*` and `/images/*`.
- Fonts are subsetted by Fontsource, so the browser downloads only the scripts it needs.
- Target: Lighthouse 95+ on mobile. Run Lighthouse after deploying and tune from there.

## 8. Configuration

| Variable | Type | Purpose |
|---|---|---|
| `PUBLIC_TELEGRAM_URL` | build-time | Your channel link (all Telegram buttons) |
| `PUBLIC_TURNSTILE_SITEKEY` | build-time | Turnstile site key |
| `TURNSTILE_SECRET` | secret | Turnstile server key |
| `TELEGRAM_BOT_TOKEN` | secret | Bot that receives contact messages |
| `TELEGRAM_CHAT_ID` | secret | Chat that receives them |

Secrets go in **Cloudflare Pages > Settings > Variables and Secrets**. Never commit them.

## 9. Deployment (Cloudflare Pages)
1. Push the project to GitHub.
2. Cloudflare Dashboard > Workers & Pages > Create > Pages > connect the repo.
3. Build command `npm run build`, output directory `dist`.
4. Add the variables from section 8.
5. Add your custom domain, then update `site` in `astro.config.mjs` and the Sitemap line in `public/robots.txt`.
6. The `functions/` folder is detected automatically.

## 10. SEO
Per-page title and description, canonical URLs, `hreflang`, Open Graph and Twitter cards (using `og-image.jpg`), Organization structured data (JSON-LD), auto-generated `sitemap-index.xml` and `robots.txt`.

## 11. Accessibility
Skip link, semantic landmarks and heading order, visible gold focus ring, labelled form fields, live-region form status, native accordion, reduced-motion support, and text contrast that meets WCAG AA on black.

## 12. Compliance notes
- The page makes no profit claims and shows a risk warning in the hero, in a dedicated strip, in the footer and on the legal page.
- Check the marketing rules of your regulator (in Egypt, the FRA) before launch.
- No cookies and no advertising trackers are used, so no cookie banner is needed. If you add analytics later, prefer Plausible or Umami.

## 13. Before you launch (checklist)
- [ ] Set the real Telegram channel link (the default `t.me/elsafqa` is a placeholder).
- [ ] Create a Turnstile widget and set the keys (the default site key is Cloudflare's test key).
- [ ] Create the Telegram bot and chat for contact messages.
- [ ] Replace `https://elsafqa.com` with your real domain.
- [ ] **Verify the copy.** I wrote it from your brand material and assumed what the channel posts (entry, stop-loss, targets), that it is free, and that you do not manage accounts or take deposits. Edit anything that is not true in `content.ts`.
- [ ] Have a lawyer review `/legal`.
- [ ] Add social links or real, verifiable proof (team, results with dates) only if you can back them up.

## 14. Extending later
- **More sections:** add a block to `Landing.astro` and its text to both languages in `content.ts`.
- **Blog or education pages:** add files under `src/pages` (Astro content collections work well).
- **Live gold price widget:** fetch through a Pages Function and add its domain to `connect-src` in `_headers`.
- **Analytics:** add a deferred script and allow its host in `script-src` and `connect-src`.

## 15. Admin finance app (`/admins`)

A private page for the company's finances. It is not linked from the site, is excluded from the sitemap, and is served with `noindex` and `no-store`.

**Files**

| File | Role |
|---|---|
| `src/pages/admins.astro` | Sign-in screen and the app shell (3 tabs) |
| `src/scripts/admin.ts` | Browser logic (renders data with `textContent` only) |
| `functions/api/admin/[[path]].js` | The whole backend: sign-in, session, transactions, staff, login alert |

**Tabs**

1. **Summary**: company capital (opening capital + all money in − all money out), then this month's expenses, revenue and profit on a smaller line, then the transaction history (newest first, delete with a second confirming click). "Settings" sets the opening capital and the currency code (default `USD`).
2. **New transaction**: in or out, amount, date and time, what it is for, optional note.
3. **Staff**: add employees with a job title, monthly salary and start date. Each card shows, for the selected month: targets achieved %, followed instructions %, bonus, deduction, an evaluation note and the net pay. "Record salary payment" writes the net pay as an "out" transaction, once per employee per month.

**Security model**

- The email and password are **never in the repository or in the browser code**. They are checked server-side against Cloudflare secrets, in constant time.
- Sign-in sets an HMAC-signed session cookie: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Strict`, 8 hours.
- 5 failed sign-ins from one IP lock that IP out for 15 minutes.
- Every state-changing request must carry this site's `Origin` (CSRF protection). All SQL uses bound parameters.
- Each successful sign-in sends an alert (time, IP, location, device) to the admin mailbox.

**One-time setup (Cloudflare dashboard)**

1. *Storage & Databases → D1 → Create database* (e.g. `elsafqa-admin`). Tables are created automatically on first use.
2. *Pages project → Settings → Bindings → Add → D1 database*: variable name **`DB`**, pick that database.
3. *Pages project → Settings → Variables and Secrets*, add as **Secret**:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | The admin password (required) |
| `SESSION_SECRET` | A long random string, e.g. output of `openssl rand -hex 32` (required) |
| `ADMIN_EMAIL` | Sign-in email. Optional, defaults to `support@elsafqa.com` |
| `RESEND_API_KEY` | API key from resend.com, used to send the sign-in alert email |
| `MAIL_FROM` | Optional sender, default `ElSafQa Admin <admin@elsafqa.com>`. The domain must be verified in Resend |
| `ALERT_EMAIL_TO` | Optional recipient of the alert, defaults to `ADMIN_EMAIL` |

4. Redeploy. Until `DB`, `ADMIN_PASSWORD` and `SESSION_SECRET` exist, the page shows "backend is not configured".

Without `RESEND_API_KEY`, the alert falls back to the Telegram bot already used by the contact form. Changing `SESSION_SECRET` signs everyone out immediately.

**Local testing**

```bash
npm run build
npx wrangler pages dev dist --d1 DB --binding ADMIN_PASSWORD=test --binding SESSION_SECRET=dev
# open http://localhost:8788/admins
```
