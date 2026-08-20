// The Year over year screen: it must appear only when a prior period is
// loaded, read the shared weeks on both sides, and say plainly whether the
// prior side was joined to its own order log or borrowed this period's.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import os from 'os';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yoy-'));
const prior = [1, 2].map(n => { const d = path.join(tmp, `Week ${n} - 2025.xlsm`); fs.copyFileSync(w(n), d); return d; });
const priorOrder = path.join(tmp, 'OrderLog_prior.xlsx'); fs.copyFileSync(ORDER, priorOrder);

const fails = []; const check = (n, c, d) => { if (!c) fails.push(n); console.log((c ? 'ok   ' : 'FAIL ') + n + (d ? '  ' + d : '')); };
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1512, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));

async function load({ withPrior, withPriorOrder }) {
  await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await p.setInputFiles('#quoteFiles', [w(1), w(2), w(3)]);
  await p.setInputFiles('#orderFiles', [ORDER]);
  if (withPrior) await p.setInputFiles('#priorFiles', prior);
  if (withPriorOrder) await p.setInputFiles('#priorOrderFiles', [priorOrder]);
  await p.click('#runDashboard');
  await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  await p.waitForTimeout(800);
}

await load({ withPrior: false });
check('the nav hides Year over year with no prior period',
  await p.$eval('[data-screen="compare"]', n => n.hidden));

await load({ withPrior: true, withPriorOrder: true });
check('the nav shows Year over year once a prior period is loaded',
  await p.$eval('[data-screen="compare"]', n => !n.hidden));
await p.click('[data-screen="compare"]');
await p.waitForTimeout(600);
check('the screen is the one on show', await p.$eval('#compare', n => n.classList.contains('is-active')));

const text = id => p.$eval(id, n => n.innerText.replace(/\s+/g, ' ').trim());
const banner = await text('#compareBanner');
console.log('\n[banner] ' + banner + '\n');
check('the banner names both periods', /2026/.test(banner) && /2025/.test(banner), banner.slice(0, 80));
check('the banner says what the weeks were matched on', /Matched on/.test(banner));
check('the banner credits the prior order log', /joined to its own order log/.test(banner));

const kpis = await text('#compareKpis');
const KPI = kpis.toLowerCase();
check('the headline carries every measure',
  ['quotes issued', 'quoted value', 'quote wins', 'conversion', 'value returned', 'average turnaround'].every(k => KPI.includes(k)));
check('every headline figure states its prior value', (KPI.match(/a year ago/g) || []).length === 6, kpis.slice(0, 90));

for (const [id, want] of [['#cmpTable', 6], ['#cmpWeeks', 2], ['#cmpBands', 2], ['#cmpPeople', 1]]) {
  const rows = await p.$$eval(id + ' .cmp-row, ' + id + ' .cmp-pair', n => n.length);
  check('panel ' + id + ' draws its rows', rows >= want, rows + ' rows');
}
check('the race plots four lines', await p.$$eval('#cmpRace path', n => n.length) === 4);
check('the account movement grid draws four lists', await p.$$eval('#cmpCustomers .cmp-move', n => n.length) === 4);

// No number may be missing, and no bar may be drawn wider than its track.
const html = await p.$eval('#compare', n => n.innerHTML);
check('no figure resolves to NaN or undefined', !/NaN|undefined/.test(html.replace(/data:[^"')\s]+/g, '')),
  (html.match(/.{0,40}(NaN|undefined).{0,40}/) || [])[0] || '');
check('every bar stays inside its track',
  await p.$$eval('.cmp-bar i', nodes => nodes.every(n => n.getBoundingClientRect().width <= n.parentElement.getBoundingClientRect().width + 1)));

// Nothing on the screen may leave the column it was given.
const overflow = await p.evaluate(() => {
  const box = document.getElementById('compare').getBoundingClientRect();
  return [...document.querySelectorAll('#compare *')].filter(n => {
    const r = n.getBoundingClientRect();
    return r.width && (r.right > box.right + 1 || r.left < box.left - 1);
  }).slice(0, 4).map(n => n.className || n.tagName);
});
check('nothing spills out of the screen column', overflow.length === 0, overflow.join(', '));

// Selecting a moved account must land on that account's record.
const mover = await p.$('#cmpCustomers [data-open-account]');
if (mover) {
  const key = await mover.getAttribute('data-open-account');
  await mover.click(); await p.waitForTimeout(500);
  check('selecting a moved account opens its record',
    await p.$eval('#customers', n => n.classList.contains('is-active')) &&
    (await p.$eval('#custProfile', n => n.innerText.length)) > 40, key.slice(0, 30));
  await p.click('[data-screen="compare"]'); await p.waitForTimeout(400);
} else check('selecting a moved account opens its record', false, 'no mover rendered');

await p.screenshot({ path: path.join(root, 'test', 'yoy-screen.png'), fullPage: true });

// The dark theme flips half the palette, so a header that is white on a dark
// green in one theme can end up white on a pale green in the other.
await p.click('#themeButton');
await p.waitForTimeout(500);
const lowContrast = await p.evaluate(() => {
  const parse = colour => (colour.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = colour => { const [r, g, b] = parse(colour); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const out = [];
  document.querySelectorAll('#compare *').forEach(node => {
    if (!node.textContent.trim() || node.children.length) return;
    const style = getComputedStyle(node);
    let background = style.backgroundColor, walk = node;
    while (background === 'rgba(0, 0, 0, 0)' && walk.parentElement) { walk = walk.parentElement; background = getComputedStyle(walk).backgroundColor; }
    if (Math.abs(lum(style.color) - lum(background)) < 0.16)
      out.push(node.textContent.trim().slice(0, 22) + ' — ' + style.color + ' on ' + background);
  });
  return out.slice(0, 6);
});
check('every line of the screen survives the dark theme', lowContrast.length === 0, lowContrast.join(' | '));
await p.screenshot({ path: path.join(root, 'test', 'yoy-dark.png'), fullPage: true });
await p.click('#themeButton');
await p.waitForTimeout(400);

// Borrowed order log: the screen must say so rather than imply a real read.
await load({ withPrior: true, withPriorOrder: false });
await p.click('[data-screen="compare"]'); await p.waitForTimeout(600);
const borrowed = await text('#compareBanner');
check('a prior period with no order log of its own says so', /add a prior order log/.test(borrowed), borrowed.slice(-90));

check('no JS errors', errs.length === 0, errs.slice(0, 2).join('; '));
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'Year over year renders, matches weeks, and states its own limits.'));
process.exit(fails.length ? 1 : 0);
