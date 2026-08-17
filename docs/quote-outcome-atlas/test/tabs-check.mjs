// Screenshots every analysis tab in both themes and reports JS errors.
import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1500,height:1050}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.click('[data-screen="data"]');
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.click('[data-screen="overview"]'); await p.waitForTimeout(900);
const tabs = await p.$$eval('[data-analysis]', ns=>ns.map(n=>n.dataset.analysis));
console.log('tabs:', tabs.join(', '));
for (const t of tabs) {
  await p.click(`[data-analysis="${t}"]`);
  await p.waitForTimeout(700);
  const el = await p.$('.analysis-panel');
  await el.screenshot({path:path.join(root,'test',`tab-${t}.png`)});
  const txt = await p.$eval('#analysisBody', n=>n.innerText.replace(/\s+/g,' ').slice(0,150));
  console.log(`  ${t}: ${txt}`);
}
// dark theme sanity
await p.click('#themeButton'); await p.waitForTimeout(700);
await p.click('[data-analysis="bands"]'); await p.waitForTimeout(600);
await p.screenshot({path:path.join(root,'test','dark-overview.png')});
console.log('JS errors:', errs.length?errs:'none');
await b.close();
