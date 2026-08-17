// Regenerates the deck from the live dashboard, then screenshots every slide
// and audits for overflow. Always shoots the current build, never a stale file.
import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const app = await b.newPage({viewport:{width:1440,height:900}});
await app.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await app.click('[data-screen="data"]');
await app.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await app.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await app.click('#runDashboard');
await app.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
const [dl] = await Promise.all([app.waitForEvent('download',{timeout:40000}), app.click('#reviewMode')]);
const deck = path.join(root,'test','deck-out.html');
await dl.saveAs(deck);
await app.close();

const p = await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+deck);
const n = await p.$$eval('.deck-slide', s=>s.length);
for (let i=0;i<n;i++){
  if(i>0) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1500);
  await p.screenshot({path:path.join(root,'test',`deck-${i+1}.png`)});
}
const audit = await p.evaluate(()=>{
  const spills=[]; const collisions=[];
  document.querySelectorAll('.deck-slide').forEach((s,i)=>{
    const sr=s.getBoundingClientRect();
    s.querySelectorAll('*').forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width===0||r.height===0) return;
      if(r.right>sr.right+1.5||r.left<sr.left-1.5||r.bottom>sr.bottom+1.5)
        spills.push({slide:i+1,tag:el.tagName,cls:(el.className.baseVal||el.className||'').toString().slice(0,34)});
    });
    // Does any slide text run underneath the fixed nav?
    const nav=document.querySelector('.deck-nav');
    if(nav && s.classList.contains('is-active')){
      const nr=nav.getBoundingClientRect();
      s.querySelectorAll('p,td,span,text,small,h1,h2').forEach(el=>{
        const r=el.getBoundingClientRect();
        if(r.width===0||r.height===0) return;
        if(r.right>nr.left && r.left<nr.right && r.bottom>nr.top && r.top<nr.bottom)
          collisions.push({slide:i+1,tag:el.tagName,text:(el.textContent||'').trim().slice(0,42)});
      });
    }
  });
  return {spills:spills.slice(0,20), collisions:collisions.slice(0,20),
          bodyScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth};
});
console.log('slides:',n,'| horizontal scroll:',audit.bodyScroll);
console.log('spills outside slide:',audit.spills.length); audit.spills.forEach(x=>console.log('   ',JSON.stringify(x)));
console.log('text under the nav:',audit.collisions.length); audit.collisions.forEach(x=>console.log('   ',JSON.stringify(x)));
console.log('JS errors:',errs.length?errs:'none');
await b.close();
