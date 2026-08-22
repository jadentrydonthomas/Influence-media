// The year-over-year chapter of the deck: only present with a prior period,
// and every slide must fit the way the first nine do.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import os from 'os';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yoy-deck-'));
const prior = [1, 2].map(n => { const d = path.join(tmp, `Week ${n} - 2025.xlsm`); fs.copyFileSync(w(n), d); return d; });
const priorOrder = path.join(tmp, 'OrderLog_prior.xlsx'); fs.copyFileSync(ORDER, priorOrder);

const fails = []; const check = (n, c, d) => { if (!c) fails.push(n); console.log((c ? 'ok   ' : 'FAIL ') + n + (d ? '  ' + d : '')); };
const b = await chromium.launch({ executablePath: CHROME });

async function buildDeck(withPrior) {
  const app = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await app.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await app.setInputFiles('#quoteFiles', [w(1), w(2), w(3)]);
  await app.setInputFiles('#orderFiles', [ORDER]);
  if (withPrior) { await app.setInputFiles('#priorFiles', prior); await app.setInputFiles('#priorOrderFiles', [priorOrder]); }
  await app.click('#runDashboard');
  await app.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  const [dl] = await Promise.all([app.waitForEvent('download', { timeout: 60000 }), app.click('#reviewMode')]);
  const file = path.join(tmp, withPrior ? 'deck-yoy.html' : 'deck-plain.html');
  await dl.saveAs(file);
  await app.close();
  return file;
}

const plain = await buildDeck(false);
check('with no prior period the deck is nine slides and the outro',
  (fs.readFileSync(plain, 'utf8').match(/class="deck-slide[ "]/g) || []).length === 10,
  String((fs.readFileSync(plain, 'utf8').match(/class="deck-slide[ "]/g) || []).length));

const deck = await buildDeck(true);
const html = fs.readFileSync(deck, 'utf8');
// The chapter drops any slide it cannot answer, so its length is a property
// of the data rather than a constant. What has to hold is that the chapter is
// there, sits behind the nine base slides, and closes on its own last word.
const chapterSlides = (html.match(/class="deck-slide[ "]/g) || []).length - 10;
check('with a prior period the chapter is appended', chapterSlides >= 6, chapterSlides + ' chapter slides');
check('the chapter closes rather than stopping', /Where the year leaves us/.test(html));
check('the outro is the last slide of the whole deck',
  html.lastIndexOf('deck-slide is-outro') > html.lastIndexOf('Where the year leaves us'));
check('the deck is still self-contained', !/https?:\/\/(?!www\.w3\.org)/.test(html));

const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + deck);
const total = await p.$$eval('.deck-slide', n => n.length);
check('the counter reads the full deck', new RegExp('1 / ' + total).test(await p.$eval('#deckPage', n => n.textContent)),
  await p.$eval('#deckPage', n => n.textContent.trim()));
check('the chapter divider is marked', await p.$$eval('.deck-slide.is-chapter', n => n.length) === 1);

// Every chapter slide, measured on its own: nothing may leave the slide, sit
// under the nav, or print on top of another line of text.
const problems = [];
for (let i = 9; i < total; i++) {
  await p.evaluate(index => document.querySelectorAll('.deck-slide').forEach((s, j) => s.classList.toggle('is-active', j === index)), i);
  await p.waitForTimeout(320);
  await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  await p.waitForTimeout(360);
  const found = await p.evaluate(index => {
    const out = [];
    const slide = document.querySelectorAll('.deck-slide')[index];
    const sr = slide.getBoundingClientRect();
    slide.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.right > sr.right + 1.5 || r.left < sr.left - 1.5 || r.bottom > sr.bottom + 1.5)
        out.push('slide ' + (index + 1) + ' spill ' + el.tagName + '.' + ((el.className.baseVal || el.className || '') + '').slice(0, 26));
    });
    const nav = document.querySelector('.deck-nav');
    if (nav) {
      const nr = nav.getBoundingClientRect();
      const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (!r.width || !r.height) continue;
          if (r.right > nr.left && r.left < nr.right && r.bottom > nr.top && r.top < nr.bottom)
            out.push('slide ' + (index + 1) + ' under nav: "' + node.nodeValue.trim().slice(0, 30) + '"');
        }
      }
    }
    // SVG labels are placed by hand, so they are the ones that can collide.
    const texts = [...slide.querySelectorAll('svg text')].map(t => ({ t: t, r: t.getBoundingClientRect() })).filter(e => e.r.width && e.r.height);
    for (let a = 0; a < texts.length; a++) for (let c = a + 1; c < texts.length; c++) {
      const x = texts[a].r, y = texts[c].r;
      const ox = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      const oy = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (ox > 1.5 && oy > 1.5) out.push('slide ' + (index + 1) + ' text overlap: "' + texts[a].t.textContent.slice(0, 18) + '" / "' + texts[c].t.textContent.slice(0, 18) + '"');
    }
    return out;
  }, i);
  problems.push(...found);
  await p.evaluate(index => document.querySelectorAll('.deck-slide').forEach((s, j) => s.classList.toggle('is-active', j === index)), i);
  await p.waitForTimeout(220);
  await p.screenshot({ path: path.join(root, 'test', `deck-yoy-${i + 1}.png`) });
}
check('every chapter slide holds its own slide', problems.length === 0, problems.slice(0, 6).join(' | '));

