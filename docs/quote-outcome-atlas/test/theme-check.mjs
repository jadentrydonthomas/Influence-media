// Confirms the new panels use real theme tokens in both themes.
import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1500,height:1050}});
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.click('[data-screen="data"]');
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.click('[data-screen="overview"]'); await p.waitForTimeout(600);
for (const theme of ['light','dark']) {
  if (theme==='dark') { await p.click('#themeButton'); await p.waitForTimeout(600); }
  for (const tab of ['bands','districts']) {
    await p.click(`[data-analysis="${tab}"]`); await p.waitForTimeout(500);
    const c = await p.evaluate(()=>{
      const tr=document.querySelector('.segment-track');
      const lbl=document.querySelector('.segment-row > span');
      const note=document.querySelector('.segment-row > small');
      const g=el=>el?getComputedStyle(el):null;
      return {track:g(tr)&&g(tr).backgroundColor, label:g(lbl)&&g(lbl).color, note:g(note)&&g(note).color,
              panel:getComputedStyle(document.querySelector('.analysis-panel')).backgroundColor};
    });
    console.log(theme, tab, JSON.stringify(c));
    await (await p.$('.analysis-panel')).screenshot({path:path.join(root,'test',`${theme}-${tab}.png`)});
  }
}
await b.close();
