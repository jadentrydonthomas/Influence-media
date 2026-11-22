// Broker adapter: the single seam where real brokerage accounts plug in.
// READ-ONLY by construction: every outbound call goes through brokerGet(),
// which only issues GET requests. No order placement, cancel or replace code
// exists here, and none should be added.
//
// Two providers, each switched on purely by environment variables (set them
// in the Render dashboard, never in the repo):
//
//   webull     Webull US OpenAPI, direct.            WEBULL_APP_KEY, WEBULL_APP_SECRET
//              optional: WEBULL_ACCOUNT_ID (skip the account lookup),
//                        WEBULL_API_HOST (default api.webull.com)
//
//   snaptrade  SnapTrade aggregator (personal API key). Robinhood has no
//              official equities API, so this is the supported read-only
//              route for it. It can also carry Webull if the direct API is
//              not approved for the account.
//                                                   SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY
//              optional: SNAPTRADE_USER_ID + SNAPTRADE_USER_SECRET (commercial
//                        key mode instead of personal key mode)
//
// Every consumer (advisor prompt, /api/broker/*, agents) gets the same
// normalized shapes regardless of provider, and an honest { connected: false }
// with empty lists when nothing is configured, so the manual holdings keep
// working as the fallback.
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { cacheGet, cacheSet } from './db.js';

const TTL_MS = 60_000;          // positions/orders cache; keeps us well under rate limits
const TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
function webullCreds() {
  const key = process.env.WEBULL_APP_KEY || '';
  const secret = process.env.WEBULL_APP_SECRET || '';
  if (!key || !secret) return null;
  return {
    key, secret,
    host: process.env.WEBULL_API_HOST || 'api.webull.com',
    accountId: process.env.WEBULL_ACCOUNT_ID || '',
  };
}

function snaptradeCreds() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID || '';
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';
  if (!clientId || !consumerKey) return null;
  return {
    clientId, consumerKey,
    userId: process.env.SNAPTRADE_USER_ID || '',
    userSecret: process.env.SNAPTRADE_USER_SECRET || '',
    base: process.env.SNAPTRADE_API_BASE || 'https://api.snaptrade.com',
  };
}

function configured() {
  const out = [];
  if (webullCreds()) out.push('webull');
  if (snaptradeCreds()) out.push('snaptrade');
  return out;
}

// ---------------------------------------------------------------------------
// the only HTTP path out of this module: GET only
// ---------------------------------------------------------------------------
async function brokerGet(url, headers) {
  const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await r.text();
  if (!r.ok) {
    // Never echo request headers or query (they carry signatures / client ids).
    const path = new URL(url).pathname;
    throw new Error(`${r.status} ${path}: ${text.slice(0, 160)}`);
  }
  return text ? JSON.parse(text) : null;
}

const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');

// ---------------------------------------------------------------------------
// Webull OpenAPI signing, ported from the official webull-python-sdk-core
// (auth/composer/default_signature_composer.py, v0.1.18):
//   1. sign params = { x-app-key, x-timestamp, x-signature-version,
//      x-signature-algorithm, x-signature-nonce, host } (keys lowercased),
//      merged with the query params (raw, unencoded values).
//   2. string = uri + "&" + sorted "k=v" pairs joined by "&"
//      [+ "&" + UPPER(md5(compact JSON body)) when there is a body]
//   3. percent-encode the whole string (Python quote(safe=''))
//   4. signature = base64(HMAC-SHA1(secret + "&", encoded string))
// ---------------------------------------------------------------------------
function pyQuote(s) {
  // Python urllib.parse.quote(s, safe='') leaves only A-Z a-z 0-9 - . _ ~
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function webullSignature({ uri, query = {}, body = null, host, appKey, appSecret, timestamp, nonce }) {
  const headers = {
    'x-app-key': appKey,
    'x-timestamp': timestamp,
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
  };
  const params = { ...headers, host };
  for (const [k, v] of Object.entries(query)) {
    params[k] = params[k] !== undefined ? `${params[k]}&${v}` : String(v);
  }
  let s = uri + '&' + Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  if (body != null) s += '&' + createHash('md5').update(JSON.stringify(body)).digest('hex').toUpperCase();
  const signature = createHmac('sha1', appSecret + '&').update(pyQuote(s)).digest('base64');
  return { headers: { ...headers, 'x-signature': signature, 'x-version': 'v1' }, signature };
}

async function webullGet(creds, uri, query = {}) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); // %Y-%m-%dT%H:%M:%SZ
  const { headers } = webullSignature({
    uri, query, host: creds.host, appKey: creds.key, appSecret: creds.secret,
    timestamp, nonce: randomUUID(),
  });
  const qs = new URLSearchParams(query).toString();
  const json = await brokerGet(`https://${creds.host}${uri}${qs ? '?' + qs : ''}`, headers);
  // GUESS: some Webull responses wrap payloads as { data: ... }; unwrap if so.
  return json && typeof json === 'object' && !Array.isArray(json) && 'data' in json ? json.data : json;
}