// A prior period wider than this one is where churn actually appears, and the
// account slide has to carry names rather than an empty state.
const wide = [1, 2, 3].map(n => { const d = path.join(tmp, `Week ${n} - 2025.xlsm`); fs.copyFileSync(w(n), d); return d; });
{
  const app = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await app.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await app.setInputFiles('#quoteFiles', [w(1), w(2)]);
  await app.setInputFiles('#orderFiles', [ORDER]);
  await app.setInputFiles('#priorFiles', wide);
  await app.setInputFiles('#priorOrderFiles', [priorOrder]);
  await app.click('#runDashboard');
  await app.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  const [dl2] = await Promise.all([app.waitForEvent('download', { timeout: 60000 }), app.click('#reviewMode')]);
  const churnDeck = path.join(tmp, 'deck-churn.html');
  await dl2.saveAs(churnDeck);
  await app.close();
  const q = await b.newPage({ viewport: { width: 1440, height: 900 } });
  q.on('pageerror', e => errs.push(e.message));
  await q.goto('file://' + churnDeck);
  const total2 = await q.$$eval('.deck-slide', n => n.length);
  // The kept-and-lost slide sits one before the last; it is the one that must
  // name names when there is churn to name.
  await q.evaluate(index => document.querySelectorAll('.deck-slide').forEach((s, j) => s.classList.toggle('is-active', j === index)), total2 - 2);
  await q.waitForTimeout(500);
  const rows = await q.$$eval('.acct-slide-table tbody tr', n => n.length);
  check('the account slide names who went quiet when there is churn', rows > 0, rows + ' named');
  const problems2 = await q.evaluate(index => {
    const out = [];
    const slide = document.querySelectorAll('.deck-slide')[index];
    const sr = slide.getBoundingClientRect();
    slide.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.right > sr.right + 1.5 || r.left < sr.left - 1.5 || r.bottom > sr.bottom + 1.5))
        out.push(el.tagName + '.' + ((el.className.baseVal || el.className || '') + '').slice(0, 22));
    });
    const texts = [...slide.querySelectorAll('svg text')].map(t => ({ t: t, r: t.getBoundingClientRect() })).filter(e => e.r.width && e.r.height);
    for (let a = 0; a < texts.length; a++) for (let c = a + 1; c < texts.length; c++) {
      const x = texts[a].r, y = texts[c].r;
      if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1.5)
        out.push('overlap "' + texts[a].t.textContent.slice(0, 14) + '" / "' + texts[c].t.textContent.slice(0, 14) + '"');
    }
    return out.slice(0, 4);
  }, total2 - 2);
  check('the populated account slide holds its own slide', problems2.length === 0, problems2.join(' | '));
  await q.screenshot({ path: path.join(root, 'test', 'deck-yoy-churn.png') });
  await q.close();
}

const chapterText = await p.evaluate(() => [...document.querySelectorAll('.deck-slide')].slice(9).map(s => s.innerText.replace(/\s+/g, ' ')).join(' | '));
check('the chapter names both periods', /2026/.test(chapterText) && /2025/.test(chapterText));
check('the chapter says what it matched on', /Matched on/i.test(chapterText));
check('no chapter figure resolves to NaN', !/NaN|undefined/.test(chapterText), (chapterText.match(/.{0,30}(NaN|undefined).{0,30}/) || [])[0] || '');
check('no JS errors in the deck', errs.length === 0, errs.slice(0, 2).join('; '));

await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'The year-over-year chapter builds, fits, and only appears when it can.'));
process.exit(fails.length ? 1 : 0);
