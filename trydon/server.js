// TRYDON server — static frontend + state sync + agentic assistant + feeds.
// Zero external dependencies (Node >= 22.5: node:http + node:sqlite).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getState, putKeys, getKey, listSources, saveSource, addQuote, listQuotes, fileGet, filePut, listBackups, getBackup, wipeState, dataEpoch, getMeta, setMeta } from './server/db.js';
import { checkSession, checkCode, sessionCookie, accessCode } from './server/auth.js';
import { chat, debate } from './server/assistant.js';
import { analyzeNews } from './server/analyze.js';
import { completeText, hasKey } from './server/anthropic.js';
import * as feeds from './server/feeds.js';
import { startCron, morningBriefing, weeklyReview, learningDigest, eveningNudge, steelAlertCheck, suggestLearning, thesisWatch, ensureCalendarPlan } from './server/cron.js';
import { listAgents, runAgent, setAgent, addCustomAgent } from './server/agents.js';
import { brokerStatus, positions as brokerPositions } from './server/broker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8321);
const ASSET_MIME = JSON.parse(readFileSync(join(PUBLIC, 'asset-mime.json'), 'utf-8'));

// live device presence (in-memory; laptop↔phone "who's connected" indicator)
const presence = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(code, { 'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req, limitMb = 25) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limitMb * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function serveFile(res, path, extraHeaders = {}) {
  const ext = path.slice(path.lastIndexOf('.'));
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': statSync(path).size, ...extraHeaders });
  createReadStream(path).pipe(res);
}

const CACHE_LONG = { 'cache-control': 'public, max-age=86400' };
const NO_CACHE = { 'cache-control': 'no-cache' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const authed = checkSession(req.headers.cookie);

  try {
    // ---------- auth ----------
    if (path === '/api/login' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (checkCode(body.code)) {
        return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie() });
      }
      return send(res, 401, { error: 'wrong code' });
    }
    if (path === '/healthz') return send(res, 200, { ok: true, authRequired: !!accessCode() });

    // ---------- API (session required) ----------
    if (path.startsWith('/api/')) {
      if (!authed) return send(res, 401, { error: 'unauthorized' });

      if (path === '/api/presence' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (body.id) presence.set(body.id, { id: body.id, kind: body.kind || 'Device', label: body.label || 'Device', at: Date.now() });
        // prune anything not seen in 90s
        const cutoff = Date.now() - 90_000;
        for (const [k, v] of presence) if (v.at < cutoff) presence.delete(k);
        const devices = [...presence.values()].map(d => ({ kind: d.kind, label: d.label, secsAgo: Math.round((Date.now() - d.at) / 1000) }));
        return send(res, 200, { devices });
      }

      if (path === '/api/state' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0);
        return send(res, 200, { keys: getState(since), serverTime: Date.now(), llm: hasKey(), epoch: dataEpoch() });
      }
      if (path === '/api/state' && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!body.keys || typeof body.keys !== 'object') return send(res, 400, { error: 'keys required' });
        const t = putKeys(body.keys);
        return send(res, 200, { t });
      }
      if (path === '/api/export') {
        const keys = getState();
        const out = {};
        for (const [k, v] of Object.entries(keys)) out[k] = v.v;
        return send(res, 200, JSON.stringify(out, null, 1), {
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="trydon-export-${new Date().toISOString().slice(0, 10)}.json"`,
        });
      }
      if (path === '/api/import' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        // accepts either a raw key map or the localStorage blob {state, custom, removed}
        const keys = body.state ? { ...body.state, custom: body.custom || [], removed: body.removed || [] } : body;
        if (!keys || typeof keys !== 'object') return send(res, 400, { error: 'bad import' });
        putKeys(keys);
        return send(res, 200, { ok: true, imported: Object.keys(keys).length });
      }
      if (path === '/api/reset' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (body.confirm !== 'RESET') return send(res, 400, { error: 'send {"confirm":"RESET"}' });
        wipeState();
        return send(res, 200, { ok: true, note: 'state wiped; backup kept 30 days' });
      }
      if (path === '/api/backups') return send(res, 200, listBackups());
      if (path.startsWith('/api/backups/')) {
        const b = getBackup(Number(path.split('/')[3]));
        return b ? send(res, 200, b) : send(res, 404, { error: 'not found' });
      }

      if (path === '/api/assistant' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const snapshot = body.snapshot || { state: {}, custom: [], removed: [] };
        try {
          const out = body.mode === 'debate'
            ? await debate({ sym: body.sym, snapshot })
            : await chat({ text: body.text, messages: body.messages, snapshot, station: body.station });
          return send(res, 200, out);
        } catch (e) {
          if (e.code === 'NO_KEY') return send(res, 503, { error: 'no_key' });
          console.error('[assistant]', e);
          return send(res, 500, { error: String(e.message || e).slice(0, 300) });
        }
      }
      if (path === '/api/analyze/news' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        try {
          return send(res, 200, await analyzeNews(body));
        } catch (e) {
          if (e.code === 'NO_KEY') return send(res, 503, { error: 'no_key' });
          return send(res, 500, { error: String(e.message || e).slice(0, 200) });
        }
      }

      if (path === '/api/claude' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        try {
          const text = await completeText(body.messages || [], { maxTokens: body.maxTokens || 1024 });
          return send(res, 200, { text });
        } catch (e) {
          if (e.code === 'NO_KEY') return send(res, 503, { error: 'no_key' });
          return send(res, 500, { error: String(e.message || e).slice(0, 300) });
        }
      }

      // feeds (server-side cached)
      if (path === '/api/feeds/quote') return send(res, 200, await feeds.quote(url.searchParams.get('sym')));
      if (path === '/api/feeds/candles') return send(res, 200, await feeds.candles(url.searchParams.get('sym'), url.searchParams.get('range') || '1M'));
      if (path === '/api/feeds/stocknews') return send(res, 200, await feeds.stockNews(url.searchParams.get('sym')));
      if (path === '/api/feeds/steel') return send(res, 200, await feeds.steel());
      if (path === '/api/feeds/nucornews') return send(res, 200, await feeds.nucorNews());
      if (path === '/api/feeds/ainews') return send(res, 200, await feeds.aiNewsRanked());
      if (path === '/api/feeds/youtube') return send(res, 200, await feeds.youtubeStats(url.searchParams.get('channel') || process.env.YOUTUBE_CHANNEL || ''));

      if (path === '/api/sources' && req.method === 'GET') return send(res, 200, listSources());
      if (path === '/api/sources' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        saveSource(body);
        return send(res, 200, { ok: true });
      }

      if (path === '/api/quotes' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        addQuote(body);
        return send(res, 200, { ok: true });
      }
      if (path === '/api/quotes' && req.method === 'GET') return send(res, 200, listQuotes());

      if (path === '/api/learn/suggest' && req.method === 'POST') {
        try {
          return send(res, 200, { items: await suggestLearning() });
        } catch (e) {
          if (e.code === 'NO_KEY') return send(res, 503, { error: 'no_key' });
          return send(res, 500, { error: String(e.message || e).slice(0, 200) });
        }
      }

      // manual job trigger — preview a briefing/review on demand
      if (path === '/api/cron/run' && req.method === 'POST') {
        const job = url.searchParams.get('job');
        const jobs = { briefing: morningBriefing, weekly: weeklyReview, digest: learningDigest, nudge: eveningNudge, steel: steelAlertCheck, thesiswatch: thesisWatch, calplan: ensureCalendarPlan };
        if (!jobs[job]) return send(res, 400, { error: 'job must be one of ' + Object.keys(jobs).join('|') });
        await jobs[job]();
        return send(res, 200, { ok: true, ran: job });
      }

      // ---------- broker (Webull-ready adapter) ----------
      if (path === '/api/broker/status' && req.method === 'GET') {
        return send(res, 200, brokerStatus());
      }
      if (path === '/api/broker/positions' && req.method === 'GET') {
        return send(res, 200, await brokerPositions());
      }

      // ---------- autonomous desk agents ----------
      if (path === '/api/agents' && req.method === 'GET') {
        return send(res, 200, { agents: listAgents() });
      }
      if (path === '/api/agents' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        try {
          if (body.action === 'run' && body.id) {
            const out = await runAgent(body.id);
            return send(res, 200, { ok: true, ...out, agents: listAgents() });
          }
          if (body.action === 'toggle' && body.id) {
            setAgent(body.id, { enabled: !!body.enabled });
            return send(res, 200, { ok: true, agents: listAgents() });
          }
          if (body.action === 'create' && body.name && body.mission) {
            const id = addCustomAgent(body);
            return send(res, 200, { ok: true, id, agents: listAgents() });
          }
          return send(res, 400, { error: 'action must be run|toggle|create' });
        } catch (e) {
          if (e.code === 'NO_KEY') return send(res, 503, { error: 'no_key' });
          return send(res, 500, { error: String(e.message || e).slice(0, 200) });
        }
      }

      if (path.startsWith('/api/file/') && req.method === 'PUT') {
        const name = decodeURIComponent(path.slice('/api/file/'.length));
        if (!/^[.\w-]+\.state\.json$/.test(name)) return send(res, 400, { error: 'only *.state.json sidecars' });
        filePut(name, await readBody(req));
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }

    // ---------- image-slot sidecar (read) ----------
    if (path === '/.image-slots.state.json') {
      const content = authed ? fileGet('.image-slots.state.json') : null;
      if (!content) return send(res, 404, { error: 'none' });
      return send(res, 200, content, { 'content-type': 'application/json', ...NO_CACHE });
    }

    // ---------- static ----------
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    let file = path === '/' ? '/index.html' : normalize(path);
    if (file.includes('..')) return send(res, 400, 'bad path');

    // UUID assets keep their bundle names; mime comes from the manifest map
    const bare = file.slice(1);
    if (ASSET_MIME[bare]) {
      res.writeHead(200, { 'content-type': ASSET_MIME[bare], ...CACHE_LONG });
      return createReadStream(join(PUBLIC, bare)).pipe(res);
    }

    const full = join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !existsSync(full) || !statSync(full).isFile()) {
      return send(res, 404, 'not found');
    }
    if (file === '/index.html') {
      if (!authed) return serveFile(res, join(PUBLIC, 'login.html'), NO_CACHE);
      return serveFile(res, full, NO_CACHE);
    }
    const headers = file === '/sw.js' || file === '/trydon-bridge.js' ? NO_CACHE : CACHE_LONG;
    return serveFile(res, full, headers);
  } catch (e) {
    console.error('[server]', req.method, path, e);
    return send(res, 500, { error: 'internal error' });
  }
});

// One-time ground-zero migration: the pre-v2 data was trial data by the
// owner's decree — back it up (30-day undo) and clear it so the deck
// reboots with the real starting state. Runs exactly once per database.
if (!getMeta('groundzero_v3')) {
  if (Object.keys(getState()).length > 0) {
    wipeState();
    console.log('[migrate] ground-zero v3: trial data backed up and cleared');
  }
  setMeta('groundzero_v3', '1');
}

server.listen(PORT, () => {
  console.log(`TRYDON deck on http://localhost:${PORT}`);
  console.log(`  auth: ${accessCode() ? 'access code required' : 'OPEN (set TRYDON_ACCESS_CODE)'}`);
  console.log(`  assistant: ${hasKey() ? 'Anthropic key configured' : 'NO KEY (set ANTHROPIC_API_KEY) — chat falls back to local parsing'}`);
  startCron();
});
