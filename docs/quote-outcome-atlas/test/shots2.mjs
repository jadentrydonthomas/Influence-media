import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1512,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
for (const s of (process.argv[2]||'customers,timeline,people').split(',')) {
  await p.click(`[data-screen="${s}"]`); await p.waitForTimeout(900);
  await p.screenshot({path:path.join(root,'test',`n-${s}.png`), fullPage:true});
}
console.log('errors:', errs.length?errs:'none');
await b.close();
