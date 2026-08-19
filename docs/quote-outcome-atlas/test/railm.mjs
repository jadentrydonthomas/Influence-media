import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1366,height:768}});
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
console.log(await p.evaluate(()=>{
  const rail=document.querySelector('.rail');
  const cs=getComputedStyle(rail);
  return {client:rail.clientHeight, scroll:rail.scrollHeight, padding:cs.paddingTop+'/'+cs.paddingBottom,
    parts:[...rail.children].map(c=>({cls:c.className||c.tagName, h:Math.round(c.getBoundingClientRect().height)}))};
}));
await b.close();
