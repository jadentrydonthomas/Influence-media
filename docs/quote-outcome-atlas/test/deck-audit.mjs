// Every slide of the real-data deck, measured for what the stress test does not
// look at: a figure that formatted to nothing, a slide whose body never drew,
// and a slide the fit had to shrink so far that a room cannot read it.
//
// It needs the real books in fixtures/yoy, which never enter this repository,
// so it skips rather than fails when they are not there.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import os from 'os';
import { openReal, haveReal } from './yoy-real.mjs';
if (!haveReal()) { console.log('real year-over-year fixtures not present, skipping'); process.exit(0); }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const app = await openReal(b, { width: 1440, height: 900 });
const [dl] = await Promise.all([app.waitForEvent('download', { timeout: 90000 }), app.click('#reviewMode')]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-audit-'));
const deck = path.join(tmp, 'deck.html');
await dl.saveAs(deck);
await app.close();

const findings = [];
const jsErrors = [];
// A projector is 1920 wide and a laptop is 1366; a slide that only fits on one
// of them is not a deck that can be handed over.
for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768]]) {
  const p = await b.newPage({ viewport: { width, height } });
  p.on('pageerror', error => jsErrors.push(width + 'x' + height + ': ' + error.message));
  await p.goto('file://' + deck);
  const count = await p.$$eval('.deck-slide', slides => slides.length);
  for (let index = 0; index < count; index += 1) {
    await p.evaluate(at => document.querySelectorAll('.deck-slide').forEach((slide, j) => slide.classList.toggle('is-active', j === at)), index);
    await p.waitForTimeout(180);
    await p.evaluate(() => window.dispatchEvent(new Event('resize')));
    await p.waitForTimeout(300);
    const out = await p.evaluate(at => {
      const slide = document.querySelectorAll('.deck-slide')[at];
      const problems = [];
      const bad = slide.innerText.match(/\$0\.0M|\bNaN\b|\bundefined\b|\bInfinity\b|—%|\bnull\b|\$-/g);
      if (bad) problems.push('formatting: ' + [...new Set(bad)].join(', '));
      slide.querySelectorAll('.deck-empty').forEach(node => problems.push('empty: ' + node.textContent.trim().slice(0, 60)));
      const fit = slide.querySelector('.deck-fit');
      if (fit && fit.innerText.trim().length < 60) problems.push('almost no content on the slide');
      const scale = fit && fit.style.transform ? Number((fit.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || 1) : 1;
      if (scale < 0.72) problems.push('fit scaled to ' + scale.toFixed(2) + ', too much on the slide');
      return { slide: at + 1, eyebrow: ((slide.querySelector('header span') || {}).innerText || '').trim(), problems };
    }, index);
    if (out.problems.length) findings.push(Object.assign(out, { at: width + 'x' + height }));
  }
  console.log('audited', count, 'slides at', width + 'x' + height);
  await p.close();
}
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });

findings.forEach(item => {
  console.log('  ' + item.at + '  slide ' + item.slide + ' · ' + item.eyebrow);
  item.problems.forEach(problem => console.log('      ' + problem));
});
if (jsErrors.length) jsErrors.slice(0, 6).forEach(message => console.log('  JS ERROR ' + message));
console.log(findings.length || jsErrors.length
  ? '\n' + findings.length + ' slide(s) carry a defect and ' + jsErrors.length + ' JS error(s).'
  : '\nEvery slide of the real-data deck is readable and complete at three projector widths.');
process.exit(findings.length || jsErrors.length ? 1 : 0);
