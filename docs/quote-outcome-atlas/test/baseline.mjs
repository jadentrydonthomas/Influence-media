// The prior period must compare without ever entering the live figures.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import os from 'os';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'prior-'));
const prior = [1,2].map(n => { const d = path.join(tmp, `Week ${n} - 2025.xlsm`); fs.copyFileSync(w(n), d); return d; });

const fails=[]; const check=(n,c,d)=>{ if(!c) fails.push(n); console.log((c?'ok   ':'FAIL ')+n+(d?'  '+d:'')); };
const b = await chromium.launch({executablePath:CHROME});
const p = await b.newPage({viewport:{width:1512,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));

async function run(withPrior) {
  await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
  await p.setInputFiles('#quoteFiles',[w(1),w(2),w(3)]);
  await p.setInputFiles('#orderFiles',[ORDER]);
  if (withPrior) await p.setInputFiles('#priorFiles', prior);
  await p.click('#runDashboard');
  await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:120000});
  await p.waitForTimeout(700);
  return p.evaluate(()=>({
    quotes: document.getElementById('railQuoted').textContent.trim(),
    wins: document.getElementById('railOrders').textContent.trim(),
    conv: document.getElementById('railConversion').textContent.trim(),
    value: document.getElementById('railQuoteValue').textContent.trim(),
    stamp: document.getElementById('dataStamp').textContent.trim(),
  }));
}

const without = await run(false);
const withB = await run(true);
check('the live figures do not move when a baseline is loaded',
  without.quotes===withB.quotes && without.wins===withB.wins && without.conv===withB.conv && without.value===withB.value,
  JSON.stringify(without)+' vs '+JSON.stringify(withB));
check('the header names the loaded baseline', /baseline 2025/.test(withB.stamp), withB.stamp.slice(-70));

await p.click('[data-analysis="compare"]'); await p.waitForTimeout(600);
const body = await p.$eval('#analysisBody', n=>n.innerText.replace(/\s+/g,' ').trim());
console.log('\n[compare]\n'+body.slice(0,320)+'\n');
check('the compare lens reads the loaded baseline', /2025/.test(body), body.slice(0,60));
check('it carries every measure', ['Quotes issued','Quoted value','Conversion','Average turnaround','Engineering hours'].every(k=>body.includes(k)));
check('it states that the baseline is not added in', /never added to the live conversion/i.test(body));
// Like weeks against like weeks: the prior set is W1-W2, the live set W1-W3,
// so both sides must be narrowed to W1-W2 rather than 2 weeks being compared
// against 3 and reported as a fall in demand.
check('it matches on the weeks both sets share', /Matched on weeks 1–2/.test(body), body.slice(body.indexOf('Matched'), body.indexOf('Matched')+60));
check('it says which live weeks it left out', /1 live week likewise|live week/.test(body));
const issued = (body.match(/Quotes issued (\d+) (\d+)/)||[]);
check('both sides carry the same weeks after matching', issued[1] === issued[2], issued.slice(1,3).join(' vs '));

// M-41: a rate against a rate moves in points, not in a per cent of itself.
// This panel was reporting 26.5% to 24.6% as −7.2% while the year-over-year
// ledger reported the same pair as −1.9 points.
{
  const rateRows = await p.$$eval('#analysisBody .cmp-row', rows => rows.map(row => {
    const label = row.querySelector('span');
    const change = row.querySelector('em');
    return { label: label ? label.textContent.trim() : '', change: change ? change.textContent.trim() : '' };
  }));
  const rates = ['Conversion', 'Inside three days', 'Met the due date'];
  const drawn = rateRows.filter(row => rates.includes(row.label));
  check('the rate rows are drawn', drawn.length === rates.length, drawn.map(r => r.label).join(','));
  const wrong = drawn.filter(row => row.change !== '—' && !/pts$/.test(row.change));
  check('a rate change is reported in points, not per cent of itself',
    wrong.length === 0, wrong.map(r => r.label + ' ' + r.change).join(' | '));
  const counts = rateRows.filter(row => !rates.includes(row.label) && row.change !== '—' && /pts$/.test(row.change));
  check('a count or a sum is not reported in points', counts.length === 0, counts.map(r => r.label + ' ' + r.change).join(' | '));
}

// A filter must narrow both sides.
await p.click('[data-analysis="districts"]'); await p.waitForTimeout(400);
const d = await p.$eval('[data-filter="district"]', n=>n.dataset.filterValue);
await p.click(`[data-filter="district"][data-filter-value="${d}"]`); await p.waitForTimeout(600);
await p.click('[data-analysis="compare"]'); await p.waitForTimeout(500);
const filtered = await p.$eval('#analysisBody', n=>n.innerText.replace(/\s+/g,' ').trim());
check('a filter narrows the comparison', filtered!==body, 'district '+d);
check('no JS errors', errs.length===0, errs.slice(0,2).join('; '));
await b.close();
fs.rmSync(tmp,{recursive:true,force:true});
console.log('\n'+(fails.length?'FAILURES:\n  '+fails.join('\n  '):'Prior-period baseline compares without touching the live book.'));
process.exit(fails.length?1:0);
