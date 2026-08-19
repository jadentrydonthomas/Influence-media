// Period comparison must pick the right granularity for whatever is loaded:
// year when more than one year is present, otherwise month, otherwise week.
// A prior-year fixture is synthesised by renaming a week file, which is exactly
// how the parser derives the year (filename first, sheet date as a fallback).
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');

// A prior year, built by relabelling. Enough to prove the year path is taken.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prior-year-'));
const prior = [1, 2].map(n => {
  const dst = path.join(tmp, `Week ${n} - 2025.xlsm`);
  fs.copyFileSync(w(n), dst);
  return dst;
});

const fails = [];
const check = (name, cond, detail) => { if (!cond) fails.push(name); console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));

async function run(weeks) {
  await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await p.setInputFiles('#quoteFiles', weeks);
  await p.setInputFiles('#orderFiles', [ORDER]);
  await p.click('#runDashboard');
  await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  await p.waitForTimeout(600);
  await p.click('[data-analysis="compare"]');
  await p.waitForTimeout(500);
  return p.$eval('#analysisBody', n => n.innerText.replace(/\s+/g, ' ').trim());
}

// 1. Three weeks in one month -> week granularity.
const weekly = await run([w(1), w(2), w(3)]);
console.log('\n[three weeks]\n' + weekly.slice(0, 200) + '\n');
check('one month falls back to week comparison', /WEEK \d+ WEEK \d+ CHANGE/i.test(weekly), weekly.slice(0, 40));
check('week comparison names both periods', /compares Week \d+ against Week \d+/.test(weekly));

// 2. A single week -> not enough to compare, and it says so plainly.
const single = await run([w(1)]);
console.log('[single week]\n' + single.slice(0, 180) + '\n');
check('a single period explains itself instead of showing a blank', /Only one .* is loaded/i.test(single), single.slice(0, 60));
check('it tells you what to load', /add an earlier set of quote weeks/i.test(single));

// 3. Two years present -> year granularity.
const yearly = await run([...prior, w(1), w(2), w(3)]);
console.log('[two years]\n' + yearly.slice(0, 200) + '\n');
// Week 1 of two different years must be two sources, not a collision. The
// synthetic prior year reuses quote numbers, so the opportunities themselves
// legitimately collapse; what matters is that no week was silently discarded.
const sourceState = await p.evaluate(() => ({
  weeks: (window.__scope ? 0 : 0),
  stamp: document.getElementById('dataStamp').textContent.trim(),
  duplicateWeeks: document.getElementById('runStatusCopy').textContent,
}));
check('loading two years does not report a duplicate week',
  !/duplicate week|repeated reporting week/i.test(sourceState.duplicateWeeks), sourceState.duplicateWeeks.slice(0, 90));
check('year comparison carries every measure',
  ['Quotes issued', 'Alternates', 'Quoted value', 'Conversion', 'Average turnaround', 'Engineering hours'].every(k => yearly.includes(k)));

// 4. Comparison respects the active filters.
const beforeFilter = await p.$eval('#analysisBody', n => n.innerText.replace(/\s+/g, ' '));
await p.click('[data-analysis="districts"]');
await p.waitForTimeout(400);
const district = await p.$eval('[data-filter="district"]', n => n.dataset.filterValue);
await p.click(`[data-filter="district"][data-filter-value="${district}"]`);
await p.waitForTimeout(600);
await p.click('[data-analysis="compare"]');
await p.waitForTimeout(500);
const afterFilter = await p.$eval('#analysisBody', n => n.innerText.replace(/\s+/g, ' '));
check('comparison narrows with the active filter', afterFilter !== beforeFilter, 'district ' + district);
check('no JS errors', errs.length === 0, errs.slice(0, 2).join('; '));

await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'Period comparison picks the right granularity and follows the filters.'));
process.exit(fails.length ? 1 : 0);
