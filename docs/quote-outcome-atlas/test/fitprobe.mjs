import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1440,height:900}});
await p.goto('file://'+path.join(root,'test','deck-out.html'));
await p.waitForTimeout(600);
console.log(await p.evaluate(()=>[...document.querySelectorAll('.deck-slide')].map((s,i)=>{
  const box=s.querySelector('.deck-content'), inner=s.querySelector('.deck-fit');
  return {n:i+1, avail:box.clientHeight, need:inner.scrollHeight, rect:Math.round(inner.getBoundingClientRect().height), t:inner.style.transform||'none'};
})));
await b.close();
