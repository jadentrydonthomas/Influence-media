// Click through every control after loading a PCS; fail on any page error or a missing answer.
// usage: node test/e2e-interact.js path/to/PCS.pdf [shotsDir]
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright'); }

(async () => {
  const pdf = path.resolve(process.argv[2]);
  const shots = path.resolve(process.argv[3] || path.join(__dirname, '..', 'oracle', 'out', 'shots'));
  fs.mkdirSync(shots, { recursive: true });
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors = [], fail = msg => errors.push('assert: ' + msg);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.setInputFiles('#file', pdf);
  await page.waitForSelector('#v-results.is-active', { timeout: 60000 });

  // beam / column quote rows, compact
  const quote = () => page.$$eval('#quoteSheet table', ts => ts.slice(1).map(t => [...t.querySelectorAll('tbody tr')].map(tr => {
    const c = [...tr.cells].map(x => x.textContent.trim());
    return c.slice(1, -1).join(' ');
  }).join(' / ')).join(' || '));
  const log = async label => { const q = await quote(); console.log(label.padEnd(30), q); return q; };
  const base = await log('default');

  const setSetting = async (key, value) => {
    await page.click('#nav button[data-view="settings"]');
    await page.selectOption(`#settingsGrid [data-set="${key}"]`, value);
    await page.waitForTimeout(150);
  };
  const setNum = async (key, value) => {
    await page.click('#nav button[data-view="settings"]');
    await page.fill(`#settingsGrid [data-set="${key}"]`, String(value)); await page.press(`#settingsGrid [data-set="${key}"]`, 'Tab'); await page.waitForTimeout(150);
  };
  await setSetting('marks', 'split'); await log('split marks');
  await page.click('#nav button[data-view="plan"]'); await page.screenshot({ path: path.join(shots, 'plan-split.png'), fullPage: false });
  await setSetting('marks', 'single');
  await setSetting('colLength', 'clear'); await log('column clear length');
  await setSetting('colLength', 'A');
  for (const ed of ['13', '15', '16']) { await setSetting('edition', ed); await log('edition ' + ed); }
  await setSetting('edition', 'auto');
  await setSetting('includeW818', 'true'); await log('W8X18 allowed');
  await setSetting('includeW818', 'false');
  await setSetting('optionDefault', 'fit'); await log('default option: best fit');
  await setSetting('optionDefault', 'headroom'); await log('default option: headroom');
  await setSetting('optionDefault', 'lightest');
  await setNum('dMax', 18); await log('max depth 18');
  await setNum('dMax', 30);
  if (await quote() !== base) fail('settings round-trip did not return to the default answer');

  // joist direction toggle + trib hover
  await page.click('#nav button[data-view="plan"]');
  await page.click('#joistSeg button[data-j="x"]'); await log('joists span length');
  await page.screenshot({ path: path.join(shots, 'plan-joists-x.png'), fullPage: false });
  await page.click('#joistSeg button[data-j="auto"]');
  await page.dispatchEvent('#planSvg .beam[data-beam="2"]', 'mouseenter');
  const tribOn = await page.$eval('#planSvg .trib[data-beam="2"]', e => e.classList.contains('on'));
  console.log('trib band on hover'.padEnd(30), tribOn);
  if (!tribOn) fail('trib band did not light on hover');

  // beam options on the results page
  await page.click('#nav button[data-view="results"]');
  const opts = await page.$$eval('#options .option', os => os.length);
  if (opts < 2) fail('expected at least two beam options');
  for (const k of ['fit', 'headroom']) {
    const b = await page.$(`#options [data-opt="${k}"]`);
    if (!b) continue;
    await b.click(); await page.waitForTimeout(150); await log('option ' + k);
  }
  await page.click('#options [data-opt="lightest"]'); await page.waitForTimeout(150);
  if (await quote() !== base) fail('back to lightest did not restore the quote');

  // pick a depth from the beam calc table, then return
  await page.click('#nav button[data-view="beam"]');
  const depths = await page.$$eval('#altTable tr.pick', trs => trs.map(t => t.dataset.d));
  await page.click(`#altTable tr.pick[data-d="${depths[Math.floor(depths.length / 2)]}"]`); await log(`picked ${depths[Math.floor(depths.length / 2)]}" row`);
  await page.click('#nav button[data-view="results"]');
  await page.click('#options [data-opt="lightest"]'); await page.waitForTimeout(150);

  // column override
  await page.click('#nav button[data-view="column"]');
  await page.selectOption('#colPick', 'W12X26'); await log('column override W12X26');
  await page.selectOption('#colPick', '');

  // inputs: live load, clearance C, deck type and concrete drive the dead load
  await page.click('#nav button[data-view="inputs"]');
  const fillIn = async (p, v) => { await page.fill(`#inputsGrid input[data-path="${p}"]`, v); await page.press(`#inputsGrid input[data-path="${p}"]`, 'Tab'); await page.waitForTimeout(150); };
  const dead = () => page.$eval('#inputsGrid input[data-path="loads.dead"]', e => e.value);
  await fillIn('loads.live', '150'); await log('live 150 psf');
  await fillIn('geom.C', `10'-6"`); await log('C = 10\'-6" requested');
  await fillIn('geom.C', '');
  await fillIn('loads.live', '125');
  const d0 = await dead();
  await page.selectOption('#inputsGrid select[data-mezz="concrete"]', 'LW'); await page.waitForTimeout(150);
  const dLW = await dead(); await log(`LW concrete (DL ${dLW})`);
  await page.selectOption('#inputsGrid select[data-mezz="deck"]', '2VL'); await page.waitForTimeout(150);
  const dLW2 = await dead(); await log(`LW on 2VL (DL ${dLW2})`);
  await page.selectOption('#inputsGrid select[data-mezz="concrete"]', 'NW'); await page.selectOption('#inputsGrid select[data-mezz="deck"]', '1.0C'); await page.waitForTimeout(150);
  console.log('dead load NW / LW / LW 2VL'.padEnd(30), d0, dLW, dLW2);
  if (!(+dLW < +d0)) fail('lightweight concrete should lower the dead load');
  if (await dead() !== d0) fail('dead load did not return to the deck guide value');
  if (await quote() !== base) fail('inputs round-trip did not return to the default answer');

  // 3D model: controls, then find and click a beam by sweeping the canvas
  await page.click('#nav button[data-view="results"]');
  await page.click('#m3Pause'); await page.click('#m3Reset');
  for (const t of ['slab', 'joists', 'building']) { await page.click(`#modelToggles button[data-t="${t}"]`); await page.click(`#modelToggles button[data-t="${t}"]`); }
  await page.click('#m3In'); await page.click('#m3Out');
  await page.$eval('#model3d', c => c.scrollIntoView({ block: 'center' }));
  const box = await page.$eval('#model3d', c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  let hit = null;
  for (let j = 0.25; j < 0.85 && !hit; j += 0.03) {
    for (let i = 0.15; i < 0.85 && !hit; i += 0.03) {
      await page.mouse.move(box.x + box.w * i, box.y + box.h * j);
      const h = await page.$eval('#modelCard h4', e => e.textContent);
      if (/^B\d+ · /.test(h)) hit = [box.x + box.w * i, box.y + box.h * j, h];
    }
  }
  if (!hit) fail('no beam found under the pointer in the 3D model');
  else {
    await page.mouse.click(hit[0], hit[1]);
    const card = await page.$eval('#modelCard', e => e.textContent.replace(/\s+/g, ' ').trim());
    console.log('3D click'.padEnd(30), card.slice(0, 120));
    if (!/Selected member/.test(card) || !/BU\d+x\d+/.test(card)) fail('clicking a 3D beam did not select it');
  }
  await page.screenshot({ path: path.join(shots, 'model-selected.png'), fullPage: false });

  // copy buttons: rail copies all three tables as TSV
  await page.click('#copyQuote'); await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (clip != null) {
    console.log('clipboard lines'.padEnd(30), clip.split('\n').length);
    if (!clip.includes('\t') || !/BU\d+x\d+/.test(clip)) fail('copied quote rows are not tab-separated with the BU section');
  }
  for (const b of await page.$$('#quoteSheet [data-copy]')) await b.click();

  // manual entry path on a fresh page: stops on the missing (B) clearance
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errors.push('manual: ' + e.message));
  await p2.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p2.click('#manualBtn');
  await p2.waitForSelector('#v-inputs.is-active');
  const status = await p2.$eval('#statusText', e => e.textContent);
  console.log('manual entry'.padEnd(30), status);
  await p2.fill(`#inputsGrid input[data-path="geom.B"]`, `10'-0"`); await p2.press(`#inputsGrid input[data-path="geom.B"]`, 'Tab'); await p2.waitForTimeout(200);
  await p2.click('#nav button[data-view="results"]');
  const mq = await p2.$$eval('#quoteSheet table', ts => ts.map(t => [...t.querySelectorAll('tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()).join(' / ')));
  console.log('manual entry, B = 10\'-0"'.padEnd(30), mq.join(' || '));
  if (mq.length !== 3) fail('manual entry did not design once (B) was filled');

  console.log('errors', errors);
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
