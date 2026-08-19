// A pass over the new screens: do they filter, do they survive the dark
// theme, do they fit a 1366x768 laptop, and do they say something sensible
// before any file has been loaded.
import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fails=[]; const check=(n,c,d)=>{ if(!c) fails.push(n); console.log((c?'ok   ':'FAIL ')+n+(d?'  '+d:'')); };

const b = await chromium.launch({executablePath:CHROME});
const p = await b.newPage({viewport:{width:1366,height:768}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));

// --- Before a run, every screen must explain itself rather than show blanks.
for (const screen of ['customers','timeline','ops']) {
  await p.click(`[data-screen="${screen}"]`); await p.waitForTimeout(250);
  const text = await p.$eval(`#${screen}`, n=>n.innerText.replace(/\s+/g,' ').trim());
  check(`${screen} says something before a run`, /no .*(yet|records)|awaiting|run the weekly/i.test(text), text.slice(0,60));
}

await p.click('[data-screen="data"]');
await p.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await p.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
await p.waitForTimeout(600);

const read = async screen => { await p.click(`[data-screen="${screen}"]`); await p.waitForTimeout(400);
  return p.$eval(`#${screen}`, n=>n.innerText.replace(/\s+/g,' ').trim()); };

// --- No NaN / undefined anywhere on the new screens, in either theme.
for (const theme of ['light','dark']) {
  if (theme==='dark') { await p.click('#themeButton'); await p.waitForTimeout(400); }
  for (const screen of ['customers','timeline']) {
    const text = await read(screen);
    check(`${screen} has no NaN or undefined (${theme})`, !/NaN|undefined|Infinity/.test(text), (text.match(/NaN|undefined|Infinity/)||[''])[0]);
  }
}
// --- Dark theme must actually recolour the new surfaces.
const darkTrack = await p.$eval('.age-track', n=>getComputedStyle(n).backgroundColor);
const darkStage = await p.$eval('.stage-track', n=>getComputedStyle(n).backgroundColor);
await p.click('#themeButton'); await p.waitForTimeout(400);
await read('timeline');
const lightTrack = await p.$eval('.age-track', n=>getComputedStyle(n).backgroundColor);
const lightStage = await p.$eval('.stage-track', n=>getComputedStyle(n).backgroundColor);
check('ageing track follows the theme', darkTrack!==lightTrack, `${lightTrack} vs ${darkTrack}`);
check('lifecycle track follows the theme', darkStage!==lightStage, `${lightStage} vs ${darkStage}`);

// --- Selecting an account must narrow every screen, not just this one.
await p.click('[data-screen="customers"]'); await p.waitForTimeout(400);
const account = await p.$eval('#custTable tbody tr', n=>n.dataset.filterValue);
await p.click(`#custTable tbody tr[data-filter-value="${account}"]`); await p.waitForTimeout(700);
const railAfter = await p.$eval('#railQuoted', n=>n.textContent.trim());
const barText = await p.$eval('#filterBar', n=>n.innerText.replace(/\s+/g,' ').trim());
check('an account row sets a filter', /customer/i.test(barText), barText.slice(0,70));
check('the filter narrows the book', Number(railAfter) > 0 && Number(railAfter) < 174, railAfter+' of 174');
const timelineFiltered = await read('timeline');
check('timelines narrow with the filter', !/151 quotes with no linked order/.test(timelineFiltered));
const custFiltered = await read('customers');
check('customers narrows to the one account', /ACCOUNTS QUOTED 1\b/.test(custFiltered), custFiltered.slice(0,60));
await p.$eval('#filterBar button', n=>n.click()); await p.waitForTimeout(600);
check('clearing restores the book', (await p.$eval('#railQuoted', n=>n.textContent.trim()))==='174');

// --- No horizontal scroll on a 1366-wide laptop, on any screen.
for (const screen of ['overview','people','quotes','customers','timeline','ops','data']) {
  await p.click(`[data-screen="${screen}"]`); await p.waitForTimeout(350);
  const over = await p.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${screen} does not scroll sideways at 1366px`, over<=0, 'overflow '+over);
}
check('no JS errors', errs.length===0, errs.slice(0,3).join('; '));
await b.close();
console.log('\n'+(fails.length?'FAILURES:\n  '+fails.join('\n  '):'The new screens filter, theme and fit.'));
process.exit(fails.length?1:0);
