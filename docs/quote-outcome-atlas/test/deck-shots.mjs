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
  await p.evaluate(()=>window.scrollTo(0,0));
  await p.screenshot({path:path.join(root,'test',`deck-${i+1}.png`)});
}
// Audited one slide at a time. A hidden slide measures as zero, so auditing
// them all at once only ever checked whichever slide happened to be active -
// which is how a callout ended up sitting under the nav unnoticed.
const spills=[]; const collisions=[];
for (let i=0;i<n;i++){
  await p.evaluate(index=>{
    const slides=document.querySelectorAll('.deck-slide');
    slides.forEach((s,j)=>s.classList.toggle('is-active', j===index));
  }, i);
  await p.waitForTimeout(120);
  const one = await p.evaluate(index=>{
    const out={spills:[],collisions:[]};
    const s=document.querySelectorAll('.deck-slide')[index];
    const sr=s.getBoundingClientRect();
    s.querySelectorAll('*').forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width===0||r.height===0) return;
      if(r.right>sr.right+1.5||r.left<sr.left-1.5||r.bottom>sr.bottom+1.5)
        out.spills.push({slide:index+1,tag:el.tagName,cls:(el.className.baseVal||el.className||'').toString().slice(0,34)});
    });
    // Measured on the text itself, not on its container. A callout's own box
    // starts at the left margin and never reaches the nav, so element rects
    // missed a line of running text sitting right under it.
    const nav=document.querySelector('.deck-nav');
    if(nav){
      const nr=nav.getBoundingClientRect();
      const walker=document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        if(!node.nodeValue || !node.nodeValue.trim()) continue;
        const range=document.createRange();
        range.selectNodeContents(node);
        Array.prototype.forEach.call(range.getClientRects(), r=>{
          if(r.width===0||r.height===0) return;
          if(r.right>nr.left && r.left<nr.right && r.bottom>nr.top && r.top<nr.bottom)
            out.collisions.push({slide:index+1,tag:(node.parentElement||{}).tagName,text:node.nodeValue.trim().slice(0,42)});
        });
      }
      // SVG text has no useful Range boxes, so it is still checked by element.
      s.querySelectorAll('text').forEach(el=>{
        const r=el.getBoundingClientRect();
        if(r.width===0||r.height===0) return;
        if(r.right>nr.left && r.left<nr.right && r.bottom>nr.top && r.top<nr.bottom)
          out.collisions.push({slide:index+1,tag:'text',text:(el.textContent||'').trim().slice(0,42)});
      });
    }
    return out;
  }, i);
  spills.push(...one.spills); collisions.push(...one.collisions);
}
const audit = { spills: spills.slice(0,20), collisions: collisions.slice(0,20),
  bodyScroll: await p.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth) };
console.log('slides:',n,'| horizontal scroll:',audit.bodyScroll);
console.log('spills outside slide:',audit.spills.length); audit.spills.forEach(x=>console.log('   ',JSON.stringify(x)));
console.log('text under the nav:',audit.collisions.length); audit.collisions.forEach(x=>console.log('   ',JSON.stringify(x)));
console.log('JS errors:',errs.length?errs:'none');
const bad = audit.spills.length + audit.collisions.length + (audit.bodyScroll>0?1:0) + errs.length;
await b.close();
process.exit(bad?1:0);