async function webullAccountIds(creds) {
  if (creds.accountId) return creds.accountId.split(',').map(s => s.trim()).filter(Boolean);
  const list = await webullGet(creds, '/openapi/account/list');
  const rows = Array.isArray(list) ? list : (list?.accounts || list?.items || []);
  // GUESS: field name of the account id in /openapi/account/list.
  return rows.map(a => first(a.account_id, a.accountId, a.id)).filter(Boolean).map(String);
}

// GUESS (all field names below): the SDK defines requests, not response
// schemas, and developer.webull.com was unreachable from the build sandbox.
// The pickers accept the likely spellings; verify against one live response.
export function normalizeWebullPosition(p, accountId) {
  const sym = first(p.symbol, p.ticker?.symbol, p.instrument?.symbol, p.items?.[0]?.symbol);
  const shares = num(first(p.quantity, p.qty, p.position, p.total_quantity));
  const cost = num(first(p.cost_price, p.unit_cost, p.avg_price, p.average_price, p.cost_basis_price));
  const last = num(first(p.last_price, p.market_price, p.price, p.current_price));
  const value = num(first(p.market_value, p.marketValue)) ?? (shares != null && last != null ? shares * last : null);
  const pnl = num(first(p.unrealized_profit_loss, p.unrealized_pnl, p.unrealizedProfitLoss));
  return {
    broker: 'webull', account: accountId, kind: first(p.instrument_type, p.asset_type, 'stock').toString().toLowerCase(),
    sym: sym ? String(sym).toUpperCase() : null, shares, cost, last, value, pnl,
  };
}

export function normalizeWebullOrder(o, accountId) {
  const leg = o.items?.[0] || o.orders?.[0] || o;
  return {
    broker: 'webull', account: accountId,
    id: first(o.client_order_id, o.order_id, leg.client_order_id, leg.order_id),
    sym: first(leg.symbol, leg.ticker?.symbol, o.symbol) ?? null,
    side: first(leg.side, o.side) ?? null,
    type: first(leg.order_type, o.order_type) ?? null,
    qty: num(first(leg.qty, leg.quantity, leg.total_quantity)),
    filled: num(first(leg.filled_qty, leg.filled_quantity)),
    price: num(first(leg.limit_price, leg.filled_price, leg.avg_filled_price)),
    status: first(leg.status, leg.order_status, o.status) ?? null,
    placedAt: first(leg.place_time, leg.create_time, o.create_time, o.place_time) ?? null,
  };
}

async function webullPositions(creds) {
  const out = [];
  for (const id of await webullAccountIds(creds)) {
    const res = await webullGet(creds, '/openapi/account/positions', { account_id: id });
    const rows = Array.isArray(res) ? res : (res?.holdings || res?.positions || res?.items || []);
    for (const p of rows) out.push(normalizeWebullPosition(p, id));
  }
  return out;
}

