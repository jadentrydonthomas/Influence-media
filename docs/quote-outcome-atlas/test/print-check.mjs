// The deck tells the room "P to print / save PDF" in its own footer, so what
// comes out of the printer is part of the deliverable. This drives the real
// deck, switches to print media, and checks the page rather than trusting that
// a PDF with bytes in it is a PDF worth handing round.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { openReal, haveReal } from './yoy-real.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fails = [];
const check = (name, ok, detail) => { if (!ok) fails.push(name); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

if (!haveReal()) { console.log('real fixtures not present, skipping'); process.exit(0); }
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'print-'));
const browser = await chromium.launch({ executablePath: CHROME });
const app = await openReal(browser, { width: 1440, height: 900 });
await app.waitForTimeout(1200);
const [download] = await Promise.all([app.waitForEvent('download', { timeout: 90000 }), app.click('#reviewMode')]);
const deckPath = path.join(out, 'deck.html');
await download.saveAs(deckPath);

// Letter landscape at 96dpi.
const page = await browser.newPage({ viewport: { width: 1056, height: 816 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + deckPath);
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(1200);

const slides = await page.$$eval('.deck-slide', nodes => nodes.map((slide, index) => {
  const style = getComputedStyle(slide);
  const fit = slide.querySelector('.deck-fit');
  const footer = slide.querySelector('footer');
  const header = slide.querySelector('header');
  const box = slide.getBoundingClientRect();
  return {
    n: index + 1,
    display: style.display,
    direction: style.flexDirection,
    width: Math.round(box.width),
    // Positive means the content has run into the footer.
    overlap: fit && footer ? Math.round(fit.getBoundingClientRect().bottom - footer.getBoundingClientRect().top) : 0,
    headerAbove: header && fit ? header.getBoundingClientRect().bottom <= fit.getBoundingClientRect().top + 1 : false,
  };
}));

check('every slide prints', slides.length > 8 && slides.every(s => s.display !== 'none'), slides.length + ' slides');
// display:flex was forced on every slide without a direction, so the header,
// the content and the footer laid out as three columns side by side and each
// slide was squeezed into a third of the page.
check('a printed slide stacks its header, content and footer',
  slides.every(s => s.direction === 'column'),
  slides.filter(s => s.direction !== 'column').map(s => s.n + ':' + s.direction).join(' '));
check('the header sits above the content, not beside it',
  slides.every(s => s.headerAbove), slides.filter(s => !s.headerAbove).map(s => s.n).join(' '));
check('a printed slide uses the width of the page',
  slides.every(s => s.width >= 1000), slides.filter(s => s.width < 1000).map(s => s.n + ':' + s.width).join(' '));
check('no slide runs its content into its own footer',
  slides.every(s => s.overlap <= 0), slides.filter(s => s.overlap > 0).map(s => s.n + ':+' + s.overlap).join(' '));

// "Use ← → to move" is a screen instruction; on paper it is noise.
const navHint = await page.$$eval('.deck-slide footer span:last-child', nodes =>
  nodes.filter(n => getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none').length);
check('the keyboard hint does not print', navHint === 0, navHint + ' still visible');
const nav = await page.$$eval('.deck-nav', nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').length);
check('the navigation bar does not print', nav === 0);

const pdfPath = path.join(out, 'deck.pdf');
await page.pdf({ path: pdfPath, format: 'Letter', landscape: true, printBackground: true });
const bytes = fs.readFileSync(pdfPath);
const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
check('the PDF carries one page per slide', pages === slides.length, pages + ' pages for ' + slides.length + ' slides');
check('the PDF is not empty', bytes.length > 200000, bytes.length + ' bytes');
check('no JS errors under print', errs.length === 0, errs.slice(0, 2).join('; '));

await browser.close();
fs.rmSync(out, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'The deck prints as one readable page per slide.'));
process.exit(fails.length ? 1 : 0);
