const cron = require('node-cron');
const env = require('../config/env');

/**
 * In-process ping every 14 minutes. Only runs while the web process is awake;
 * on Render free tier, also add a Render Cron Job that runs scripts/keep-alive-ping.js.
 */
async function pingKeepAlive() {
  const url = env.keepAlive.url;
  if (!url) {
    return;
  }
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(25_000) });
    // eslint-disable-next-line no-console
    console.log(`[keep-alive] ${res.status} ${url}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[keep-alive] ping failed:', err.message || err);
  }
}

function startRenderKeepAliveJob() {
  if (!env.keepAlive.url || !env.keepAlive.enabled) {
    return;
  }

  cron.schedule('*/14 * * * *', () => {
    pingKeepAlive().catch(() => {});
  });

  // eslint-disable-next-line no-console
  console.log(`[keep-alive] scheduled every 14 min → ${env.keepAlive.url}`);
}

module.exports = { startRenderKeepAliveJob, pingKeepAlive };