async function webullOrders(creds) {
  const out = [];
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 864e5);
  const day = d => d.toISOString().slice(0, 10);
  for (const id of await webullAccountIds(creds)) {
    const res = await webullGet(creds, '/openapi/account/orders/history', {
      account_id: id, page_size: '50', start_date: day(start), end_date: day(end),
    });
    const rows = Array.isArray(res) ? res : (res?.orders || res?.items || []);
    for (const o of rows) out.push(normalizeWebullOrder(o, id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// SnapTrade signing, ported from snaptrade-typescript-sdk v13.4.8:
//   query carries clientId + timestamp (unix seconds) [+ userId, userSecret]
//   Signature header = base64(HMAC-SHA256(encodeURI(consumerKey),
//                       JSON with sorted keys {content, path, query}))
// ---------------------------------------------------------------------------
function sortedJson(obj) {
  const keys = new Set();
  JSON.stringify(obj, (k, v) => { keys.add(k); return v; });
  return JSON.stringify(obj, [...keys].sort());
}

export function snaptradeSignature({ path, query, consumerKey, content = null }) {
  const payload = sortedJson({ content, path, query });
  return createHmac('sha256', encodeURI(consumerKey)).update(payload).digest('base64');
}

async function snaptradeGet(creds, path, extra = {}) {
  const q = { clientId: creds.clientId };
  if (creds.userId && creds.userSecret) { q.userId = creds.userId; q.userSecret = creds.userSecret; }
  Object.assign(q, extra);
  q.timestamp = Math.round(Date.now() / 1000).toString();
  const query = new URLSearchParams(q).toString();
  const sig = snaptradeSignature({ path, query, consumerKey: creds.consumerKey });
  return brokerGet(`${creds.base}${path}?${query}`, { Signature: sig, accept: 'application/json' });
}

const brokerName = acct => String(first(acct?.institution_name, 'snaptrade')).toLowerCase();

export function normalizeSnapPosition(p, acct) {
  const shares = num(p.units ?? p.fractional_units);
  const last = num(p.price);
  return {
    broker: brokerName(acct), account: acct?.id, via: 'snaptrade', kind: 'stock',
    sym: first(p.symbol?.symbol?.symbol, p.symbol?.symbol?.raw_symbol) ?? null,
    shares, cost: num(p.average_purchase_price), last,
    value: shares != null && last != null ? shares * last : null,
    pnl: num(p.open_pnl),
  };
}

export function normalizeSnapOption(p, acct) {
  const os = p.symbol?.option_symbol || {};
  const contracts = num(p.units);
  const last = num(p.price);
  return {
    broker: brokerName(acct), account: acct?.id, via: 'snaptrade', kind: 'option',
    sym: first(os.ticker, os.underlying_symbol?.symbol) ?? null,
    option: { type: os.option_type ?? null, strike: num(os.strike_price), expiry: os.expiration_date ?? null },
    shares: contracts,
    // GUESS: SnapTrade reports option price and average_purchase_price per
    // share, so a contract is x100. Verify against Robinhood's own P/L once live.
    cost: num(p.average_purchase_price), last,
    value: contracts != null && last != null ? contracts * last * 100 : null,
    pnl: null,
  };
}

export function normalizeSnapOrder(o, acct) {
  return {
    broker: brokerName(acct), account: acct?.id, via: 'snaptrade',
    id: o.brokerage_order_id ?? null,
    sym: first(o.universal_symbol?.symbol, o.option_symbol?.ticker) ?? null,
    side: o.action ?? null, type: o.order_type ?? null,
    qty: num(o.total_quantity), filled: num(o.filled_quantity),
    price: num(first(o.execution_price, o.limit_price, o.stop_price)),
    status: o.status ?? null, placedAt: o.time_placed ?? null,
  };
}

async function snaptradeAccounts(creds) {
  const list = await snaptradeGet(creds, '/accounts');
  return Array.isArray(list) ? list : [];
}

async function snaptradePositions(creds) {
  const out = [];
  for (const acct of await snaptradeAccounts(creds)) {
    const h = await snaptradeGet(creds, `/accounts/${encodeURIComponent(acct.id)}/holdings`);
    for (const p of h?.positions || []) out.push(normalizeSnapPosition(p, acct));
    for (const p of h?.option_positions || []) out.push(normalizeSnapOption(p, acct));
  }
  return out;
}

async function snaptradeOrders(creds) {
  const out = [];
  for (const acct of await snaptradeAccounts(creds)) {
    const rows = await snaptradeGet(creds, `/accounts/${encodeURIComponent(acct.id)}/orders`, { state: 'all', days: '30' });
    for (const o of Array.isArray(rows) ? rows : []) out.push(normalizeSnapOrder(o, acct));
  }
  return out;
}

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------
const FETCHERS = {
  webull: { creds: webullCreds, positions: webullPositions, orders: webullOrders },
  snaptrade: { creds: snaptradeCreds, positions: snaptradePositions, orders: snaptradeOrders },
};

// Cached per provider; on failure serve the last good copy tagged stale.
async function collect(kind) {
  const results = await Promise.all(configured().map(async name => {
    const key = `broker:${name}:${kind}`;
    const hit = cacheGet(key, TTL_MS);
    if (hit && !hit.stale) return { name, rows: hit.value, fetchedAt: hit.fetchedAt };
    try {
      const rows = await FETCHERS[name][kind](FETCHERS[name].creds());
      cacheSet(key, rows);
      cacheSet(`broker:${name}:health`, { ok: true, at: Date.now() });
      return { name, rows, fetchedAt: Date.now() };
    } catch (e) {
      const error = String(e.message || e).slice(0, 240);
      cacheSet(`broker:${name}:health`, { ok: false, error, at: Date.now() });
      if (hit) return { name, rows: hit.value, fetchedAt: hit.fetchedAt, stale: true, error };
      return { name, rows: [], error };
    }
  }));
  const rows = results.flatMap(r => r.rows);
  const providers = Object.fromEntries(results.map(r => [r.name, {
    ok: !r.error, count: r.rows.length, fetchedAt: r.fetchedAt ?? null,
    ...(r.stale ? { stale: true } : {}), ...(r.error ? { error: r.error } : {}),
  }]));
  return { rows, providers };
}

export function brokerStatus() {
  const providers = configured();
  const health = Object.fromEntries(providers.map(p => [p, cacheGet(`broker:${p}:health`, Infinity)?.value || null]));
  const anyOk = providers.some(p => health[p]?.ok);
  return {
    // connected = at least one provider configured and its last call succeeded
    // (or it has not been called yet: we optimistically report configured).
    connected: providers.length > 0 && (anyOk || providers.every(p => !health[p])),
    readOnly: true,
    providers,
    provider: providers[0] || null,   // back-compat with the old single-provider field
    credsPresent: providers.length > 0,
    health,
    hint: providers.length
      ? `Linked: ${providers.join(' + ')} (read-only).`
      : 'Set WEBULL_APP_KEY + WEBULL_APP_SECRET (Webull OpenAPI) and/or SNAPTRADE_CLIENT_ID + SNAPTRADE_CONSUMER_KEY (Robinhood via SnapTrade) in the Render dashboard.',
  };
}

// Positions keep the manual-holdings keys ({sym, shares, cost, last}) and add
// broker/account/kind/value/pnl, so the UI and advisor can use either source.
export async function positions() {
  const status = brokerStatus();
  if (!status.credsPresent) return { ...status, positions: [] };
  const { rows, providers } = await collect('positions');
  return { ...status, connected: Object.values(providers).some(p => p.ok || p.stale), sources: providers, positions: rows };
}

export async function orders() {
  const status = brokerStatus();
  if (!status.credsPresent) return { ...status, orders: [] };
  const { rows, providers } = await collect('orders');
  rows.sort((a, b) => String(b.placedAt || '').localeCompare(String(a.placedAt || '')));
  return { ...status, connected: Object.values(providers).some(p => p.ok || p.stale), sources: providers, orders: rows };
}
