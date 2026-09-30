#!/usr/bin/env node
/* Refreshes the price history embedded in "AI Ecosystem Atlas.html".
 *
 * For every listed company and ETF in the Atlas it downloads five years of
 * weekly adjusted closes (plus the latest close) and rewrites PRICE_SERIES,
 * PRICE_SERIES_ASOF and PRICE_CCY inside the HTML, so the numbers are current
 * wherever the file is opened — no API key, no live connection needed.
 *
 * Runs in GitHub Actions (.github/workflows/atlas-prices.yml).
 *   node atlas/tools/refresh-prices.mjs
 *
 * Requests go through a real Chrome browser: Yahoo throttles plain scripted
 * HTTP clients from cloud servers but serves a normal browser. Every request
 * has a hard timeout, the run stops early if the host refuses everything, and
 * it keeps whatever it has once its time budget is spent.
 *
 * Environment:
 *   ATLAS_CHROME_CHANNEL  browser channel ("chrome" on GitHub runners). Unset =
 *                         the Playwright-bundled Chromium.
 *   ATLAS_SYMBOLS_FROM    "manifest" to skip reading the app and use
 *                         atlas/data/price-symbols.json.
 *   ATLAS_FETCH           "node" to download with Node's fetch instead of Chrome.
 *   YAHOO_BASE            override the data host (used by the offline test).
 *   PRICE_GAP_MS          pause between requests (default 250).
 *   PRICE_BUDGET_MIN      minutes to spend downloading before keeping what it has (default 25).
 *   PRICE_TIMEOUT_MS      per-request timeout (default 20000).
 *   ATLAS_HTML, ATLAS_DATA_DIR  point the run at a scratch copy (offline test).
 */
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";

const ATLAS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = process.env.ATLAS_HTML || path.join(ATLAS, "AI Ecosystem Atlas.html");
const DATA_DIR = process.env.ATLAS_DATA_DIR || path.join(ATLAS, "data");
const MANIFEST = path.join(DATA_DIR, "price-symbols.json");
const REPORT = path.join(DATA_DIR, "price-report.json");
const DEFAULT_BASE = "https://query1.finance.yahoo.com";
const BASE = process.env.YAHOO_BASE || DEFAULT_BASE;
const GAP_MS = Number(process.env.PRICE_GAP_MS ?? 250);
const BUDGET_MS = Number(process.env.PRICE_BUDGET_MIN || 25) * 60000;
const REQUEST_TIMEOUT_MS = Number(process.env.PRICE_TIMEOUT_MS || 20000);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/* TradingView exchange prefix -> Yahoo Finance suffixes, most likely first. */
const SUFFIX = {
  KRX: [".KS", ".KQ"], TWSE: [".TW", ".TWO"], TPEX: [".TWO"], TSE: [".T"],
  SSE: [".SS"], SZSE: [".SZ"], LSE: [".L"], XETR: [".DE"], FWB: [".F"],
  EURONEXT: [".PA", ".AS", ".BR", ".LS", ".IR"], SIX: [".SW"], TSX: [".TO"],
  TSXV: [".V"], ASX: [".AX"], NSE: [".NS"], BSE: [".BO"], BMFBOVESPA: [".SA"],
  MIL: [".MI"], OMXCOP: [".CO"], OMXSTO: [".ST"], OMXHEX: [".HE"], OSL: [".OL"],
  SGX: [".SI"], KLSE: [".KL"], JSE: [".JO"], TADAWUL: [".SR"], BME: [".MC"],
  TASE: [".TA"], SET: [".BK"], BMV: [".MX"], BCS: [".SN"], BVL: [".LM"],
};
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "NYSEAMERICAN", "AMEX", "NYSEARCA", "OTC", "CBOE", "BATS"]);

export function yahooCandidates(tv, key) {
  const [ex, raw] = String(tv).includes(":") ? String(tv).split(":") : ["", String(tv)];
  const sym = (raw || key || "").trim();
  if (!ex || US_EXCHANGES.has(ex)) return [sym.replace(/[._]/g, "-")];
  if (ex === "HKEX") {
    const code = (/^\d+$/.test(key || "") ? key : sym).replace(/^0+/, "");
    return [code.padStart(4, "0") + ".HK"];
  }
  // LSE:BT.A -> BT-A.L, LSE:RR. -> RR.L, OMXSTO:ERIC_B -> ERIC-B.ST
  const base = sym.replace(/\.$/, "").replace(/_/g, "-").replace(/\.(?=[A-Z]$)/, "-");
  return (SUFFIX[ex] || [""]).map((s) => base + s);
}

