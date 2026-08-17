// Exercises the dashboard across awkward-but-real source combinations.
// "Any data input will work" is only true if these all render without throwing
// and without inventing numbers.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const APP = path.join(root, 'app', 'quote-conversion-atlas-shareable.html');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');

// A synthetic 20-week set: the same three books re-labelled so the deck and the
// weekly chart have to cope with a long span, not the 10 they were drawn for.
const many = [];
const manyDir = path.join(FIX, '.generated');
fs.mkdirSync(manyDir, { recursive: true });
for (let i = 1; i <= 20; i += 1) {
  const src = w(((i - 1) % 3) + 1);
  const dst = path.join(manyDir, `Week ${i} - 2026.xlsm`);
  fs.copyFileSync(src, dst);
  many.push(dst);
}

const CASES = [
  { name: 'single week', weeks: [w(1)], orders: [ORDER] },
  { name: 'two weeks', weeks: [w(1), w(2)], orders: [ORDER] },
  { name: 'non-contiguous weeks (1 and 3)', weeks: [w(1), w(3)], orders: [ORDER] },
  { name: 'weeks selected out of order (3,1,2)', weeks: [w(3), w(1), w(2)], orders: [ORDER] },
  { name: 'duplicate week selected twice', weeks: [w(1), w(1), w(2)], orders: [ORDER] },
  { name: 'same order log listed twice', weeks: [w(1), w(2)], orders: [ORDER, ORDER] },
  { name: '20 weeks', weeks: many, orders: [ORDER] },
];

const browser = await chromium.launch({ executablePath: CHROME });
let failures = 0;

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  let result = {};
  try {
    await page.goto('file://' + APP);
    await page.click('[data-screen="data"]');
    await page.setInputFiles('#quoteFiles', c.weeks);
    await page.setInputFiles('#orderFiles', c.orders);
    await page.click('#runDashboard');
    await page.waitForFunction(
      () => /refreshed|could not|stopped|error/i.test(document.getElementById('runStatusTitle').textContent),
      null, { timeout: 180000 });
    await page.waitForTimeout(500);
    result = await page.evaluate(() => ({
      status: document.getElementById('runStatusTitle').textContent.trim(),
      quotes: document.getElementById('railQuoted').textContent.trim(),
      wins: document.getElementById('railOrders').textContent.trim(),
      conv: document.getElementById('railConversion').textContent.trim(),
      weeklyBars: document.querySelectorAll('#weeklyChart [class*="week"]').length,
      matrixCards: document.querySelectorAll('#outcomeMatrix > *').length,
    }));
    // The deck must generate for every one of these too.
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }).catch(() => null),
      page.click('#reviewMode').catch(() => {}),
    ]);
    if (dl) {
      const out = path.join(root, 'test', 'edge-deck.html');
      await dl.saveAs(out);
      const deck = fs.readFileSync(out, 'utf8');
      result.deckSlides = (deck.match(/class="deck-slide[ \"]/g) || []).length;
      result.deckBytes = deck.length;
      result.deckNaN = /NaN|undefined|Infinity/.test(deck);
    } else {
      result.deckSlides = 0;
    }
  } catch (e) {
    errs.push('HARNESS: ' + e.message);
  }
  const bad = errs.length > 0 || result.deckSlides !== 8 || result.deckNaN;
  if (bad) failures += 1;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${c.name}`);
  console.log(`        ${JSON.stringify(result)}`);
  if (errs.length) errs.slice(0, 3).forEach(e => console.log('        ERR ' + e));
  await page.close();
}

await browser.close();
console.log(`\n${CASES.length - failures}/${CASES.length} cases clean`);
process.exit(failures ? 1 : 0);
