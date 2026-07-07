// Broker adapter — the single seam where a real brokerage account plugs in.
// Webull Open API is the intended first provider: set WEBULL_APP_KEY and
// WEBULL_APP_SECRET (from developer.webull.com) in the environment, or
// connect through the charts ⊕ source chip, and wire the two fetchers below.
// Until then every consumer (advisor prompt, /api/broker/*, agents) gets an
// honest { connected: false } and falls back to the manually tracked
// holdings, so nothing in the app has to special-case "no broker yet".
import { listSources } from './db.js';

function webullCreds() {
  const key = process.env.WEBULL_APP_KEY || '';
  const secret = process.env.WEBULL_APP_SECRET || '';
  return key && secret ? { key, secret } : null;
}

export function brokerStatus() {
  const src = listSources().find(s => s.panel === 'charts' || s.panel === 'webull');
  const creds = webullCreds();
  return {
    connected: false, // flips true once the fetchers below are implemented against live creds
    provider: creds ? 'webull' : (src?.provider || null),
    credsPresent: !!creds,
    sourceConfigured: !!src,
    hint: creds
      ? 'Webull keys detected — positions/orders wiring is the next step.'
      : 'Add WEBULL_APP_KEY + WEBULL_APP_SECRET (developer.webull.com) or use the charts ⊕ chip; live positions, orders and account P/L will flow into the deck.',
  };
}

// Live positions from the broker. Shape mirrors the manual holdings state
// key ({sym, shares, cost, last}) so the UI and the advisor can consume
// either source without caring which one it is.
export async function positions() {
  const status = brokerStatus();
  if (!status.connected) return { ...status, positions: [] };
  // Webull Open API: POST /openapi/account/positions with signed headers.
  return { ...status, positions: [] };
}

// Recent orders — same contract: empty until the provider is wired.
export async function orders() {
  const status = brokerStatus();
  if (!status.connected) return { ...status, orders: [] };
  return { ...status, orders: [] };
}