/* Exchanges that quote in minor units: London in pence, Johannesburg in cents,
   Tel Aviv in agorot. Store major units so every price reads naturally. */
const MINOR_UNITS = {GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS"};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => (v >= 1000 ? Math.round(v) : v >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);
const firstLine = (e) => String(e?.message || e).split("\n")[0];

/* ---------- browser ---------- */
async function openBrowser() {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require("playwright-core"); } catch { pw = require("playwright"); }
  const channel = process.env.ATLAS_CHROME_CHANNEL;
  const browser = await pw.chromium.launch({...(channel ? {channel} : {}), timeout: 60000});
  const context = await browser.newContext({userAgent: UA, locale: "en-US", viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  page.setDefaultTimeout(REQUEST_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(REQUEST_TIMEOUT_MS);
  return {browser, page};
}

/* ---------- which symbols to refresh ---------- */
async function symbolsFromApp(page) {
  await page.goto(pathToFileURL(HTML).href, {waitUntil: "load", timeout: 60000});
  await page.waitForFunction(() => typeof allNodes !== "undefined" && allNodes.length > 0, null, {timeout: 30000});
  return page.evaluate(() => {
    const out = new Map();
    allNodes
      .filter((n) => n.kind === "company" && n.status !== "Private" && n.ticker)
      .forEach((n) => { if (!out.has(n.ticker)) out.set(n.ticker, {key: n.ticker, tv: chartSymbol(n), kind: "company", name: n.name}); });
    ETFS.forEach((e) => { if (e.n && !out.has(e.n)) out.set(e.n, {key: e.n, tv: e.n, kind: "etf", name: e.full || e.n}); });
    return [...out.values()];
  });
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")).symbols || []; } catch { return []; }
}

async function loadSymbols(page) {
  const known = new Map(readManifest().map((s) => [s.key, s]));
  if (page && process.env.ATLAS_SYMBOLS_FROM !== "manifest") {
    try {
      const fromApp = await symbolsFromApp(page);
      console.log(`Read ${fromApp.length} symbols from the app.`);
      // Keep the Yahoo symbol that worked last time so the next run tries it first.
      return fromApp.map((s) => ({...s, yahoo: known.get(s.key)?.tv === s.tv ? known.get(s.key).yahoo : undefined}));
    } catch (e) {
      console.warn(`Could not read symbols from the app (${firstLine(e)}); using the manifest.`);
    }
  }
  const list = [...known.values()];
  if (!list.length) throw new Error("No symbols: the app could not be read and atlas/data/price-symbols.json is empty.");
  console.log(`Using ${list.length} symbols from the manifest.`);
  return list;
}

/* ---------- download ---------- */
/* A transport returns {status, text}; status 0 means timeout or network failure. */
function browserTransport(page) {
  return async (url) => {
    try {
      const resp = await page.goto(url, {waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS});
      if (!resp) return {status: 0, error: "no response"};
      const status = resp.status();
      return {status, text: status === 200 ? await resp.text() : ""};
    } catch (e) {
      return {status: 0, error: firstLine(e)};
    }
  };
}

function nodeTransport() {
  return async (url) => {
    try {
      const res = await fetch(url, {headers: {"User-Agent": UA, Accept: "application/json"}, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
      return {status: res.status, text: res.ok ? await res.text() : ""};
    } catch (e) {
      return {status: 0, error: e.name === "TimeoutError" ? "timeout" : firstLine(e)};
    }
  };
}

function parseChart(body) {
  const r = body?.chart?.result?.[0];
  if (!r?.timestamp?.length) return null;
  const vals = r.indicators?.adjclose?.[0]?.adjclose || r.indicators?.quote?.[0]?.close;
  if (!vals) return null;
  const m = r.meta || {};
  const minor = MINOR_UNITS[m.currency];
  const scale = minor ? 0.01 : 1;
  const pts = [];
  r.timestamp.forEach((t, i) => { const v = vals[i]; if (Number.isFinite(v) && v > 0) pts.push([t, round(v * scale)]); });
  if (pts.length < 2) return null;
  // End the series at the actual latest close rather than the current week's Monday.
  const last = pts[pts.length - 1];
  if (Number.isFinite(m.regularMarketPrice) && m.regularMarketPrice > 0 && Number.isFinite(m.regularMarketTime) && m.regularMarketTime >= last[0]) {
    const latest = round(m.regularMarketPrice * scale);
    if (m.regularMarketTime - last[0] < 7 * 86400) { last[0] = m.regularMarketTime; last[1] = latest; }
    else pts.push([m.regularMarketTime, latest]);
  }
  return {pts, currency: minor || m.currency || "USD", marketTime: m.regularMarketTime || last[0]};
}

/* -> {pts,...} on success, {miss} when the symbol has no data, {blocked,status} when the host refuses. */
async function fetchChart(get, yahoo) {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(yahoo)}?range=5y&interval=1wk&includeAdjustedClose=true&events=div%2Csplit`;
  let last = {status: 0};
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await get(url);
    last = r;
    if (r.status === 200) {
      let body;
      try { body = JSON.parse(r.text); } catch { return {miss: true, status: "unreadable"}; }
      return parseChart(body) || {miss: true, status: "empty"};
    }
    if (r.status === 404 || r.status === 400) return {miss: true, status: r.status};
    if (r.status === 401 || r.status === 403) return {blocked: true, status: r.status};
    if (r.status === 0 && attempt >= 1) break; // a second timeout: give up on this symbol
    await sleep(1500 * (attempt + 1)); // 429, 5xx, timeout: short backoff, then retry
  }
  return {blocked: true, status: last.status || last.error || "no response"};
}

async function fetchSymbol(get, s) {
  const tries = [...new Set([s.yahoo, ...yahooCandidates(s.tv, s.key)].filter(Boolean))];
  let result = {miss: true};
  for (const y of tries) {
    const got = await fetchChart(get, y);
    if (got.pts) return {...got, yahoo: y};
    if (got.blocked) return got; // the host is refusing; other suffixes will not help
    result = got;
    await sleep(GAP_MS);
  }
  return result;
}

/* ---------- rewrite the HTML ---------- */
function readBlock(html, re, label) {
  const m = html.match(re);
  if (!m) throw new Error(`Could not find ${label} in the Atlas HTML.`);
  return m;
}

function sortedJson(obj) {
  return JSON.stringify(Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]])));
}

async function main() {
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
  let html = fs.readFileSync(HTML, "utf8");
  const seriesRe = /^const PRICE_SERIES=(\{[^\n]*\})\r?\n?;/m;
  const oldSeries = JSON.parse(readBlock(html, seriesRe, "PRICE_SERIES")[1]);
  const ccyMatch = html.match(/^const PRICE_CCY=(\{[^\n]*\});/m);
  const oldCcy = ccyMatch ? JSON.parse(ccyMatch[1]) : {};

  let browser = null, page = null;
  try {
    ({browser, page} = await openBrowser());
  } catch (e) {
    console.warn(`Could not start the browser (${firstLine(e)}).`);
  }

  try {
    const symbols = await loadSymbols(page);
    const useBrowser = page && process.env.ATLAS_FETCH !== "node";
    const get = useBrowser ? browserTransport(page) : nodeTransport();
    if (useBrowser && BASE === DEFAULT_BASE) {
      // Visit Yahoo Finance once first, the way a person would, so requests carry its cookies.
      await page.goto("https://finance.yahoo.com/quote/NVDA/", {waitUntil: "domcontentloaded", timeout: 30000}).catch(() => {});
    }
    console.log(`Refreshing ${symbols.length} symbols from ${BASE} via ${useBrowser ? "Chrome" : "Node fetch"} …`);

    const series = {}, ccy = {}, updated = [], keptStale = [], missing = [], refusals = {};
    let newest = 0, consecutiveRefusals = 0, cooldowns = 0, stopReason = "";
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      if (!stopReason && Date.now() - started > BUDGET_MS) stopReason = `time budget of ${BUDGET_MS / 60000} minutes reached`;
      const got = stopReason ? {skipped: true} : await fetchSymbol(get, s);

      if (got.pts) {
        series[s.key] = got.pts;
        if (got.currency && got.currency !== "USD") ccy[s.key] = got.currency;
        s.yahoo = got.yahoo;
        newest = Math.max(newest, got.marketTime);
        updated.push(s.key);
        consecutiveRefusals = 0;
        if (updated.length <= 3) console.log(`  ok: ${s.key} via ${got.yahoo} — ${got.pts.length} weeks (${elapsed()})`);
      } else {
        if (got.blocked) {
          consecutiveRefusals++;
          refusals[got.status] = (refusals[got.status] || 0) + 1;
          if (Object.values(refusals).reduce((a, b) => a + b, 0) <= 5) console.log(`  refused: ${s.key} (${got.status})`);
        }
        if (oldSeries[s.key]) {
          series[s.key] = oldSeries[s.key];
          if (oldCcy[s.key]) ccy[s.key] = oldCcy[s.key];
          keptStale.push(s.key);
        } else {
          missing.push(`${s.key} (${s.tv})`);
        }
      }

      if (!updated.length && consecutiveRefusals >= 8) {
        throw new Error(`The data host refused the first ${consecutiveRefusals} requests (${JSON.stringify(refusals)}). Nothing was written.`);
      }
      if (consecutiveRefusals >= 15 && !stopReason) {
        if (cooldowns >= 3) stopReason = "the data host kept refusing requests";
        else { cooldowns++; console.log(`  ${consecutiveRefusals} refusals in a row — pausing 60s (${cooldowns}/3)`); await sleep(60000); consecutiveRefusals = 0; }
      }
      if ((i + 1) % 25 === 0 || i === symbols.length - 1) console.log(`  ${i + 1}/${symbols.length} — ${updated.length} updated, ${keptStale.length} kept, ${missing.length} missing (${elapsed()})`);
      if (!got.skipped) await sleep(GAP_MS);
    }
    if (stopReason) console.log(`Stopped downloading early: ${stopReason}. Everything not refreshed keeps its previous data.`);
    if (updated.length < Math.max(10, symbols.length * 0.25)) {
      throw new Error(`Only ${updated.length} of ${symbols.length} symbols refreshed (${JSON.stringify(refusals)}) — refusing to overwrite the Atlas.`);
    }

    const asof = new Date(newest * 1000).toISOString().slice(0, 10);
    html = html.replace(seriesRe, () => `const PRICE_SERIES=${sortedJson(series)}\n;`);
    html = html.replace(/^const PRICE_SERIES_ASOF="[^"]*";/m, () => `const PRICE_SERIES_ASOF="${asof}";`);
    const ccyLine = `const PRICE_CCY=${sortedJson(ccy)};`;
    html = ccyMatch
      ? html.replace(/^const PRICE_CCY=\{[^\n]*\};/m, () => ccyLine)
      : html.replace(/^(const PRICE_SERIES_ASOF="[^"]*";)/m, (m) => `${m}\n${ccyLine}`);
    fs.writeFileSync(HTML, html);

    fs.mkdirSync(path.dirname(MANIFEST), {recursive: true});
    fs.writeFileSync(MANIFEST, JSON.stringify({
      note: "Symbols the price refresh covers. Regenerated from the app on every run; used as a fallback when the app cannot be read.",
      symbols: symbols.map(({key, tv, kind, name, yahoo}) => ({key, tv, kind, name, yahoo})),
    }, null, 1) + "\n");
    fs.writeFileSync(REPORT, JSON.stringify({
      generatedAt: new Date().toISOString(),
      pricesThrough: asof,
      source: "Yahoo Finance chart API — 5 years of weekly adjusted closes, final point at the latest close",
      symbols: symbols.length,
      updated: updated.length,
      keptPreviousData: keptStale,
      noData: missing,
      refusals,
      stoppedEarly: stopReason || null,
      nonUsdCurrencies: Object.entries(ccy).reduce((a, [, c]) => ((a[c] = (a[c] || 0) + 1), a), {}),
      seconds: Math.round((Date.now() - started) / 1000),
    }, null, 1) + "\n");

    console.log(`Done: prices through ${asof}. ${updated.length} updated, ${keptStale.length} kept previous data, ${missing.length} without data (${elapsed()}).`);
    if (missing.length) console.log(`Without data: ${missing.join(", ")}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error(firstLine(e)); process.exit(1); });
