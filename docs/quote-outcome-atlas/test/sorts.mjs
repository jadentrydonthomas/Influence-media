// Each customer sort must actually change the question being asked, and the
// deck must stay coherent when it is exported from a filtered view.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const fails=[]; const check=(n,c,d)=>{ if(!c) fails.push(n); console.log((c?'ok   ':'FAIL ')+n+(d?'  '+d:'')); };
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:1512,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.click('[data-screen="customers"]'); await p.waitForTimeout(500);

const firstRow = () => p.$eval('#custTable tbody tr', n=>n.innerText.replace(/\s+/g,' ').trim());
const seen = new Map();
for (const sort of ['quotes','value','wins','unreturned','effort']) {
  await p.click(`[data-cust-sort="${sort}"]`); await p.waitForTimeout(350);
  const top = await firstRow();
  const pressed = await p.$eval(`[data-cust-sort="${sort}"]`, n=>n.getAttribute('aria-pressed'));
  const note = await p.$eval('#custTableNote', n=>n.textContent.trim());
  check(`${sort} sort marks itself active`, pressed==='true');
  check(`${sort} sort names the question`, note.length>20, note.slice(0,50));
  seen.set(sort, top);
  console.log('      ' + sort.padEnd(11) + ' top: ' + top.slice(0,60));
}
// Sorting by different measures must not always produce the same leader.
check('sorts disagree with each other', new Set(seen.values()).size >= 3, [...new Set(seen.values())].length + ' distinct leaders');
// Ordering must actually hold, not merely differ.
await p.click('[data-cust-sort="quotes"]'); await p.waitForTimeout(350);
const quotesCol = await p.$$eval('#custTable tbody tr', ns=>ns.map(n=>Number(n.children[2].textContent.trim())));
check('most quotes is ordered by quotes', quotesCol.every((v,i)=>i===0||quotesCol[i-1]>=v), quotesCol.slice(0,6).join(','));
await p.click('[data-cust-sort="effort"]'); await p.waitForTimeout(350);
const hoursCol = await p.$$eval('#custTable tbody tr', ns=>ns.map(n=>Number(n.children[10].textContent.trim())));
check('most engineering time is ordered by hours', hoursCol.every((v,i)=>i===0||hoursCol[i-1]>=v), hoursCol.slice(0,6).join(','));

// --- Export the deck from a filtered view.
await p.click('[data-screen="overview"]'); await p.waitForTimeout(300);
await p.click('[data-analysis="districts"]'); await p.waitForTimeout(400);
const d = await p.$eval('[data-filter="district"]', n=>n.dataset.filterValue);
await p.click(`[data-filter="district"][data-filter-value="${d}"]`); await p.waitForTimeout(700);
const railFiltered = await p.$eval('#railQuoted', n=>n.textContent.trim());
const [dl] = await Promise.all([p.waitForEvent('download',{timeout:40000}), p.click('#reviewMode')]);
const out = path.join(root,'test','deck-filtered.html');
await dl.saveAs(out);
const deck = fs.readFileSync(out,'utf8');
check('a filtered deck exports', deck.length>20000, deck.length+' bytes');
check('the filtered deck has no NaN', !/NaN|undefined|Infinity/.test(deck));
check('the filtered deck carries the narrowed count', deck.includes('>'+railFiltered+'<'), 'expected '+railFiltered);
check('the filtered deck still has nine slides', (deck.match(/class="deck-slide[ "]/g)||[]).length===9);
fs.unlinkSync(out);
check('no JS errors', errs.length===0, errs.slice(0,2).join('; '));
await b.close();
console.log('\n'+(fails.length?'FAILURES:\n  '+fails.join('\n  '):'Sorts change the question; a filtered deck stays coherent.'));
process.exit(fails.length?1:0);
