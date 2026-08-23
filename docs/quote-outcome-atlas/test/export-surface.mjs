// The deck export has two paths. Opened from disk — which is how this file is
// delivered — the browser saves the generated deck itself. Opened inside a
// viewer that mediates saves, the same anchor is inert, so the host has to be
// asked and the answer has to reach the button. A save that silently does
// nothing is the defect this guards.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const APP = path.join(root, 'app', 'quote-conversion-atlas-shareable.html');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');

const fails = [];
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${actual} / want ${expected}`}`);
};

const browser = await chromium.launch({ executablePath: CHROME });

// `host` is the stub installed as window.claude before the page's own script
// runs: null means no viewer at all, which is the offline delivery path.
async function open(host) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  if (host) await page.addInitScript(host);
  await page.goto('file://' + APP);
  await page.waitForTimeout(500);
  await page.setInputFiles('#quoteFiles', [w(1), w(2), w(3)]);
  await page.setInputFiles('#orderFiles', [ORDER]);
  await page.click('#runDashboard');
  await page.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  await page.waitForTimeout(300);
  return { page, errs };
}

// A viewer that grants the save and accepts it.
{
  const { page, errs } = await open(() => {
    window.__saved = null;
    window.claude = {
      use: name => Promise.resolve(name === 'downloads'
        ? { save: req => { window.__saved = { filename: req.filename, bytes: String(req.data).length }; return Promise.resolve({ status: 'saved' }); } }
        : null),
    };
  });
  // The label clears itself after a moment, so read it before waiting out the
  // download timeout rather than after.
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.click('#reviewMode');
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => window.__saved);
  const label = await page.textContent('#reviewMode');
  await page.waitForTimeout(3000);
  check('a mediating viewer is asked rather than handed an inert link', downloaded, false);
  check('the deck reaches the host save surface', saved && saved.bytes > 40000, true);
  check('it is offered under a dated .html name', /^quote-outcome-team-report-\d{4}-\d\d-\d\d\.html$/.test(saved ? saved.filename : ''), true);
  check('an accepted save says so on the button', label.trim(), 'Report deck saved');
  check('no JS errors on the mediated path', errs.join(' | '), '');
  await page.close();
}

// The viewer offers the save and the person declines it. The button must not
// claim a download that did not happen, and must not sit on a stale label.
{
  const { page } = await open(() => {
    window.claude = { use: () => Promise.resolve({ save: () => Promise.reject({ code: 'declined', message: 'no' }) }) };
  });
  await page.click('#reviewMode');
  await page.waitForTimeout(400);
  check('a declined save is reported as declined', (await page.textContent('#reviewMode')).trim(), 'Report deck not saved');
  await page.waitForTimeout(1800);
  check('the button returns to its own label', (await page.textContent('#reviewMode')).trim(), 'Export team report deck');
  await page.close();
}

// The extension is not enabled for this view, or the capability is gone.
{
  const { page } = await open(() => {
    window.claude = { use: () => Promise.resolve({ save: () => Promise.reject({ code: 'extension_not_enabled', message: 'no html' }) }) };
  });
  await page.click('#reviewMode');
  await page.waitForTimeout(400);
  check('a refused save is not reported as a download', (await page.textContent('#reviewMode')).trim(), 'This viewer cannot save the deck');
  await page.close();
}

// A viewer that offers no save surface at all still gets the anchor, because
// on that path the browser is the save surface.
{
  const { page } = await open(() => { window.claude = { use: () => Promise.resolve(null) }; });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 40000 }).catch(() => null),
    page.click('#reviewMode'),
  ]);
  check('a viewer with no save surface falls back to the link', dl !== null, true);
  await page.close();
}

// The delivery path: no viewer, no window.claude, opened from disk.
{
  const { page, errs } = await open(null);
  const hasClaude = await page.evaluate(() => 'claude' in window);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 40000 }).catch(() => null),
    page.click('#reviewMode'),
  ]);
  await page.waitForTimeout(400);
  check('opened from disk there is no viewer to ask', hasClaude, false);
  check('opened from disk the browser saves the deck', dl !== null, true);
  check('and the button says it downloaded', (await page.textContent('#reviewMode')).trim(), 'Report deck downloaded');
  check('no JS errors on the offline path', errs.join(' | '), '');
  await page.close();
}

await browser.close();
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'The deck export reaches a real save surface on every path, and says which one answered.'));
process.exit(fails.length ? 1 : 0);
