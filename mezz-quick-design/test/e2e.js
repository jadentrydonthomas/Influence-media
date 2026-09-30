// Browser end-to-end: open index.html from disk, load a PCS, read back the answer, screenshot every view.
// usage: node test/e2e.js path/to/PCS.pdf [outDir] [--dark]
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright'); }

(async () => {
  const pdf = path.resolve(process.argv[2]);
  const out = path.resolve(process.argv[3] || path.join(__dirname, '..', 'oracle', 'out', 'shots'));
  const dark = process.argv.includes('--dark');
  fs.mkdirSync(out, { recursive: true });
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  if (dark) await page.click('#themeBtn');
  await page.screenshot({ path: path.join(out, '01-upload.png') });
  const t0 = Date.now();
  await page.setInputFiles('#file', pdf);
  await page.waitForSelector('#v-results.is-active', { timeout: 60000 });
  const ms = Date.now() - t0;
  const answer = await page.evaluate(() => ({
    quote: document.querySelector('#quoteText').textContent,
    status: document.querySelector('#statusText').textContent,
    warnings: [...document.querySelectorAll('#warnings .warn')].map(w => w.className.replace('warn ', '') + ': ' + w.textContent),
    checks: [...document.querySelectorAll('.check')].map(c => c.textContent),
  }));
  console.log('load+design ms', ms);
  console.log(JSON.stringify(answer, null, 1));
  for (const v of ['results', 'plan', 'beam', 'column', 'inputs', 'settings']) {
    await page.click(`#nav button[data-view="${v}"]`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `${v}${dark ? '-dark' : ''}.png`), fullPage: true });
  }
  // phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#nav button[data-view="results"]');
  await page.screenshot({ path: path.join(out, 'results-phone.png'), fullPage: false });
  console.log('errors', errors);
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
