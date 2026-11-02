// Central place for links. Override with env vars (see .env.example).
export const TELEGRAM_URL = import.meta.env.PUBLIC_TELEGRAM_URL ?? 'https://t.me/elsafqa';
export const TURNSTILE_SITEKEY = import.meta.env.PUBLIC_TURNSTILE_SITEKEY ?? '1x00000000000000000000AA'; // Cloudflare test key (always passes)
export const SITE_NAME = 'ElSafQa';
