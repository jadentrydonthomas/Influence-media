// Trade journal — one row per round-trip trade, realized P/L computed on read.
//
// v1 assumptions (flagged so they're easy to revisit):
//  - One entry + one exit per row. Scaling in/out = log separate rows.
//  - `fees` is the TOTAL round-trip cost (commissions + regulatory), in $.
//  - `multiplier` covers contracts: 1 for shares, 100 for equity options.
//  - A trade is OPEN while exit_price is NULL; open trades carry no realized P/L.
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sym         TEXT    NOT NULL,
  side        TEXT    NOT NULL DEFAULT 'long' CHECK (side IN ('long','short')),
  qty         REAL    NOT NULL CHECK (qty > 0),
  multiplier  REAL    NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  entry_price REAL    NOT NULL CHECK (entry_price >= 0),
  entry_at    TEXT    NOT NULL,
  exit_price  REAL             CHECK (exit_price IS NULL OR exit_price >= 0),
  exit_at     TEXT,
  fees        REAL    NOT NULL DEFAULT 0 CHECK (fees >= 0),
  notes       TEXT    NOT NULL DEFAULT '',
  tags        TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_sym ON trades (sym);
CREATE INDEX IF NOT EXISTS trades_exit_at ON trades (exit_at);
`);

const round2 = n => Math.round(n * 100) / 100;

// ---- pure P/L math (exported for tests) ----
export function realizedPL(t) {
  if (t.exit_price == null) return null;
  const dir = t.side === 'short' ? -1 : 1;
  const mult = t.multiplier || 1;
  const gross = (t.exit_price - t.entry_price) * t.qty * mult * dir;
  const net = gross - (t.fees || 0);
  const basis = t.entry_price * t.qty * mult;
  return {
    gross: round2(gross),
    net: round2(net),
    pct: basis > 0 ? round2((net / basis) * 100) : null,
  };
}

export function summarize(trades) {
  const closed = trades.filter(t => t.status === 'closed');
  const wins = closed.filter(t => t.pl.net > 0);
  const losses = closed.filter(t => t.pl.net < 0);
  const sum = arr => arr.reduce((a, t) => a + t.pl.net, 0);
  const grossWin = sum(wins);
  const grossLoss = -sum(losses);
  return {
    realized: round2(sum(closed)),
    fees: round2(closed.reduce((a, t) => a + (t.fees || 0), 0)),
    closed: closed.length,
    open: trades.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? round2((wins.length / closed.length) * 100) : null,
    avgWin: wins.length ? round2(grossWin / wins.length) : null,
    avgLoss: losses.length ? round2(-grossLoss / losses.length) : null,
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : null,
    best: closed.length ? round2(Math.max(...closed.map(t => t.pl.net))) : null,
    worst: closed.length ? round2(Math.min(...closed.map(t => t.pl.net))) : null,
  };
}

function hydrate(r) {
  const t = { ...r, id: Number(r.id), tags: JSON.parse(r.tags || '[]') };
  t.status = t.exit_price == null ? 'open' : 'closed';
  t.pl = realizedPL(t);
  return t;
}

// ---- validation ----
class InputError extends Error { constructor(m) { super(m); this.code = 'BAD_INPUT'; } }

const num = (v, name, { required = false, min = 0, gt = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new InputError(`${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || (gt ? n <= min : n < min)) throw new InputError(`${name} must be a number ${gt ? '>' : '>='} ${min}`);
  return n;
};
const isoish = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (Number.isNaN(Date.parse(s))) throw new InputError(`${name} must be a date (YYYY-MM-DD or ISO)`);
  return s;
};
const normTags = v => {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return [...new Set(arr.map(x => String(x).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 12);
};

function clean(body, partial = false) {
  const out = {};
  const has = k => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('sym')) {
    const sym = String(body.sym || '').trim().toUpperCase();
    if (!/^[A-Z0-9.\-^=/ ]{1,24}$/.test(sym)) throw new InputError('sym is required (letters/digits)');
    out.sym = sym;
  }
  if (!partial || has('side')) {
    const side = String(body.side || 'long').toLowerCase();
    if (side !== 'long' && side !== 'short') throw new InputError("side must be 'long' or 'short'");
    out.side = side;
  }
  if (!partial || has('qty')) out.qty = num(body.qty, 'qty', { required: true, gt: true });
  if (!partial || has('multiplier')) out.multiplier = num(body.multiplier, 'multiplier', { gt: true }) ?? 1;
  if (!partial || has('entry_price')) out.entry_price = num(body.entry_price, 'entry_price', { required: true });
  if (!partial || has('entry_at')) out.entry_at = isoish(body.entry_at, 'entry_at') || new Date().toISOString().slice(0, 10);
  if (!partial || has('exit_price')) out.exit_price = num(body.exit_price, 'exit_price');
  if (!partial || has('exit_at')) out.exit_at = isoish(body.exit_at, 'exit_at');
  if (!partial || has('fees')) out.fees = num(body.fees, 'fees') ?? 0;
  if (!partial || has('notes')) out.notes = String(body.notes || '').slice(0, 4000);
  if (!partial || has('tags')) out.tags = JSON.stringify(normTags(body.tags));
  // closing a trade without a date stamps today
  if (out.exit_price != null && !out.exit_at && !(partial && has('exit_at'))) out.exit_at = new Date().toISOString().slice(0, 10);
  // reopening clears the exit date too
  if (has('exit_price') && out.exit_price == null) out.exit_at = null;
  return out;
}

// ---- queries ----
export function listTrades({ status, sym, tag, from, to } = {}) {
  const where = [], args = [];
  if (status === 'open') where.push('exit_price IS NULL');
  if (status === 'closed') where.push('exit_price IS NOT NULL');
  if (sym) { where.push('sym = ?'); args.push(String(sym).toUpperCase()); }
  if (from) { where.push('COALESCE(exit_at, entry_at) >= ?'); args.push(from); }
  if (to) { where.push('COALESCE(exit_at, entry_at) <= ?'); args.push(to); }
  const sql = `SELECT * FROM trades ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (exit_price IS NULL) DESC, COALESCE(exit_at, entry_at) DESC, id DESC`;
  let trades = db.prepare(sql).all(...args).map(hydrate);
  if (tag) { const tg = String(tag).toLowerCase(); trades = trades.filter(t => t.tags.includes(tg)); }
  return { trades, totals: summarize(trades) };
}

export function getTrade(id) {
  const r = db.prepare('SELECT * FROM trades WHERE id = ?').get(Number(id));
  return r ? hydrate(r) : null;
}

function checkDates(t) {
  if (t.exit_at && t.entry_at && Date.parse(t.exit_at) < Date.parse(t.entry_at)) throw new InputError('exit_at is before entry_at');
}

export function createTrade(body) {
  const t = clean(body || {});
  checkDates(t);
  const now = Date.now();
  const res = db.prepare(`INSERT INTO trades
    (sym, side, qty, multiplier, entry_price, entry_at, exit_price, exit_at, fees, notes, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.sym, t.side, t.qty, t.multiplier, t.entry_price, t.entry_at, t.exit_price, t.exit_at, t.fees, t.notes, t.tags, now, now);
  return getTrade(res.lastInsertRowid);
}

export function updateTrade(id, body) {
  if (!getTrade(id)) return null;
  const t = clean(body || {}, true);
  checkDates({ ...getTrade(id), ...t });
  const keys = Object.keys(t);
  if (!keys.length) return getTrade(id);
  db.prepare(`UPDATE trades SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map(k => t[k]), Date.now(), Number(id));
  return getTrade(id);
}

export function deleteTrade(id) {
  return db.prepare('DELETE FROM trades WHERE id = ?').run(Number(id)).changes > 0;
}
