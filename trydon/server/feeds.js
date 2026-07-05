// Live data fetchers. Every feed is cached in SQLite (rate-limit friendly:
// page loads hit the cache, not the provider). On provider failure the last
// cached value is served with { stale: true } so the UI can tag it.
import { cacheGet, cacheSet } from './db.js';
import { completeText, hasKey } from './anthropic.js';

const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) trydon-deck/1.0' };
const MIN = 60_000;

async function cached(key, ttlMs, fetcher) {
  const hit = cacheGet(key, ttlMs);
  if (hit && !hit.stale) return { ...hit.value, fetchedAt: hit.fetchedAt };
  try {
    const fresh = await fetcher();
    cacheSet(key, fresh);
    return { ...fresh, fetchedAt: Date.now() };
  } catch (e) {
    if (hit) return { ...hit.value, fetchedAt: hit.fetchedAt, stale: true };
    return { error: String(e.message || e).slice(0, 200), sample: true };
  }
}

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

// ---- tiny RSS/Atom parser (titles, links, dates) ----
function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .trim();
}
export function parseFeed(xml, limit = 10) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
  for (const b of blocks.slice(0, limit * 2)) {
    const title = decodeEntities((b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
    let link = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1]
      || decodeEntities((b.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1] || '');
    const date = (b.match(/<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/) || [])[2] || '';
    if (title) items.push({ title, link: link.trim(), date });
    if (items.length >= limit) break;
  }
  return items;
}
export function relTime(dateStr) {
  const t = Date.parse(dateStr);
  if (!t) return 'new';
  const mins = Math.max(1, Math.round((Date.now() - t) / MIN));
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// ---- Yahoo Finance (no key needed) ----
const Y_RANGES = { '1D': ['1d', '5m'], '1W': ['5d', '30m'], '1M': ['1mo', '1d'], '1Y': ['1y', '1wk'] };

async function yahooChart(sym, range = '1M') {
  const [r, i] = Y_RANGES[range] || Y_RANGES['1M'];
  const j = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${r}&interval=${i}&includePrePost=false`
  );
  const res = j.chart?.result?.[0];
  if (!res) throw new Error('no chart data for ' + sym);
  const meta = res.meta || {};
  const closes = (res.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  return {
    sym,
    price: meta.regularMarketPrice,
    prevClose: meta.chartPreviousClose ?? meta.previousClose,
    currency: meta.currency,
    name: meta.shortName || meta.longName || sym,
    hi52: meta.fiftyTwoWeekHigh,
    lo52: meta.fiftyTwoWeekLow,
    volume: meta.regularMarketVolume,
    series: closes,
  };
}

const fmtVol = v => v == null ? null : v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v);

export function quote(sym) {
  return cached(`q:${sym}`, 2 * MIN, async () => {
    const c = await yahooChart(sym, '1D');
    const chg = c.prevClose ? ((c.price - c.prevClose) / c.prevClose) * 100 : 0;
    return {
      sym, price: c.price, chgN: +chg.toFixed(2), name: c.name,
      prevClose: c.prevClose, hi52: c.hi52, lo52: c.lo52, vol: fmtVol(c.volume),
    };
  });
}

export function candles(sym, range) {
  return cached(`c:${sym}:${range}`, range === '1D' ? 2 * MIN : 30 * MIN, async () => {
    const c = await yahooChart(sym, range);
    return { sym, range, series: c.series, price: c.price };
  });
}

// Google News items carry their publisher as a " - Publisher" title suffix;
// use it as the tag so a merged feed shows where each headline came from.
function splitPublisher(title, fallback = 'NEWS') {
  const m = /^(.*)\s+-\s+([^-]{2,40})$/.exec(title);
  if (!m) return { head: title, tag: fallback };
  return { head: m[1].trim(), tag: m[2].trim().toUpperCase().slice(0, 12) };
}

function dedupe(items, limit) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.head.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 42);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// Per-ticker news, merged from two independent sources (Yahoo Finance RSS +
// Google News, which itself aggregates many outlets), deduped by headline.
export function stockNews(sym) {
  return cached(`n:${sym}`, 30 * MIN, async () => {
    const collected = [];
    const results = await Promise.allSettled([
      getText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`),
      getText(`https://news.google.com/rss/search?q=${encodeURIComponent(sym + ' stock')}&hl=en-US&gl=US&ceid=US:en`),
    ]);
    if (results[0].status === 'fulfilled') {
      for (const x of parseFeed(results[0].value, 6)) {
        collected.push({ tag: 'YAHOO', time: relTime(x.date), head: x.title, url: x.link, t: Date.parse(x.date) || 0 });
      }
    }
    if (results[1].status === 'fulfilled') {
      for (const x of parseFeed(results[1].value, 6)) {
        const { head, tag } = splitPublisher(x.title);
        collected.push({ tag, time: relTime(x.date), head, url: x.link, t: Date.parse(x.date) || 0 });
      }
    }
    collected.sort((a, b) => b.t - a.t);
    const items = dedupe(collected, 5).map(({ t, ...rest }) => rest);
    if (!items.length) throw new Error('empty feed');
    return { sym, items };
  });
}

