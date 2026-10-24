/**
 * Ping the public /health URL. Run on a schedule from Render Cron (every 14 min)
 * so the free-tier web service does not spin down from inactivity.
 *
 * Env: KEEP_ALIVE_URL (full URL, e.g. https://api.workzenapps.in/health)
 *   or PUBLIC_API_URL (base, /health is appended).
 */
require('dotenv').config();

function resolveUrl() {
  const explicit = process.env.KEEP_ALIVE_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (base) return `${base}/health`;
  return '';
}

async function main() {
  const url = resolveUrl();
  if (!url) {
    console.error('Set KEEP_ALIVE_URL or PUBLIC_API_URL');
    process.exit(1);
  }

  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(25_000) });
  const body = await res.text();
  console.log(`[keep-alive] ${res.status} ${url} ${body.slice(0, 120)}`);
  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[keep-alive] failed:', err.message || err);
  process.exit(1);
});
