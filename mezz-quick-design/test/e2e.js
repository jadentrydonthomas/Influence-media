// Browser end-to-end: open index.html from disk, load a PCS, read back the answer, screenshot every view.
// usage: node test/e2e.js path/to/PCS.pdf [outDir] [--light]
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright'); }

// the three quote-sheet tables, row by row
const readQuote = page => page.$$eval('#quoteSheet table', ts => ts.map(t => [...t.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(c => c.textContent.trim()).join(' | '))));

(async () => {
  const pdf = path.resolve(process.argv[2]);
  const out = path.resolve(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.join(__dirname, '..', 'oracle', 'out', 'shots'));
  const light = process.argv.includes('--light');
  fs.mkdirSync(out, { recursive: true });
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], fail = msg => errors.push('assert: ' + msg);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  if (light) await page.click('#themeBtn');
  await page.screenshot({ path: path.join(out, '01-upload.png') });
  const t0 = Date.now();
  await page.setInputFiles('#file', pdf);
  await page.waitForSelector('#v-results.is-active', { timeout: 60000 });
  const ms = Date.now() - t0;
  // values the PCS leaves open are asked for on the Design page: take the first typical value offered for each
  for (let k = 0; k < 8 && await page.$('#needCard'); k++) {
    const rows = await page.$$eval('#needCard .need-row', rs => rs.map(r => ({ path: r.querySelector('input').dataset.need, chip: !!r.querySelector('.chip') })));
    console.log('needs input', rows.map(r => r.path).join(', '));
    const row = rows.find(r => r.chip);
    if (!row) { fail('a required value has no typical value to pick: ' + rows.map(r => r.path).join(', ')); break; }
    await page.click(`#needCard .chip[data-need="${row.path}"]`);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);   // counters and rings settle
  const answer = await page.evaluate(() => ({
    title: document.querySelector('#resTitle').textContent,
    status: document.querySelector('#statusText').textContent,
    metrics: [...document.querySelectorAll('#metrics .metric')].map(m => m.querySelector('.metric-copy > span').textContent + ': ' + m.querySelector('b').textContent),
    notes: [...document.querySelectorAll('#warnings .note')].map(w => w.className.replace('note ', '') + ': ' + w.textContent),
    options: [...document.querySelectorAll('#options .option')].map(o => o.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)),
    checks: [...document.querySelectorAll('.check')].map(c => c.textContent),
  }));
  const quote = await readQuote(page);
  console.log('load+design ms', ms);
  console.log(JSON.stringify({ ...answer, quote }, null, 1));
  if (quote.length !== 3 || quote.some(t => !t.length)) fail('quote sheet should have design, beam and column rows');
  if (!/BU\d+x\d+/.test(quote[1] && quote[1][0] || '')) fail('beam row has no BU section');
  if (answer.metrics.length !== 4) fail('four metric cards expected');
  // the 3D model drew something: count non-transparent pixels in the canvas
  const inked = await page.$eval('#model3d', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
  console.log('3D model inked pixels', inked);
  if (inked < 2000) fail('3D model looks empty');
  for (const v of ['results', 'plan', 'beam', 'column', 'inputs', 'settings']) {
    await page.click(`#nav button[data-view="${v}"]`);
    await page.waitForTimeout(300);
    const active = await page.$eval(`#nav button[data-view="${v}"]`, b => b.getAttribute('aria-current'));
    if (active !== 'page') fail(`nav ${v} not marked current`);
    await page.screenshot({ path: path.join(out, `${v}${light ? '-light' : ''}.png`), fullPage: true });
  }
  // phone width: no horizontal page scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#nav button[data-view="results"]');
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`phone layout scrolls sideways by ${overflow}px`);
  await page.screenshot({ path: path.join(out, 'results-phone.png'), fullPage: false });
  console.log('errors', errors);
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
