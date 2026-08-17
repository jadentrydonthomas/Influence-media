import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1440,height:900}});
await p.goto('file://'+path.join(root,'test','deck-out.html'));
for (let i=0;i<4;i++) await p.keyboard.press('ArrowRight');
await p.waitForTimeout(1200);
const r = await p.evaluate(()=>{
  const d=document.querySelector('.deck-slide.is-active .timing-disc');
  const h=document.querySelector('.hero-disc');
  const g=el=>el?{inline:el.getAttribute('style'),
    timing:getComputedStyle(el).getPropertyValue('--deck-timing'),
    conv:getComputedStyle(el).getPropertyValue('--deck-conversion'),
    bg:getComputedStyle(el).backgroundImage.slice(0,120)}:null;
  return {timingDisc:g(d), heroDisc:g(h)};
});
console.log(JSON.stringify(r,null,2));
await b.close();
