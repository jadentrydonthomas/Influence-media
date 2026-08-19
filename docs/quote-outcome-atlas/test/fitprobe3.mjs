import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1280,height:720}});
await p.goto('file://'+path.join(root,'test','deck-out.html'));
await p.waitForTimeout(500);
await p.evaluate(()=>{
  const grow=t=>t.replace(/\d[\d,]*(\.\d+)?/g,w=>{const[i,f]=w.replace(/,/g,'').split('.');const b=String(Number(i)*947+682).replace(/\B(?=(\d{3})+(?!\d))/g,',');return f===undefined?b:b+'.'+f;});
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const seen=[];let t;while((t=w.nextNode()))seen.push(t);
  seen.forEach(t=>{if(t.nodeValue&&/\d/.test(t.nodeValue))t.nodeValue=grow(t.nodeValue);});
  window.dispatchEvent(new Event('resize'));
});
await p.waitForTimeout(500);
for (const i of [2,7]) {
  await p.evaluate(n=>document.querySelectorAll('.deck-slide').forEach((s,j)=>s.classList.toggle('is-active',j===n)), i);
  await p.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await p.waitForTimeout(350);
  console.log(i+1, await p.evaluate(n=>{
    const s=document.querySelectorAll('.deck-slide')[n];
    const box=s.querySelector('.deck-content'), inner=s.querySelector('.deck-fit');
    return {avail:box.clientHeight, need:inner.scrollHeight, t:inner.style.transform, fitted:s.classList.contains('is-fitted'),
      innerBottom:Math.round(inner.getBoundingClientRect().bottom), boxBottom:Math.round(box.getBoundingClientRect().bottom)};
  }, i));
}
await b.close();
