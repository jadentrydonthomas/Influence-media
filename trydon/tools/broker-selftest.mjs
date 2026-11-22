// Offline self-test for server/broker.js: signing + normalizers + read-only
// guarantee, against a mocked fetch. No network, no real credentials.
//   TRYDON_DATA_DIR=$(mktemp -d) node tools/broker-selftest.mjs
import assert from 'node:assert/strict';

process.env.WEBULL_APP_KEY = 'test-key';
process.env.WEBULL_APP_SECRET = 'test-secret';
process.env.SNAPTRADE_CLIENT_ID = 'TEST-CLIENT';
process.env.SNAPTRADE_CONSUMER_KEY = 'test-consumer';

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const u = new URL(url);
  const body = (() => {
    if (u.host === 'api.webull.com') {
      if (u.pathname === '/openapi/account/list') return [{ account_id: 'WB1' }];
      if (u.pathname === '/openapi/account/positions') return [{ symbol: 'iren', quantity: '40', cost_price: '12.5', last_price: '15', unrealized_profit_loss: '100' }];
      if (u.pathname === '/openapi/account/orders/history') return [{ client_order_id: 'c1', items: [{ symbol: 'ONDS', side: 'BUY', qty: '10', filled_qty: '10', limit_price: '2.1', status: 'FILLED', place_time: '2026-11-20T15:00:00Z' }] }];
    }
    if (u.host === 'api.snaptrade.com') {
      assert.ok(init.headers.Signature, 'snaptrade signature header');
      assert.ok(u.searchParams.get('timestamp'));
      if (u.pathname === '/accounts') return [{ id: 'RH1', institution_name: 'Robinhood' }];
      if (u.pathname === '/accounts/RH1/holdings') return {
        positions: [{ symbol: { symbol: { symbol: 'NVDA' } }, units: 3, price: 180, average_purchase_price: 150, open_pnl: 90 }],
        option_positions: [{ symbol: { option_symbol: { ticker: 'SPY 261219C00600000', option_type: 'CALL', strike_price: 600, expiration_date: '2026-12-19' } }, units: 2, price: 4.2, average_purchase_price: 3.1 }],
      };
      if (u.pathname === '/accounts/RH1/orders') return [{ brokerage_order_id: 'o1', universal_symbol: { symbol: 'NVDA' }, action: 'BUY', total_quantity: '3', filled_quantity: '3', execution_price: '150', status: 'EXECUTED', time_placed: '2026-11-21T14:30:00Z' }];
    }
    throw new Error('unexpected ' + url);
  })();
  return new Response(JSON.stringify(body), { status: 200 });
};

const b = await import('../server/broker.js');

// 1. Webull signature matches the official Python SDK (vector from tools run).
// Reference vectors: an independent Python port of the official Webull SDK signer,
// and the SnapTrade TS SDK's signing helpers run verbatim.
const expected = process.argv[2] || 'HpLK3BWCv+Ci+Usby7+/c+k6S+A=';
const { signature } = b.webullSignature({
  uri: '/openapi/account/positions', query: { account_id: 'ABC 12/3' }, host: 'api.webull.com',
  appKey: 'myKey', appSecret: 'mySecret', timestamp: '2026-11-22T21:00:00Z', nonce: 'nonce-123',
});
assert.equal(signature, expected, 'webull signature matches python sdk');

// 2. SnapTrade signature matches the TS SDK algorithm (vector passed as argv[3]).
{
  assert.equal(b.snaptradeSignature({ path: '/accounts', query: 'clientId=C&timestamp=1700000000', consumerKey: 'K' }), process.argv[3] || 'uOWcItnUFhvRHKOK7gQM0rux2sNFT/MRwa4uAKGDb/U=');
}

// 3. End-to-end through mocks.
const st = b.brokerStatus();
assert.deepEqual(st.providers, ['webull', 'snaptrade']);
const pos = await b.positions();
assert.equal(pos.connected, true);
const iren = pos.positions.find(p => p.sym === 'IREN');
assert.deepEqual([iren.broker, iren.shares, iren.cost, iren.last, iren.value], ['webull', 40, 12.5, 15, 600]);
const nvda = pos.positions.find(p => p.sym === 'NVDA');
assert.deepEqual([nvda.broker, nvda.shares, nvda.cost, nvda.pnl], ['robinhood', 3, 150, 90]);
const spy = pos.positions.find(p => p.kind === 'option');
assert.equal(spy.value, 2 * 4.2 * 100);
const ord = await b.orders();
assert.equal(ord.orders.length, 2);
assert.equal(ord.orders[0].id, 'o1'); // newest first

// 4. Read-only: every outbound call was a GET.
assert.ok(calls.length > 0);
for (const c of calls) assert.equal(c.init.method, 'GET', c.url);

// 5. Cache: a second call within TTL makes no new requests.
const n = calls.length;
await b.positions();
assert.equal(calls.length, n);

console.log(`broker self-test OK (${calls.length} mocked GETs, ${pos.positions.length} positions, ${ord.orders.length} orders)`);
