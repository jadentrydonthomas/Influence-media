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

// Every slide's footer advertises the keyboard. A promise printed on
// eighteen pages is worth an assertion.
{
  const keys = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  await keys.goto('file://' + deckPath);
  await keys.waitForTimeout(700);
  const at = () => keys.$eval('.deck-nav', n => (n.textContent.match(/(\d+)\s*\/\s*(\d+)/) || [])[0] || '?');
  const start = await at();
  await keys.keyboard.press('ArrowRight'); await keys.waitForTimeout(300);
  const forward = await at();
  await keys.keyboard.press('ArrowLeft'); await keys.waitForTimeout(300);
  const back = await at();
  await keys.keyboard.press('End'); await keys.waitForTimeout(300);
  const end = await at();
  check('the arrow keys move the deck', forward !== start && back === start, `${start} → ${forward} → ${back}`);
  check('End reaches the last slide', /^18 \/ 18$|^\d+ \/ \1$/.test(end) || end.split('/').map(x => x.trim()).every((v, i, a) => a[0] === a[1]), end);
  await keys.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  await keys.keyboard.press('p'); await keys.waitForTimeout(300);
  check('P asks the browser to print, as the footer says it will',
    await keys.evaluate(() => window.__printed) === 1);
  await keys.close();
}

const pdfPath = path.join(out, 'deck.pdf');
await page.pdf({ path: pdfPath, format: 'Letter', landscape: true, printBackground: true });
const bytes = fs.readFileSync(pdfPath);
const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
check('the PDF carries one page per slide', pages === slides.length, pages + ' pages for ' + slides.length + ' slides');
check('the PDF is not empty', bytes.length > 200000, bytes.length + ' bytes');
check('no JS errors under print', errs.length === 0, errs.slice(0, 2).join('; '));

// The dashboard does not advertise printing, but Ctrl-P is a reflex in a shop
// that reads printed reports, and what came out was four pages with a black
// rail down the side of every one and text clipped at the panel edges.
{
  const dash = await openReal(browser, { width: 1056, height: 816 });
  await dash.waitForTimeout(1300);
  await dash.click('[data-screen="overview"]');
  await dash.waitForTimeout(700);
  await dash.emulateMedia({ media: 'print' });
  await dash.waitForTimeout(700);
  const shell = await dash.evaluate(() => {
    const bg = el => el ? getComputedStyle(el).backgroundColor : '';
    const opaque = value => {
      const m = (value || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return false;
      const parts = m[1].split(',').map(Number);
      if (parts.length > 3 && parts[3] === 0) return false;
      // Anything this dark is a slab of ink on paper.
      return (parts[0] + parts[1] + parts[2]) / 3 < 110;
    };
    const hidden = sel => [...document.querySelectorAll(sel)]
      .every(n => getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden');
    const main = document.querySelector('.main');
    return {
      railDark: opaque(bg(document.querySelector('.rail'))),
      stageDark: opaque(bg(document.querySelector('.flow-stage'))) || opaque(bg(document.querySelector('.outcome-section'))),
      discDark: opaque(getComputedStyle(document.querySelector('.conversion-disc'), '::before').backgroundColor),
      navHidden: hidden('.rail-nav'),
      exportHidden: hidden('.review-mode'),
      themeHidden: hidden('.masthead-actions'),
      pointerHidden: hidden('.pointer-ring'),
      mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
    };
  });
  check('the rail does not print as a black column', !shell.railDark);
  check('the dark hero panel prints in ink, not as a slab', !shell.stageDark);
  check('the conversion dial prints as a ring, not a filled disc', !shell.discDark);
  check('screen-only navigation does not print', shell.navHidden);
  check('the export button does not print', shell.exportHidden);
  check('the theme toggle does not print', shell.themeHidden);
  check('the custom pointer does not print', shell.pointerHidden);
  check('the report uses the width of the sheet', shell.mainWidth >= 1000, shell.mainWidth + 'px');
  // Nothing is readable if it is white on white.
  const invisible = await dash.evaluate(() => {
    const near = (a, b) => Math.abs(a - b) < 26;
    const rgb = value => (value.match(/\d+/g) || []).map(Number);
    return [...document.querySelectorAll('.rail *, .flow-stage *, .outcome-section *')]
      .filter(n => n.children.length === 0 && n.textContent.trim())
      .filter(n => {
        const c = rgb(getComputedStyle(n).color);
        return c.length >= 3 && near(c[0], 255) && near(c[1], 255) && near(c[2], 255);
      })
      .slice(0, 4).map(n => n.textContent.trim().slice(0, 24));
  });
  check('no text prints white on white paper', invisible.length === 0, invisible.join(' | '));
  await dash.close();
}

await browser.close();
fs.rmSync(out, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'The deck prints as one readable page per slide, and so does the dashboard.'));
process.exit(fails.length ? 1 : 0);
