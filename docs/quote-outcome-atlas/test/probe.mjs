import { chromium } from 'playwright';
import path from 'path';
const root='/home/user/Influence-media/docs/quote-outcome-atlas';
const FIX=path.join(root,'fixtures');
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
const r=await p.evaluate(()=>{
  const d=window.__scope ? window.__scope() : null; return d;
});
console.log(JSON.stringify(r,null,1).slice(0,1200));
await b.close();
