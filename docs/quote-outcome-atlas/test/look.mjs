// Writes a screenshot of every screen, every year-over-year view and every
// deck slide, driven on the real books. Nothing here asserts: the assertions
// live in the audits. This exists because the defects that survive the audits
// are the ones only a person looking at the screen can see — a shape that
// carries a finding and never states it, a legend in a colour its chart has
// not got, a figure that quietly disagrees with another.
//
//   node test/look.mjs [outputDirectory]
//
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { openReal, haveReal } from './yoy-real.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(root, 'test', 'look');
if (!haveReal()) { console.log('real year-over-year fixtures not present, skipping'); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await openReal(browser, { width: 1512, height: 982 });
await page.waitForTimeout(1500);

const screens = await page.$$eval('[data-screen]', nodes => nodes.map(n => n.getAttribute('data-screen')));
for (const screen of screens) {
  await page.click(`[data-screen="${screen}"]`);
  await page.waitForTimeout(1000);
  if (screen !== 'compare') {
    await page.screenshot({ path: path.join(OUT, `screen-${screen}.png`), fullPage: true });
    console.log('screen-' + screen);
    continue;
  }
  const views = await page.$$eval('[data-compare-view]', nodes => nodes.map(n => n.getAttribute('data-compare-view')));
  for (const view of views) {
    await page.click(`[data-compare-view="${view}"]`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `year-${view}.png`), fullPage: true });
    console.log('year-' + view);
  }
}

// The deck as the room sees it: one projector-shaped frame per slide.
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#reviewMode')]);
const deckPath = path.join(OUT, 'deck.html');
await download.saveAs(deckPath);
const deck = await browser.newPage({ viewport: { width: 1440, height: 810 } });
await deck.goto('file://' + deckPath);
await deck.waitForTimeout(900);
const slides = await deck.$$eval('.deck-slide', nodes => nodes.length);
for (let i = 1; i <= slides; i += 1) {
  await deck.evaluate(index => {
    document.querySelectorAll('.deck-slide').forEach((slide, j) => slide.classList.toggle('is-active', j === index - 1));
    window.dispatchEvent(new Event('resize'));
  }, i);
  await deck.waitForTimeout(1200);
  await deck.screenshot({ path: path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`) });
}
console.log('slides', slides);
console.log('JS errors:', page.__errors.join(' | ') || 'none');
await browser.close();
console.log('\nwritten to ' + OUT);
