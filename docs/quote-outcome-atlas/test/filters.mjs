// Segmentation: clicking a value band, district, week, estimator or engineer
// must narrow every view consistently, and clearing must restore exactly.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
await p.setInputFiles('#quoteFiles', ['Week 1 - 2026.xlsm', 'Week 2 - 2026.xlsm', 'Week 3 - 2026.xlsm'].map(f => path.join(FIX, f)));
await p.setInputFiles('#orderFiles', [path.join(FIX, 'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 90000 });
await p.waitForTimeout(700);

const fails = [];
const check = (name, cond, detail) => { if (!cond) fails.push(name + (detail ? ' — ' + detail : '')); console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

const snap = () => p.evaluate(() => ({
  quotes: Number(document.getElementById('railQuoted').textContent.trim()) || 0,
  wins: Number(document.getElementById('railOrders').textContent.trim()) || 0,
  conv: document.getElementById('railConversion').textContent.trim(),
  value: document.getElementById('railQuoteValue').textContent.trim(),
  people: document.querySelectorAll('#teamRows > *').length,
  accounts: document.querySelectorAll('#custRows .account-row').length,
  profileQuotes: document.querySelectorAll('#custProfile .profile-table tbody tr').length,
  barHidden: document.getElementById('filterBar').hidden,
  chips: [...document.querySelectorAll('.filter-chip')].map(n => n.innerText.replace(/\s+/g, ' ').trim()),
}));

const base = await snap();
console.log('unfiltered:', JSON.stringify(base));
check('filter bar hidden with no filters', base.barHidden === true);

// --- Filter by district -------------------------------------------------------
await p.click('[data-analysis="districts"]');
await p.waitForTimeout(400);
const firstDistrict = await p.$eval('[data-filter="district"]', n => n.dataset.filterValue);
await p.click(`[data-filter="district"][data-filter-value="${firstDistrict}"]`);
await p.waitForTimeout(600);
const byDistrict = await snap();
console.log(`district ${firstDistrict}:`, JSON.stringify(byDistrict));
check('district filter narrows the cohort', byDistrict.quotes > 0 && byDistrict.quotes < base.quotes, `${byDistrict.quotes} of ${base.quotes}`);
check('filter bar appears', byDistrict.barHidden === false);
check('a chip names the filter', byDistrict.chips.length === 1 && /DISTRICT/i.test(byDistrict.chips[0]), byDistrict.chips.join(' | '));
check('the account list narrows with the filter', byDistrict.accounts > 0 && byDistrict.accounts < base.accounts,
  `${byDistrict.accounts} of ${base.accounts} accounts`);

// Every quote listed in the open account must belong to that district.
await p.click('[data-screen="customers"]');
await p.waitForTimeout(600);
const rowsMatch = await p.evaluate(prefix => {
  const table = document.querySelector('#custProfile .profile-block:last-child .profile-table tbody');
  if (!table) return false;
  const ids = [...table.querySelectorAll('td b')].map(n => n.textContent.trim());
  return ids.length > 0 && ids.every(id => id.startsWith(prefix));
}, firstDistrict);
check('every quote in the open account belongs to the district', rowsMatch);

// --- Clearing restores exactly ------------------------------------------------
await p.click('#clearFilters');
await p.waitForTimeout(600);
const restored = await snap();
check('clearing restores the original cohort', restored.quotes === base.quotes && restored.conv === base.conv && restored.value === base.value,
  `${restored.quotes}/${restored.conv}/${restored.value} vs ${base.quotes}/${base.conv}/${base.value}`);
check('filter bar hides again', restored.barHidden === true);

// --- Filter by estimator on the operations screen ------------------------------
await p.click('[data-screen="people"]');
await p.waitForTimeout(300);
await p.click('[data-role="estimators"]');
await p.waitForTimeout(600);
const est = await p.$eval('[data-filter="estimator"]', n => n.dataset.filterValue);
await p.click(`[data-filter="estimator"][data-filter-value="${est}"]`);
await p.waitForTimeout(700);
const byEst = await snap();
console.log(`estimator ${est}:`, JSON.stringify(byEst));
check('estimator filter narrows the cohort', byEst.quotes > 0 && byEst.quotes < base.quotes, `${byEst.quotes} of ${base.quotes}`);

// --- Two filters compose -------------------------------------------------------
await p.click('[data-screen="overview"]');
await p.waitForTimeout(500);
await p.click('[data-analysis="bands"]');
await p.waitForTimeout(400);
const bandEl = await p.$('[data-filter="band"]');
if (bandEl) {
  const bandKey = await bandEl.getAttribute('data-filter-value');
  await p.click(`[data-filter="band"][data-filter-value="${bandKey}"]`);
  await p.waitForTimeout(700);
  const both = await snap();
  console.log(`estimator ${est} + band ${bandKey}:`, JSON.stringify(both));
  check('two filters compose', both.chips.length === 2, both.chips.join(' | '));
  check('composed filter is no wider than either alone', both.quotes <= byEst.quotes, `${both.quotes} <= ${byEst.quotes}`);
}

// --- Outcome filter ------------------------------------------------------------
await p.click('#clearFilters');
await p.waitForTimeout(500);
await p.click('[data-filter="outcome"][data-filter-value="confirmed"]');
await p.waitForTimeout(700);
const confirmed = await snap();
console.log('confirmed only:', JSON.stringify(confirmed));
check('confirmed filter leaves only wins', confirmed.quotes === base.wins && confirmed.conv === '100.0%',
  `${confirmed.quotes} quotes at ${confirmed.conv}, expected ${base.wins} at 100.0%`);

await p.click('#clearFilters');
await p.waitForTimeout(500);
const final = await snap();
check('final state matches the original', final.quotes === base.quotes && final.conv === base.conv);
check('no JS errors', errs.length === 0, errs.slice(0, 2).join('; '));

await b.close();
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'Segmentation behaves consistently across every view.'));
process.exit(fails.length ? 1 : 0);