// ---- Steel: CME HRC futures via Yahoo (HRC=F). Scrap has no free feed —
// stays user-supplied/sample until a source is configured. ----
export function steel() {
  return cached('steel', 60 * MIN, async () => {
    const now = await yahooChart('HRC=F', '1D');
    const hist = await yahooChart('HRC=F', '1Y');
    const series = hist.series.slice(-12).map(v => Math.round(v));
    const prev = now.prevClose || series[series.length - 2] || now.price;
    const chg = prev ? ((now.price - prev) / prev) * 100 : 0;
    return {
      hrc: Math.round(now.price),
      hrcChg: +chg.toFixed(1),
      series,
      source: 'CME HRC futures (HRC=F)',
    };
  });
}

// Nucor company news from three angles: Google News on the company, Google
// News on the steel market, and Yahoo's NUE ticker feed — merged + deduped.
export function nucorNews() {
  return cached('nucornews', 60 * MIN, async () => {
    const collected = [];
    const results = await Promise.allSettled([
      getText('https://news.google.com/rss/search?q=Nucor&hl=en-US&gl=US&ceid=US:en'),
      getText('https://news.google.com/rss/search?q=%22steel%20prices%22%20OR%20%22HRC%22&hl=en-US&gl=US&ceid=US:en'),
      getText('https://feeds.finance.yahoo.com/rss/2.0/headline?s=NUE&region=US&lang=en-US'),
    ]);
    for (const [i, r] of results.entries()) {
      if (r.status !== 'fulfilled') continue;
      for (const x of parseFeed(r.value, 6)) {
        if (i === 2) {
          collected.push({ tag: 'YAHOO·NUE', time: relTime(x.date), head: x.title, url: x.link, t: Date.parse(x.date) || 0 });
        } else {
          const { head, tag } = splitPublisher(x.title, i === 1 ? 'STEEL MKT' : 'NUCOR');
          collected.push({ tag, time: relTime(x.date), head, url: x.link, t: Date.parse(x.date) || 0 });
        }
      }
    }
    collected.sort((a, b) => b.t - a.t);
    const items = dedupe(collected, 6).map(({ t, ...rest }) => rest);
    if (!items.length) throw new Error('empty feed');
    return { items };
  });
}

