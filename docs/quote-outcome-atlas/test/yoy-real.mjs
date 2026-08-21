// The real year-over-year pair: Week 2 of 2025 against Week 2 of 2026, each
// joined to its own order log. Every design decision on the Year over year
// screen and the deck chapter is checked against this rather than against a
// week copied twice.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Y = path.join(root, 'fixtures', 'yoy');
export const REAL = {
  live: [path.join(Y, 'Week 2 - 2026.xlsm')],
  liveOrders: [path.join(Y, 'OrderLog - 2026.xlsx')],
  prior: [path.join(Y, 'Week 2 - 2025.xlsm')],
  priorOrders: [path.join(Y, 'OrderLog - 2025.xlsx')]
};
export function haveReal() { return REAL.live.concat(REAL.liveOrders, REAL.prior, REAL.priorOrders).every(f => fs.existsSync(f)); }
export async function openReal(browser, viewport) {
  const p = await browser.newPage({ viewport: viewport || { width: 1512, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await p.setInputFiles('#quoteFiles', REAL.live);
  await p.setInputFiles('#orderFiles', REAL.liveOrders);
  await p.setInputFiles('#priorFiles', REAL.prior);
  await p.setInputFiles('#priorOrderFiles', REAL.priorOrders);
  await p.click('#runDashboard');
  await p.waitForFunction(() => /refreshed|attention/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 150000 });
  await p.waitForTimeout(900);
  p.__errors = errs;
  return p;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!haveReal()) { console.log('real year-over-year fixtures not present, skipping'); process.exit(0); }
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await openReal(b);
  console.log('status :', await p.$eval('#runStatusTitle', n => n.textContent.trim()));
  console.log('stamp  :', await p.$eval('#dataStamp', n => n.textContent.replace(/\s+/g,' ').trim()));
  await p.click('[data-screen="compare"]');
  await p.waitForTimeout(700);
  for (const view of ['headline','momentum','speed','mix','customers','people','ledger']) {
    await p.click(`[data-compare-view="${view}"]`);
    await p.waitForTimeout(650);
    await p.screenshot({ path: path.join(root,'test',`real-${view}.png`), fullPage: true });
  }
  await p.click('[data-compare-view="headline"]'); await p.waitForTimeout(500);
  console.log('lede   :', (await p.$eval('#cmpHeadlineLede', n => n.innerText.replace(/\s+/g,' ').trim())).slice(0, 400));
  await p.click('[data-screen="data"]'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(root,'test','real-identity.png'), fullPage: true });
  console.log('errors :', p.__errors.length ? p.__errors.slice(0,3) : 'none');
  await b.close();
}
