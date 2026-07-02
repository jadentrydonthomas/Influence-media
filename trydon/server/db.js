// SQLite persistence (node:sqlite — zero external deps).
// One user: state is a set of versioned keys mirroring the frontend's
// localStorage["trydon.v2"] shape (each _PKEY is a row, plus custom/removed).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.TRYDON_DATA_DIR || join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'trydon.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  panel TEXT NOT NULL,
  provider TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  blob TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quote_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  hrc REAL,
  tons REAL,
  margin REAL,
  quote REAL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS files (
  name TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  schedule TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  last_run INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1
);
`);

// ---- state keys ----
const qGetAll = db.prepare('SELECT key, value, updated_at FROM state');
const qGetSince = db.prepare('SELECT key, value, updated_at FROM state WHERE updated_at > ?');
const qGetKey = db.prepare('SELECT value, updated_at FROM state WHERE key = ?');
const qPutKey = db.prepare(`INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);

export function getState(since = 0) {
  const rows = since ? qGetSince.all(since) : qGetAll.all();
  const keys = {};
  for (const r of rows) keys[r.key] = { v: JSON.parse(r.value), t: Number(r.updated_at) };
  return keys;
}

export function getKey(key, fallback = null) {
  const r = qGetKey.get(key);
  return r ? JSON.parse(r.value) : fallback;
}

export function putKeys(obj, ts = Date.now()) {
  const tx = db.exec.bind(db);
  tx('BEGIN');
  try {
    for (const [k, v] of Object.entries(obj)) qPutKey.run(k, JSON.stringify(v), ts);
    tx('COMMIT');
  } catch (e) {
    tx('ROLLBACK');
    throw e;
  }
  return ts;
}

export function getMeta(key, fallback = null) {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
export function setMeta(key, value) {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

// ---- cache ----
export function cacheGet(key, maxAgeMs) {
  const r = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(key);
  if (!r) return null;
  const stale = Date.now() - Number(r.fetched_at) > maxAgeMs;
  return { value: JSON.parse(r.value), fetchedAt: Number(r.fetched_at), stale };
}
export function cacheSet(key, value) {
  db.prepare(`INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`)
    .run(key, JSON.stringify(value), Date.now());
}

// ---- sources (the ⊕ system) ----
export function listSources() {
  return db.prepare('SELECT * FROM sources').all()
    .map(r => ({ ...r, config: JSON.parse(r.config) }));
}
export function saveSource({ id, panel, provider, config = {}, status = 'connected' }) {
  db.prepare(`INSERT INTO sources (id, panel, provider, config, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET panel = excluded.panel, provider = excluded.provider,
      config = excluded.config, status = excluded.status, updated_at = excluded.updated_at`)
    .run(id || panel, panel, provider, JSON.stringify(config), status, Date.now());
}

// ---- backups ----
export function makeBackup() {
  const blob = JSON.stringify(getState());
  db.prepare('INSERT INTO backups (created_at, blob) VALUES (?, ?)').run(Date.now(), blob);
  // keep 30 days
  db.prepare('DELETE FROM backups WHERE created_at < ?').run(Date.now() - 30 * 86400_000);
}
export function listBackups() {
  return db.prepare('SELECT id, created_at, length(blob) AS size FROM backups ORDER BY id DESC').all();
}
export function getBackup(id) {
  const r = db.prepare('SELECT blob FROM backups WHERE id = ?').get(id);
  return r ? JSON.parse(r.blob) : null;
}

// ---- sidecar files (image-slot state) ----
export function fileGet(name) {
  const r = db.prepare('SELECT content FROM files WHERE name = ?').get(name);
  return r ? r.content : null;
}
export function filePut(name, content) {
  db.prepare(`INSERT INTO files (name, content, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
    .run(name, content, Date.now());
}

// ---- quote history ----
export function addQuote({ hrc, tons, margin, quote, note = '' }) {
  db.prepare('INSERT INTO quote_history (ts, hrc, tons, margin, quote, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Date.now(), hrc, tons, margin, quote, note);
}
export function listQuotes(limit = 100) {
  return db.prepare('SELECT * FROM quote_history ORDER BY id DESC LIMIT ?').all(limit);
}
