// Browser end-to-end: open index.html from disk, load a PCS, read back the answer, screenshot every view.
// usage: node test/e2e.js path/to/PCS.pdf [outDir] [--light]
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright'); }

// several PDFs (npm run e2e passes the glob): one run each, in turn
const pdfArgs = process.argv.slice(2).filter(a => /\.pdf$/i.test(a));
if (pdfArgs.length > 1) {
  const rest = process.argv.slice(2).filter(a => !/\.pdf$/i.test(a));
  let code = 0;
  for (const p of pdfArgs) {
    console.log(`\n=== ${path.basename(p)}`);
    const r = require('child_process').spawnSync(process.execPath, [__filename, p, ...rest], { stdio: 'inherit' });
    code = code || r.status || 0;
  }
  process.exit(code);
}

// the three quote-sheet tables, row by row
const readQuote = page => page.$$eval('#quoteSheet table', ts => ts.map(t => [...t.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(c => c.textContent.trim()).join(' | '))));

(async () => {
  const pdf = path.resolve(process.argv[2]);
  const out = path.resolve(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.join(__dirname, '..', 'oracle', 'out', 'shots'));
  const light = process.argv.includes('--light');
  fs.mkdirSync(out, { recursive: true });
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
  const clip = () => page.evaluate(() => navigator.clipboard.readText().catch(() => null));
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
  // a beam row carries its BU section — or, where the design says nothing stocked passes (a clearance cap), says so
  const noneOk = answer.notes.some(n => /^stop: MB\d: no stocked BU section/.test(n));
  if (!/BU\d+x\d+/.test(quote[1] && quote[1][0] || '') && !(noneOk && /NO SECTION/.test(quote[1] && quote[1][0] || ''))) fail('beam row has no BU section');
  // the MEZZ sheet's cells: each table pastes at its first cell, rows numbered as the sheet's, the beams' DLT / LLF / END WT
  // as the sheet's own formulas, an empty field for the hidden half of SPAN's merged B:C
  const at = await page.$$eval('#quoteSheet .qs-at b', bs => bs.map(b => b.textContent));
  if (at.join() !== 'A7,A17,A37') fail('paste cells should be A7 / A17 / A37: ' + at.join());
  if (![quote[0][0], quote[1][0], quote[2][0]].every((r, i) => (r || '').startsWith(['7 |', '17 |', '37 |'][i]))) fail('rows should carry the sheet row numbers 7 / 17 / 37');
  await page.click('#quoteSheet [data-copy="beams"]'); await page.waitForTimeout(120);
  const bt = await clip();
  if (bt != null) {
    const f = bt.split('\n')[0].split('\t');
    console.log('beam rows copied', JSON.stringify(f));
    if (f.length < 9 || f[2] !== '' || f[4] !== '=IF(B17="","",F$7+G$7+I$7)' && !/^=IF\(B17="","",F\$\d+\+G\$\d+/.test(f[4]) || f[7] !== '=IF(B17="","",40)') fail('beam rows do not paste into the MEZZ sheet cells');
  }
  // nothing passes for a mark: the What next card — the frame column setback, then the clear height to ask for
  if (noneOk) {
    const card = await page.$$eval('#options .rescue', cs => cs.map(c => c.innerText.replace(/\s+/g, ' ')));
    console.log('what next', card.map(t => t.slice(0, 160)).join(' || '));
    if (!card.length || !card.every(t => /Frame column setback|Include the frame column setback/.test(t) && /clear height/i.test(t))) fail('a mark with no section should offer the setback and the clear height');
    const cp = await page.$('#options [data-rq="copy"]');
    if (cp) { await cp.click(); await page.waitForTimeout(120); const r = await clip(); console.log('clear-height request', r); if (r != null && !/Requesting C \d+'-\d/.test(r)) fail('the request should name the clear height to ask for'); }
  }
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
