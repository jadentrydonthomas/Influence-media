import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1512,height:950}});
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.click('[data-screen="data"]');
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.waitForTimeout(2200);
// Every screen the rail can actually reach. The old list still named a
// "quotes" screen that was folded into Customers, so this walks the rail
// rather than a copy of it that can rot.
const screens = await p.$$eval('[data-screen]', nodes => nodes.map(n => n.getAttribute('data-screen')));
for (const s of screens) {
  await p.click(`[data-screen="${s}"]`);
  await p.waitForTimeout(1100);
  await p.screenshot({path:path.join(root,'test',`screen-${s}.png`), fullPage:true});
  const h = await p.evaluate(()=>document.querySelector('.screen.is-active').scrollHeight);
  console.log(s, 'height', h);
}
await b.close();
