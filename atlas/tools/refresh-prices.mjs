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
 * Environment:
 *   ATLAS_CHROME_CHANNEL  browser channel used to read the company list from
 *                         the app ("chrome" on GitHub runners). Unset = the
 *                         Playwright-bundled Chromium.
 *   ATLAS_SYMBOLS_FROM    "manifest" to skip the browser and use
 *                         atlas/data/price-symbols.json.
 *   YAHOO_BASE            override the data host (used by the offline test).
 *   PRICE_GAP_MS          pause between requests (default 350).
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
const BASE = process.env.YAHOO_BASE || "https://query1.finance.yahoo.com";
const GAP_MS = Number(process.env.PRICE_GAP_MS || 350);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

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

/* ---------- which symbols to refresh ---------- */
async function symbolsFromApp() {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require("playwright-core"); } catch { pw = require("playwright"); }
  const channel = process.env.ATLAS_CHROME_CHANNEL;
  const browser = await pw.chromium.launch(channel ? {channel} : {});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(HTML).href, {waitUntil: "load"});
    await page.waitForFunction(() => typeof allNodes !== "undefined" && allNodes.length > 0, null, {timeout: 30000});
    return await page.evaluate(() => {
      const out = new Map();
      allNodes
        .filter((n) => n.kind === "company" && n.status !== "Private" && n.ticker)
        .forEach((n) => { if (!out.has(n.ticker)) out.set(n.ticker, {key: n.ticker, tv: chartSymbol(n), kind: "company", name: n.name}); });
      ETFS.forEach((e) => { if (e.n && !out.has(e.n)) out.set(e.n, {key: e.n, tv: e.n, kind: "etf", name: e.full || e.n}); });
      return [...out.values()];
    });
  } finally {
    await browser.close();
  }
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")).symbols || []; } catch { return []; }
}

async function loadSymbols() {
  const known = new Map(readManifest().map((s) => [s.key, s]));
  if (process.env.ATLAS_SYMBOLS_FROM !== "manifest") {
    try {
      const fromApp = await symbolsFromApp();
      console.log(`Read ${fromApp.length} symbols from the app.`);
      // Keep the Yahoo symbol that worked last time so the next run tries it first.
      return fromApp.map((s) => ({...s, yahoo: known.get(s.key)?.tv === s.tv ? known.get(s.key).yahoo : undefined}));
    } catch (e) {
      console.warn(`Could not read symbols from the app (${e.message.split("\n")[0]}); using the manifest.`);
    }
  }
  const list = [...known.values()];
  if (!list.length) throw new Error("No symbols: the app could not be read and atlas/data/price-symbols.json is empty.");
  return list;
}

/* ---------- download ---------- */
async function fetchChart(yahoo) {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(yahoo)}?range=5y&interval=1wk&includeAdjustedClose=true&events=div%2Csplit`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, {headers: {"User-Agent": UA, Accept: "application/json"}});
    } catch {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1) ** 2); continue; }
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const r = body?.chart?.result?.[0];
    if (!r?.timestamp?.length) return null;
    const adj = r.indicators?.adjclose?.[0]?.adjclose;
    const close = r.indicators?.quote?.[0]?.close;
    const vals = adj || close;
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
  return null;
}

async function fetchSymbol(s) {
  const tries = [...new Set([s.yahoo, ...yahooCandidates(s.tv, s.key)].filter(Boolean))];
  for (const y of tries) {
    const got = await fetchChart(y);
    if (got) return {...got, yahoo: y};
    await sleep(GAP_MS);
  }
  return null;
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
  let html = fs.readFileSync(HTML, "utf8");
  const seriesRe = /^const PRICE_SERIES=(\{[^\n]*\})\r?\n?;/m;
  const oldSeries = JSON.parse(readBlock(html, seriesRe, "PRICE_SERIES")[1]);
  const ccyMatch = html.match(/^const PRICE_CCY=(\{[^\n]*\});/m);
  const oldCcy = ccyMatch ? JSON.parse(ccyMatch[1]) : {};

  const symbols = await loadSymbols();
  console.log(`Refreshing ${symbols.length} symbols from ${BASE} …`);

  const series = {}, ccy = {}, updated = [], keptStale = [], missing = [];
  let newest = 0;
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    const got = await fetchSymbol(s);
    if (got) {
      series[s.key] = got.pts;
      if (got.currency && got.currency !== "USD") ccy[s.key] = got.currency;
      s.yahoo = got.yahoo;
      newest = Math.max(newest, got.marketTime);
      updated.push(s.key);
    } else if (oldSeries[s.key]) {
      series[s.key] = oldSeries[s.key];
      if (oldCcy[s.key]) ccy[s.key] = oldCcy[s.key];
      keptStale.push(s.key);
    } else {
      missing.push(`${s.key} (${s.tv})`);
    }
    if ((i + 1) % 25 === 0 || i === symbols.length - 1) console.log(`  ${i + 1}/${symbols.length} — ${updated.length} updated, ${keptStale.length} kept, ${missing.length} missing`);
    await sleep(GAP_MS);
  }
  // Series the app no longer lists are dropped; anything it still lists is kept.
  if (updated.length < Math.max(10, symbols.length * 0.25)) {
    throw new Error(`Only ${updated.length} of ${symbols.length} symbols refreshed — refusing to overwrite the Atlas. Check the data host.`);
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
    nonUsdCurrencies: Object.entries(ccy).reduce((a, [, c]) => ((a[c] = (a[c] || 0) + 1), a), {}),
    seconds: Math.round((Date.now() - started) / 1000),
  }, null, 1) + "\n");

  console.log(`Done: prices through ${asof}. ${updated.length} updated, ${keptStale.length} kept previous data, ${missing.length} without data.`);
  if (missing.length) console.log(`Without data: ${missing.join(", ")}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
