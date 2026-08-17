// Clicks every interactive control and reports which ones change nothing.
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
await p.waitForTimeout(800);

for (const screen of ['overview','people','quotes','data']) {
await p.click(`[data-screen="${screen}"]`);
await p.waitForTimeout(500);
console.log(`\n===== SCREEN: ${screen} =====`);
const controls = await p.$$eval('button, [role="button"], select, input[type="search"]', ns => ns.map((n,i)=>{
  n.setAttribute('data-audit-id', String(i));
  const r=n.getBoundingClientRect();
  return {id:i, tag:n.tagName, text:(n.textContent||n.value||'').trim().slice(0,34),
          cls:(n.className||'').toString().slice(0,30), visible:r.width>0&&r.height>0,
          attrs:[...n.attributes].map(a=>a.name).filter(a=>a.startsWith('data-')&&a!=='data-audit-id').join(',')};
}));
console.log('total controls:', controls.length, '| visible:', controls.filter(c=>c.visible).length);

const dead=[];
for (const c of controls) {
  if (!c.visible) continue;
  if (c.attrs.includes('data-screen')) continue;
  const before = await p.evaluate(()=>document.querySelector('.app').innerHTML.length + '|' + document.body.innerText.length);
  try { await p.click(`[data-audit-id="${c.id}"]`, {timeout:2500}); } catch(e){ continue; }
  await p.waitForTimeout(320);
  const after = await p.evaluate(()=>document.querySelector('.app').innerHTML.length + '|' + document.body.innerText.length);
  const ariaChanged = await p.evaluate((id)=>{const n=document.querySelector(`[data-audit-id="${id}"]`);return n?n.getAttribute('aria-pressed'):null;}, c.id);
  if (before === after && ariaChanged !== 'true') dead.push({...c, ariaPressed:ariaChanged});
}
console.log('\nControls whose click changed nothing:', dead.length);
dead.forEach(d=>console.log('   ', JSON.stringify(d)));
}
console.log('\nJS errors:', errs.length?errs:'none');
await b.close();
