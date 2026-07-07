// Outbound seam — the first step toward autonomous applications.
// Set TRYDON_WEBHOOK_URL to any webhook (Zapier, Make, IFTTT, ntfy.sh,
// a Discord/Slack webhook…) and the deck's important moments — morning
// briefing, weekly review, steel alerts — get POSTed there as JSON, which
// those services can turn into email, SMS or push. When real email or
// other outbound actions land, they wire in here so every consumer
// (cron, agents, assistant) already speaks the same interface.
const hook = () => process.env.TRYDON_WEBHOOK_URL || '';

export const outboundConfigured = () => !!hook();

export async function notify(text, tag = 'trydon') {
  const url = hook();
  if (!url || !text) return false;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag, text: String(text).slice(0, 4000), at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    return true;
  } catch (e) {
    console.error('[outbound]', e.message);
    return false;
  }
}
