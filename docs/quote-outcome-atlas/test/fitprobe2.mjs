import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1440,height:900}});
await p.goto('file://'+path.join(root,'test','deck-out.html'));
await p.waitForTimeout(600);
await p.evaluate(()=>document.querySelectorAll('.deck-slide').forEach((s,j)=>s.classList.toggle('is-active', j===5)));
await p.waitForTimeout(300);
console.log(await p.evaluate(()=>{
  const s=document.querySelectorAll('.deck-slide')[5];
  const r=n=>{const e=s.querySelector(n); if(!e) return null; const b=e.getBoundingClientRect(); return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height)};};
  return {slide:r('*')||null, header:r('header'), content:r('.deck-content'), fit:r('.deck-fit'), h1:r('h1'),
    fitted:s.classList.contains('is-fitted'), transform:s.querySelector('.deck-fit').style.transform,
    justify:getComputedStyle(s.querySelector('.deck-content')).justifyContent};
}));
await b.close();
