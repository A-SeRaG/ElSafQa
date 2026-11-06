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
   ├─ scripts/gold.ts        Live price + trend widget logic
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

### 4.2 Hero: live gold price
- **Left:** headline, supporting line, buttons, then the **live gold price** in large type (XAU/USD, USD per ounce) and, below it in smaller type, the **general trend** (Rising / Falling / Sideways).
- **Right:** the emblem. This physical layout (text left, logo right) is kept in both English and Arabic.
- The price flashes green or red on each change, shows a Live / Connecting / Not connected / Market closed status, and dims if no tick arrives for 30 seconds.
- **How the trend is defined:** current price versus the price about one hour earlier. Within +-0.05% it shows "Sideways". For the first hour after the relay starts it shows "Collecting data...". Tune `TREND_WINDOW_MS` and `FLAT_BAND_PCT` in `worker/src/index.js`.
- The price is labelled indicative, not an execution price, and not advice.
- The browser never talks to the data provider. It connects to **your own relay** (section 15), so the API key stays secret.

### 4.3 About
Three principles: gold focus, risk first, open community.

### 4.4 How it works
A real three-step sequence (join, read the idea, decide yourself), so it is numbered.

### 4.5 Channel and channels grid
The Scalp Channel banner, then a grid of **4 channel slots**: slot 1 is the Scalp Channel (active). Slots 2 to 4 show a dashed "Coming soon" placeholder. To activate one, set `PUBLIC_CHANNEL_2_URL` (or `_3_`, `_4_`) and edit its name and description in `src/i18n/content.ts` (`channels.items`). No code change needed.

### 4.6 Risk strip
A highlighted warning with a red edge. Always visible on the page, not only in the footer.

### 4.7 FAQ
Accessible accordion built with native `<details>` (works with no JavaScript).

### 4.8 Contact form
- Fields: name, email, message. Next to the form there is a direct link to the Telegram support account `@TEAM_ElSafQa` (`SUPPORT_TELEGRAM` in `src/config.ts`).
- Protections: Cloudflare Turnstile, hidden honeypot field, length limits, same-origin check, server-side validation.
- Each message is emailed to `support@elsafqa.com` through [Resend](https://resend.com), with Reply-To set to the visitor, so you answer by simply replying. Nothing is stored in a database.
- The visitor automatically receives a thank-you email from "ElSafQa TEAM" (English or Arabic, matching the page) with a copy of their message.
- Optional: if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, each message is also posted to a Telegram chat.
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
| `RESEND_API_KEY` | secret | Resend API key used to send contact emails |
| `SUPPORT_EMAIL` | optional | Inbox that receives messages (default `support@elsafqa.com`) |
| `MAIL_FROM` | optional | Sender of both emails (default `ElSafQa TEAM <support@elsafqa.com>`) |
| `TELEGRAM_BOT_TOKEN` | optional secret | Also post each message to Telegram |
| `TELEGRAM_CHAT_ID` | optional secret | Chat for those Telegram posts |

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
- [ ] Create a Resend account, add and verify the domain `elsafqa.com` (Resend shows the DNS records to add in Cloudflare), create an API key and set it as `RESEND_API_KEY`.
- [ ] Make sure `support@elsafqa.com` is a real inbox that receives mail (for example Cloudflare Email Routing forwarding to your Gmail).
- [ ] Send a test message from the live site and check both the support email and the auto-reply (including the spam folder).
- [ ] Replace `https://elsafqa.com` with your real domain.
- [ ] **Verify the copy.** I wrote it from your brand material and assumed what the channel posts (entry, stop-loss, targets), that it is free, and that you do not manage accounts or take deposits. Edit anything that is not true in `content.ts`.
- [ ] Have a lawyer review `/legal`.
- [ ] Add social links or real, verifiable proof (team, results with dates) only if you can back them up.

## 14. Extending later
- **More sections:** add a block to `Landing.astro` and its text to both languages in `content.ts`.
- **Blog or education pages:** add files under `src/pages` (Astro content collections work well).
- **Live gold price widget:** fetch through a Pages Function and add its domain to `connect-src` in `_headers`.
- **Analytics:** add a deferred script and allow its host in `script-src` and `connect-src`.

## 15. Live gold relay (Cloudflare Worker + Durable Object)

Folder `worker/`. One upstream WebSocket to AllTick feeds all visitors, so you pay for one connection however many people are on the site.

1. **Plan:** you need a plan with real-time ticks (AllTick's Free plan lists only "latest price" and "close data"). Check their pricing and terms for public display.
2. **Test the feed first:** `ALLTICK_TOKEN=xxx node scripts/test-gold.mjs` (Node 22+). The symbol is `GOLD`, not `XAUUSD`.
3. **Deploy the relay:**
   ```bash
   cd worker && npm install
   npx wrangler login
   npx wrangler secret put ALLTICK_TOKEN
   npx wrangler deploy
   ```
   Edit `wrangler.toml` first: the route (`gold.elsafqa.com`) and `ALLOWED_ORIGIN` (your site origin). Only that origin may connect.
4. **Point the site at it:** set `PUBLIC_GOLD_WS_URL=wss://gold.elsafqa.com/stream` and redeploy the site. The CSP already allows `wss://gold.elsafqa.com` (change it in `public/_headers` if you use another host).
5. **Local preview without a relay:** `npm run dev` shows a clearly labelled **DEMO DATA** random walk. Demo mode is not included in production builds.

Notes:
- Check Cloudflare's current pricing for Durable Objects before launch.
- The relay stores one price sample per minute (last 24 hours) to compute the trend.
- The relay and widget were **not tested against the live AllTick feed**. Test with a real token before launch.
