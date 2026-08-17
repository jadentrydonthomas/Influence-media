import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1440,height:900}});
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
for (const n of [1,4,12,26,52]) {
  const r = await p.evaluate((count)=>{
    const weekly=[];
    for(let i=1;i<=count;i++) weekly.push({week:'W'+i,sort:i,quotes:20+((i*7)%60),orders:i%5,rate:(i*3)%22,onTime:(i*9)%100,onTimeScored:i%3!==0});
    const svg = window.__reportWeeklySvg(weekly);
    const box=document.createElement('div'); box.style.width='1100px'; box.innerHTML=svg; document.body.appendChild(box);
    const el=box.querySelector('svg');
    const labels=[...box.querySelectorAll('text.week')].map(t=>t.getBoundingClientRect());
    let overlaps=0;
    for(let i=1;i<labels.length;i++) if(labels[i].left < labels[i-1].right) overlaps++;
    const vb=el.getAttribute('viewBox');
    box.remove();
    return {weeks:count, viewBox:vb, labelsDrawn:labels.length, labelOverlaps:overlaps};
  }, n);
  console.log(JSON.stringify(r));
}
await b.close();
