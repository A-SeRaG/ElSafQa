# ElSafQa Landing Page: Feature Documentation

**Stack:** Astro (static) + Tailwind CSS 4, hosted on **Vercel** (two Vercel Functions: contact form and the team app) with **Supabase** Postgres for the team app's data
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
├─ vercel.json               Security headers (CSP, HSTS, ...), cache rules, redirects, API routing
├─ api/contact.js            Vercel Function: contact form backend
├─ api/admin.js              Vercel Function: team app backend (see section 15)
├─ lib/admin-core.js         Team app logic
├─ public/
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
   ├─ pages/                 index, legal  (+ ar/index, ar/legal), login
   ├─ scripts/contact.ts     Form submit logic
   ├─ scripts/menu.ts        Closes the phone menu after a tap
   ├─ scripts/admin.ts       Team app (section 15)
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

### 4.5 Channels
Three cards, each with its banner, price, short description and a Telegram button:

| Channel | Price shown | Button opens |
|---|---|---|
| Public channel | Free, "More than 15,000 members" | `PUBLIC_TELEGRAM_URL` (the public channel) |
| Swing channel | $20 | `PUBLIC_VIP_URL` (the team's Telegram account, default `t.me/TEAM_ElSafQa`) |
| VIP group | $50 per month, with $100 struck through | `PUBLIC_VIP_URL` |

Names, prices and text are in `content.ts` under `channels`. Banners are `public/images/channel-<id>-640.webp` and `-1200.webp`.

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
Risk disclosure, privacy and terms of use. **The text has not been reviewed by a lawyer.** The page no longer says so publicly, so get it reviewed.

## 5. Bilingual and RTL
- Each language has its own URL (`/` and `/ar/`), which is best for SEO.
- `<html lang>` and `dir` are set per page; `hreflang` tags link the two versions.
- Layout uses logical Tailwind utilities (`ps-`, `border-s-`, `text-start`, `start-`), so RTL needs no separate CSS.
- To edit text, change only `src/i18n/content.ts`.

## 6. Security

| Measure | Where | What it does |
|---|---|---|
| Static site | Astro build | No server or database to attack for page views |
| Strict CSP | `vercel.json` | Only your own files plus Cloudflare Turnstile may run. No inline scripts or styles |
| HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP | `vercel.json` | Forces HTTPS, blocks MIME sniffing, limits browser features |
| `frame-ancestors 'none'` | CSP | Prevents clickjacking |
| Scripts and CSS never inlined | `astro.config.mjs` | Lets the CSP stay strict |
| Self-hosted fonts | Fontsource | No third-party font requests (privacy and speed) |
| Turnstile + honeypot + origin check | Form and function | Blocks bots and cross-site abuse |
| Secrets as environment variables | Vercel project settings | Tokens never reach the browser |
| `npm run audit` | package.json | Finds vulnerable dependencies |

**Recommended:** in Vercel > Firewall, add a rate-limit rule for `/api/contact` and `/api/admin/login` (for example, 5 requests per minute per IP). Enable DNSSEC at your domain registrar.

**Email:** set SPF, DKIM and DMARC on your domain so nobody can spoof ElSafQa emails.

## 7. Performance
- Zero framework JavaScript on the public pages. The only scripts are the small form handler, the phone-menu helper, Turnstile and the Vercel Analytics counter.
- Images are WebP with explicit width/height (no layout shift), lazy loading below the fold and `srcset` for the banner.
- Hero emblem loads with `fetchpriority="high"` and a `srcset` (720 px and 960 px versions).
- Immutable one-year caching for `/_astro/*` (hashed file names) and 30 days for `/images/*`.
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

All of them go in **Vercel > Project > Settings > Environment Variables**. Never commit them. The two `PUBLIC_` values are built into the pages, so redeploy after changing them. The team app has its own variables (section 15); `.env.example` lists everything.

## 9. Deployment (Vercel)
1. The GitHub repo is connected to a Vercel project; every push to `main` deploys automatically, and other branches get a preview URL.
2. Framework preset: Astro. Build command `npm run build`, output directory `dist`.
3. Add the variables from section 8 (and section 15 for the team app), then redeploy.
4. Files in `api/` are deployed as Vercel Functions automatically. `vercel.json` adds the headers, redirects and API routing.
5. Optional: turn on **Analytics** for the project in Vercel to count visits (the script is already in the pages and is cookie-less).

## 10. SEO
Per-page title and description, canonical URLs, `hreflang`, Open Graph and Twitter cards (using `og-image.jpg`), Organization structured data (JSON-LD), auto-generated `sitemap-index.xml` and `robots.txt`.

## 11. Accessibility
Skip link, semantic landmarks and heading order, visible gold focus ring, labelled form fields, live-region form status, native accordion, reduced-motion support, and text contrast that meets WCAG AA on black.

## 12. Compliance notes
- The page makes no profit claims and shows a risk warning in the hero, in a dedicated strip, in the footer and on the legal page.
- Check the marketing rules of your regulator (in Egypt, the FRA) before launch.
- No advertising trackers are used. Visit counting uses Vercel Web Analytics, which sets no cookies, so no cookie banner is needed. The team app at `/login` sets one strictly necessary session cookie.

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
- **Live gold price widget:** fetch through a Vercel Function in `api/` so the browser only talks to your own domain.
- **Other third-party scripts:** allow their host in `script-src` and `connect-src` in `vercel.json`.

## 15. Team app (`/login`): admin finance app and staff view

A private page for the company's finances. The site header has a "Log in" button that opens it. It is excluded from the sitemap and is served with `noindex` and `no-store`.

**Files**

| File | Role |
|---|---|
| `src/pages/login.astro` | Sign-in screen and the app shell (4 tabs) |
| `src/scripts/admin.ts` | Browser logic (renders data with `textContent` only) |
| `lib/admin-core.js` | The whole backend logic: sign-in, session, transactions, staff, clients, login alert |
| `api/admin.js` | Vercel Function that connects to Supabase Postgres (a `pg` pool registered with Vercel's `attachDatabasePool`, so idle connections close before Vercel pauses the function) and runs the backend |
| `vercel.json` | Routes `/api/admin/*` to that function and sets the `/login` security headers (and redirects the old `/admins` address to `/login`) |

**Tabs**

1. **Summary**: company capital (opening capital + all money in − all money out), then this month's expenses, revenue and profit on a smaller line, then a "Capital over time" line chart (capital at the end of each day, hover or touch for the exact value), then the transaction history (newest first, delete with a second confirming click). "Settings" sets the opening capital and the currency code (default `USD`).
2. **New transaction**: in or out, amount, date and time, what it is for, optional note.
3. **Staff**: add employees with a job title, monthly salary and start date. Each card shows, for the selected month: targets achieved %, followed instructions %, bonus, deduction, an evaluation note and the net pay. Each card also has a **Deals** block: every deal with what it earned or lost, the running total, and a "Deals profit / loss over time" chart. A staff member whose name is set as the trader on one or more clients additionally shows how many of those clients are live and the total they manage. "Record salary payment" writes the net pay as an "out" transaction, once per employee per month.
4. **Clients**: add clients with a contact, an assigned trader and an optional first deposit. Each card shows the client's wallet (net deposits + trading profit − trading loss), the trader with a Live / Paused status you can switch, and the client's history of deposits, withdrawals, profits and losses. Each card also has a "Wallet over time" chart. Client wallets are client money: they are tracked separately and do **not** change the company capital.

**Email builder (admin)**

The *Email builder* tab makes branded ElSafQa emails (job offers, partner welcomes or blank) with a live preview, then copies them as a ready email, as HTML, or as a Google Apps Script that sends them from Gmail.

- Source: `tools/email-builder.html`. `npm run build` turns it into `lib/email-builder.js` (via `tools/build-email-builder.mjs`), so edit the HTML file only.
- Served by `/api/admin/email-builder` to the admin only (staff get 403, visitors 401), with its own security policy: it can't send data anywhere, and only this site can show it in a frame.
- Saved templates are kept in the admin's browser (localStorage), without passwords.

**Accounts and roles**

| Account | Signs in with | Sees |
|---|---|---|
| Admin | `ADMIN_EMAIL` + `ADMIN_PASSWORD` (environment variables) | All four tabs |
| Staff | The sign-in email and password the admin sets on their employee card | Only the Staff tab, with only their own card |

- A staff member sees three tabs:
  1. **Profile**: name, job title, sign-in email, salary, bonus and deduction for the chosen month, targets and instructions scores, and their deals history (each deal shows the wallet it was on) with a running profit / loss chart.
  2. **Wallets**: every client wallet where the client's *Trader* field is their name: balance, Live / Paused, net deposits, profit / loss, a "Wallet over time" chart, and their own deals on that wallet. Client contact details are not shown.
  3. **New deal**: pick one of those wallets, a stock from the deal list, Buy or Sell, Earning or Loss, and type the amount. The server stamps the date and time; staff cannot back-date a deal.
- **Saving a deal on a wallet does two things at once:** it adds a "Trading profit" or "Trading loss" row to that client's wallet (the admin sees "by <trader>" in the client's history) and it adds the deal to the trader's history. Deleting either one deletes the other. Removing a client keeps the trader's deals but unlinks them from the wallet.
- Staff cannot edit or delete anything, cannot record on another trader's wallet, and cannot see other staff, clients they don't trade, transactions or the company summary. The server refuses those requests; hiding the tabs is only cosmetic.
- The admin can also add a deal from a staff card, on one of that trader's wallets or with no wallet (recorded in the history only, no wallet change), and may set its date.
- **Deal list:** the admin keeps the list of stocks at the top of the Staff tab (add, or × to remove). Removing a stock hides it from the pickers; past deals keep its name. Adding it again brings it back.
- **Stocks per wallet:** on each client card in the Clients tab, *Stocks on this wallet* lets the admin tick which stocks from the deal list that wallet may be traded in. Traders then see only those stocks when they pick that wallet, and the server refuses any other. A wallet with nothing ticked allows every stock in the deal list.

**Pay, bonuses, deductions and evaluation (admin, per month, on each staff card)**

- **Pay type** is set per employee (Add employee, or *Edit details, pay or sign-in*): a fixed monthly salary, or a percentage of the month's net deals profit (default 4%, for live traders). Net profit is earnings minus losses of that trader's deals in that month, counted in Cairo time; a month that ends in a net loss pays 0 commission. Entering "Live Trader" as the job title picks the percentage automatically. When this update first runs, every employee whose job title contains "live trader" is switched to 4% of profit; everyone else keeps their fixed salary.
- **Bonuses and deductions** are separate items, each with an amount and a reason, listed under *Pay for <month>*. Bonus and deduction figures saved before this update were moved into that list.
- **Net pay** = base pay + bonuses − deductions. *Record salary payment* writes that amount as an "out" transaction. After that, the month's bonuses and deductions are locked.
- **Evaluation for <month>**: targets achieved %, followed instructions %, and a note. Staff see all of this on their Profile, read-only.
- The admin gives an employee a sign-in in *Add employee* or under *Edit details or sign-in* on the card. An empty email removes the sign-in. Removing the sign-in or changing the password signs that person out everywhere at once. Staff passwords are stored only as salted PBKDF2 hashes.
- Deals never change the company capital. Only the client wallet they are recorded on changes.
- **Test staff account:** set the environment variable `TEST_STAFF_PASSWORD` in Vercel and redeploy. The account `staff.test@elsafqa.com` ("Test Staff") then exists with that password. Remove the variable and redeploy to switch its sign-in off.

**Security model**

- The email and password are **never in the repository or in the browser code**. They are checked server-side against Vercel environment variables, in constant time.
- Sign-in sets an HMAC-signed session cookie: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Strict`, 8 hours.
- 5 failed sign-ins from one IP lock that IP out for 15 minutes.
- Every state-changing request must carry this site's `Origin` (CSRF protection). All SQL uses bound parameters.
- The data lives in its own Postgres schema, `elsafqa_admin`, which the Supabase Data API does not expose. The browser never talks to Supabase; only the Vercel function does.
- Each successful sign-in sends an alert (time, IP, location, device) to the admin mailbox.

**Hosting:** this app runs on **Vercel** (function) with **Supabase** (Postgres database).

**One-time setup**

1. **Supabase**: create a project. Click **Connect** at the top of the dashboard and copy the **Transaction pooler** connection string (port `6543`), replacing `[YOUR-PASSWORD]` with the database password. No SQL to run: the tables are created automatically on first use.
2. **Vercel**: *Project → Settings → Environment Variables*, add (mark them Sensitive):

| Name | Value |
|---|---|
| `DATABASE_URL` | The Supabase Transaction pooler connection string (required) |
| `ADMIN_PASSWORD` | The admin password (required) |
| `SESSION_SECRET` | A long random string, e.g. output of `openssl rand -hex 32` (required) |
| `ADMIN_EMAIL` | Sign-in email. Optional, defaults to `support@elsafqa.com` |
| `RESEND_API_KEY` | API key from resend.com, used to send the sign-in alert email |
| `MAIL_FROM` | Optional sender, default `ElSafQa Admin <admin@elsafqa.com>`. The domain must be verified in Resend |
| `ALERT_EMAIL_TO` | Optional recipient of the alert, defaults to `ADMIN_EMAIL` |
| `TEST_STAFF_PASSWORD` | Optional. Enables the test staff account `staff.test@elsafqa.com` with this password |

3. **Put the function next to the database.** Every page of the app talks to Supabase, so the distance between them is what you feel. In Supabase, *Project Settings > General* shows the region (for example *Central EU (Frankfurt)*). In Vercel, *Project > Settings > Functions > Function Region*, pick the closest one (Frankfurt is `fra1`), save, and redeploy. Vercel's default is Washington, D.C., which adds a trip across the Atlantic to every database query.
4. Redeploy. Until `DATABASE_URL`, `ADMIN_PASSWORD` and `SESSION_SECRET` exist, the page shows "backend is not configured".

Without `RESEND_API_KEY`, the alert falls back to Telegram if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. Changing `SESSION_SECRET` signs everyone out immediately. To look at the data in Supabase, open the Table Editor and switch the schema from `public` to `elsafqa_admin`.

**Local testing**

```bash
npm i -g vercel
vercel env pull .env.local     # or create .env.local with the variables above
vercel dev                     # open http://localhost:3000/login
```
