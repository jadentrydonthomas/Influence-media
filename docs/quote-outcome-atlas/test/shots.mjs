import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1366,height:768}});
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.screenshot({path:path.join(root,'test','r-data.png'), fullPage:true});
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.click('#themeButton'); await p.waitForTimeout(500);
for (const s of ['customers','timeline']) {
  await p.click(`[data-screen="${s}"]`); await p.waitForTimeout(700);
  await p.screenshot({path:path.join(root,'test',`r-dark-${s}.png`), fullPage:true});
}
await b.close();
