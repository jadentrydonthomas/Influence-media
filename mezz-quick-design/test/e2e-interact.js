// Click through every control after loading a PCS; fail on any page error or a missing answer.
const path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright'); }

(async () => {
  const pdf = path.resolve(process.argv[2]);
  const shots = path.resolve(process.argv[3] || path.join(__dirname, '..', 'oracle', 'out', 'shots'));
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.setInputFiles('#file', pdf);
  await page.waitForSelector('#v-results.is-active', { timeout: 60000 });
  const quote = () => page.$eval('#quoteText', e => e.textContent);
  const log = async label => console.log(label.padEnd(28), (await quote()).split('\n').slice(2).join(' | '));
  await log('default');

  const setSetting = async (key, value) => {
    await page.click('#nav button[data-view="settings"]');
    await page.selectOption(`#settingsGrid [data-set="${key}"]`, value);
    await page.waitForTimeout(150);
  };
  await setSetting('marks', 'split'); await log('split marks');
  await page.click('#nav button[data-view="plan"]'); await page.screenshot({ path: path.join(shots, 'plan-split.png'), fullPage: false });
  await setSetting('marks', 'single');
  await setSetting('colLength', 'clear'); await log('column clear length');
  await setSetting('colLength', 'A');
  await setSetting('edition', '13'); await log('edition 13');
  await setSetting('edition', '16'); await log('edition 16');
  await setSetting('edition', 'auto');
  await setSetting('includeW818', 'true'); await log('W8X18 allowed');
  await setSetting('includeW818', 'false');
  await page.fill('#settingsGrid [data-set="dMax"]', '18'); await page.press('#settingsGrid [data-set="dMax"]', 'Tab'); await page.waitForTimeout(150); await log('max depth 18');
  await page.fill('#settingsGrid [data-set="dMax"]', '24'); await page.press('#settingsGrid [data-set="dMax"]', 'Tab'); await page.waitForTimeout(150);

  // joist direction toggle
  await page.click('#nav button[data-view="plan"]');
  await page.click('#joistSeg button[data-j="x"]'); await log('joists span length');
  await page.screenshot({ path: path.join(shots, 'plan-joists-x.png'), fullPage: false });
  await page.click('#joistSeg button[data-j="auto"]');
  // hover a beam -> trib band
  await page.dispatchEvent('#planSvg .beam[data-beam="2"]', 'mouseenter');
  const tribOn = await page.$eval('#planSvg .trib[data-beam="2"]', e => e.classList.contains('on'));
  console.log('trib band on hover'.padEnd(28), tribOn);

  // pick a shallower alternative from the beam calc table, then back
  await page.click('#nav button[data-view="beam"]');
  await page.click('#altTable tr.pick[data-d="18"]'); await log('picked 18" alternative');
  await page.click('#nav button[data-view="results"]');
  await page.click('.alt[data-d="24"]'); await log('back to lightest');

  // column override
  await page.click('#nav button[data-view="column"]');
  await page.selectOption('#colPick', 'W12X26'); await log('column override W12X26');
  await page.selectOption('#colPick', '');

  // edit an input: live load 150
  await page.click('#nav button[data-view="inputs"]');
  await page.fill('#inputsGrid input[data-path="loads.live"]', '150'); await page.press('#inputsGrid input[data-path="loads.live"]', 'Tab'); await page.waitForTimeout(150); await log('live 150 psf');
  await page.fill('#inputsGrid input[data-path="geom.C"]', `10'-6"`); await page.press('#inputsGrid input[data-path="geom.C"]', 'Tab'); await page.waitForTimeout(150); await log('C = 10\'-6" requested');
  await page.fill('#inputsGrid input[data-path="geom.C"]', ''); await page.press('#inputsGrid input[data-path="geom.C"]', 'Tab');
  await page.fill('#inputsGrid input[data-path="loads.live"]', '125'); await page.press('#inputsGrid input[data-path="loads.live"]', 'Tab'); await page.waitForTimeout(150); await log('live back to 125');

  // copy button (clipboard may be blocked headless; just must not throw)
  await page.click('#copyQuote');

  // manual entry path on a fresh page
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p2.on('pageerror', e => errors.push('manual: ' + e.message));
  await p2.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p2.click('#manualBtn');
  await p2.waitForSelector('#v-inputs.is-active');
  console.log('manual entry'.padEnd(28), (await p2.$eval('#quoteText', e => e.textContent)).split('\n').slice(2).join(' | '));

  console.log('errors', errors);
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
