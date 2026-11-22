// Run: TRYDON_DATA_DIR=$(mktemp -d) node --test server/journal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realizedPL, createTrade, updateTrade, listTrades, deleteTrade } from './journal.js';

test('long winner: (exit-entry)*qty - fees', () => {
  assert.deepEqual(realizedPL({ side: 'long', qty: 100, entry_price: 10, exit_price: 12, fees: 2 }),
    { gross: 200, net: 198, pct: 19.8 });
});
test('short winner flips direction', () => {
  assert.equal(realizedPL({ side: 'short', qty: 50, entry_price: 20, exit_price: 18, fees: 0 }).net, 100);
});
test('options multiplier', () => {
  assert.equal(realizedPL({ side: 'long', qty: 2, multiplier: 100, entry_price: 1.5, exit_price: 1.0, fees: 1.3 }).net, -101.3);
});
test('open trade has no realized P/L', () => {
  assert.equal(realizedPL({ side: 'long', qty: 1, entry_price: 1, exit_price: null }), null);
});
test('CRUD + totals', () => {
  const a = createTrade({ sym: 'nue', qty: 10, entry_price: 150, exit_price: 160, fees: 1, tags: 'swing, #Steel' });
  const b = createTrade({ sym: 'HYLN', side: 'short', qty: 100, entry_price: 3, exit_price: 3.5 });
  const c = createTrade({ sym: 'MU', qty: 5, entry_price: 100 });
  assert.equal(a.sym, 'NUE'); assert.deepEqual(a.tags, ['swing', 'steel']); assert.equal(c.status, 'open');
  const { totals } = listTrades();
  assert.equal(totals.realized, 99 - 50); assert.equal(totals.closed, 2); assert.equal(totals.open, 1);
  assert.equal(totals.winRate, 50); assert.equal(totals.profitFactor, 1.98);
  const closed = updateTrade(c.id, { exit_price: 110 });
  assert.equal(closed.status, 'closed'); assert.ok(closed.exit_at); assert.equal(closed.pl.net, 50);
  const reopened = updateTrade(c.id, { exit_price: null });
  assert.equal(reopened.status, 'open'); assert.equal(reopened.exit_at, null);
  assert.equal(listTrades({ tag: 'steel' }).trades.length, 1);
  assert.throws(() => createTrade({ sym: 'X', qty: -1, entry_price: 1 }), /qty/);
  assert.ok(deleteTrade(b.id)); assert.equal(listTrades().trades.length, 2);
});
