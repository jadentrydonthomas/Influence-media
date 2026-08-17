import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1512,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.click('[data-screen="data"]');
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.click('[data-screen="people"]'); await p.waitForTimeout(700);
for (const m of ['conversion','onTime']) {
  await p.click(`[data-team-metric="${m}"]`); await p.waitForTimeout(600);
  const el = await p.$('.team-chart-panel');
  await el.screenshot({path:path.join(root,'test',`ci-${m}.png`)});
  const title = await p.$eval('#teamChartTitle', n=>n.textContent);
  console.log(m, '->', title);
}
console.log('JS errors:', errs.length?errs:'none');
await b.close();
