// The rail carries seven screens plus the export button. On a 1366x768
// laptop it used to clip the last two silently. Every item must be reachable.
import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fails=[]; const check=(n,c,d)=>{ if(!c) fails.push(n); console.log((c?'ok   ':'FAIL ')+n+(d?'  '+d:'')); };
const b = await chromium.launch({executablePath:CHROME});
for (const [w,h] of [[1366,768],[1280,720],[1440,900],[1920,1080],[1024,640]]) {
  const p = await b.newPage({viewport:{width:w,height:h}});
  await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
  await p.waitForTimeout(200);
  const state = await p.evaluate(()=>{
    const rail = document.querySelector('.rail');
    const rr = rail.getBoundingClientRect();
    const items = [...document.querySelectorAll('.rail-nav button'), document.querySelector('#reviewMode')];
    return {
      scrollable: rail.scrollHeight > rail.clientHeight + 1,
      hidden: items.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > rr.bottom + 1; }).map(el => el.textContent.trim()),
    };
  });
  // Reachable means either visible without scrolling, or reachable by scrolling.
  const afterScroll = await p.evaluate(()=>{
    const rail = document.querySelector('.rail');
    rail.scrollTop = rail.scrollHeight;
    const rr = rail.getBoundingClientRect();
    const items = [...document.querySelectorAll('.rail-nav button'), document.querySelector('#reviewMode')];
    return items.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > rr.bottom + 1 || r.top < rr.top - 1; }).map(el => el.textContent.trim());
  });
  check(`${w}x${h}: every rail item is reachable`, afterScroll.length===0, afterScroll.join(', '));
  // Reachable is the floor; at these sizes nothing should need scrolling at all.
  check(`${w}x${h}: nothing is clipped before scrolling`, state.hidden.length===0, state.hidden.join(', '));
  console.log(`      ${w}x${h} needs scrolling: ${state.scrollable} | clipped before scroll: ${state.hidden.length?state.hidden.join(', '):'none'}`);
  await p.close();
}
await b.close();
console.log('\n'+(fails.length?'FAILURES:\n  '+fails.join('\n  '):'The rail reaches every screen at every tested size.'));
process.exit(fails.length?1:0);