// ---- AI Signal: HN + arXiv + lab blogs, optionally ranked by Claude ----
const AI_SOURCES = [
  { tag: 'HN', kind: 'hn' },
  { tag: 'ARXIV', kind: 'rss', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { tag: 'ANTHROPIC', kind: 'rss', url: 'https://www.anthropic.com/rss.xml' },
  { tag: 'OPENAI', kind: 'rss', url: 'https://openai.com/blog/rss.xml' },
  { tag: 'DEEPMIND', kind: 'rss', url: 'https://deepmind.google/blog/rss.xml' },
];

async function collectAiItems() {
  const all = [];
  await Promise.allSettled(AI_SOURCES.map(async s => {
    if (s.kind === 'hn') {
      const j = await getJson(
        'https://hn.algolia.com/api/v1/search?query=AI%20OR%20LLM%20OR%20agents&tags=story&numericFilters=points%3E100&hitsPerPage=10'
      );
      for (const h of j.hits || []) {
        all.push({ tag: 'HN', time: relTime(h.created_at), head: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` });
      }
    } else {
      const xml = await getText(s.url);
      for (const x of parseFeed(xml, 5)) {
        all.push({ tag: s.tag, time: relTime(x.date), head: x.title, url: x.link });
      }
    }
  }));
  return all;
}

export function aiNewsRaw() {
  return cached('ainews_raw', 60 * MIN, async () => {
    const items = await collectAiItems();
    if (!items.length) throw new Error('no AI items');
    return { items };
  });
}

// Ranked + summarized (daily). Falls back to raw headlines without a key.
export function aiNewsRanked() {
  return cached('ainews_ranked', 12 * 60 * MIN, async () => {
    const raw = await aiNewsRaw();
    if (!raw.items?.length) throw new Error('no raw items');
    if (!hasKey()) return { items: raw.items.slice(0, 5), ranked: false };
    const listing = raw.items.map((x, i) => `${i}. [${x.tag}] ${x.head}`).join('\n');
    const txt = await completeText([{
      role: 'user',
      content: `You curate an AI-news feed for one person: a steel-industry worker learning AI agents, building side projects with Claude/Copilot, and investing. From the list below pick the 5 items that matter MOST to him (prefer: agent tooling, frontier-lab releases, practical building, big industry shifts; avoid academic minutiae). Rewrite each headline under 11 words, punchy.\nReply ONLY JSON: {"picks":[{"i":<index>,"head":"<rewritten>","why":"<4-6 words>"}]}\n\n${listing}`,
    }], { maxTokens: 600, fast: true });
    const m = txt.match(/\{[\s\S]*\}/);
    const picks = JSON.parse(m ? m[0] : txt).picks || [];
    const items = picks.map(p => {
      const src = raw.items[p.i] || {};
      return { tag: src.tag || 'AI', time: src.time || 'today', head: p.head || src.head, url: src.url, why: p.why };
    }).filter(x => x.head);
    if (!items.length) throw new Error('rank produced nothing');
    return { items, ranked: true };
  });
}

// ---- Media: public YouTube stats via API key (optional) ----
export function youtubeStats(channelRaw) {
  if (!process.env.YOUTUBE_API_KEY || !channelRaw) return Promise.resolve({ sample: true });
  let channel = String(channelRaw).trim();
  try {
    if (/^https?:/i.test(channel)) {
      channel = new URL(channel).pathname.split('/').filter(Boolean).pop() || channel;
    }
  } catch { /* keep as-is */ }
  return cached(`yt:${channel}`, 6 * 60 * MIN, async () => {
    const base = 'https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet';
    const key = `&key=${process.env.YOUTUBE_API_KEY}`;
    const sel = channel.startsWith('@') ? `&forHandle=${encodeURIComponent(channel)}`
      : channel.startsWith('UC') ? `&id=${channel}` : `&forUsername=${encodeURIComponent(channel)}`;
    const j = await getJson(base + sel + key);
    const it = j.items?.[0];
    if (!it) throw new Error('channel not found');
    return {
      title: it.snippet?.title,
      subs: +it.statistics?.subscriberCount || 0,
      views: +it.statistics?.viewCount || 0,
      videos: +it.statistics?.videoCount || 0,
    };
  });
}
