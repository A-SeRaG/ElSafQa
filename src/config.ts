// Central place for links. Override with env vars (see .env.example).
export const TELEGRAM_URL = import.meta.env.PUBLIC_TELEGRAM_URL ?? 'https://t.me/elsafqa';
export const TURNSTILE_SITEKEY = import.meta.env.PUBLIC_TURNSTILE_SITEKEY ?? '1x00000000000000000000AA'; // Cloudflare test key (always passes)
export const SITE_NAME = 'ElSafQa';
// Telegram support account shown in the Contact section.
// (The support email address lives server-side in functions/api/contact.js / SUPPORT_EMAIL.)
export const SUPPORT_TELEGRAM = 'TEAM_ElSafQa';
// Live gold relay (see /worker). Leave empty until deployed.
export const GOLD_WS_URL = import.meta.env.PUBLIC_GOLD_WS_URL ?? '';
// Channel links: slot 1 is the Scalp Channel. Slots 2-4 stay "Coming soon" until a URL is set.
export const CHANNEL_URLS = [
  TELEGRAM_URL,
  import.meta.env.PUBLIC_CHANNEL_2_URL ?? '',
  import.meta.env.PUBLIC_CHANNEL_3_URL ?? '',
  import.meta.env.PUBLIC_CHANNEL_4_URL ?? '',
];
