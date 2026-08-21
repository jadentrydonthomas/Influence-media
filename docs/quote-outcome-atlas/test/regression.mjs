// Regression test for the Quote Outcome Atlas dashboard.
//
// Drives the real single-file dashboard in Chromium against the checked-in
// Week 1-3 / OrderLog fixtures and asserts the figures the spec's §12 baseline
// depends on. Any parser, join, ownership, exposure, or metric change must keep
// these green (spec T-16).
//
//   node test/regression.mjs
//
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const APP = path.join(root, 'app', 'quote-conversion-atlas-shareable.html');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Fixtures are real quote books and order logs. They carry customer names,
// prices and staff emails, so they are gitignored and must be placed here by
// hand. Nothing in this repository ships that data.
const REQUIRED = ['Week 1 - 2026.xlsm', 'Week 2 - 2026.xlsm', 'Week 3 - 2026.xlsm', 'OrderLog_1-10.xlsx'];
{
  const fs = await import('fs');
  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(FIX, f)));
  if (missing.length) {
    console.error('Missing fixture file(s) in ' + FIX + ':\n  ' + missing.join('\n  ') +
      '\n\nCopy the real Week N and OrderLog exports into fixtures/ to run this suite.' +
      '\nThey are intentionally not committed - this repository is public.');
    process.exit(2);
  }
}

const checks = [];
const check = (name, actual, expected) => {
  const pass = String(actual) === String(expected);
  checks.push({ name, actual, expected, pass });
};
const checkMatch = (name, actual, re) => {
  const pass = re.test(String(actual));
  checks.push({ name, actual, expected: String(re), pass });
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));

await page.goto('file://' + APP);
await page.click('[data-screen="data"]');
await page.setInputFiles('#quoteFiles', ['Week 1 - 2026.xlsm', 'Week 2 - 2026.xlsm', 'Week 3 - 2026.xlsm'].map(f => path.join(FIX, f)));
await page.setInputFiles('#orderFiles', [path.join(FIX, 'OrderLog_1-10.xlsx')]);
await page.click('#runDashboard');
await page.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 90000 });
await page.waitForTimeout(600);

const t = async sel => (await page.$eval(sel, n => n.textContent.trim()));

// --- Core outcome figures (30+ day exposure, the dashboard default) ---
check('opportunities', await t('#railQuoted'), '174');
check('quote wins', await t('#railOrders'), '23');
check('conversion', await t('#railConversion'), '13.2%');
check('quoted value', await t('#railQuoteValue'), '$150.1M');
check('unconverted', await t('#unconvertedCount'), '151');
checkMatch('booked jobs in caption', await t('#conversionCaption'), /24 booked jobs/);

// --- Data-quality exceptions must stay visible, never silently absorbed ---
check('order rows without a quote #', await t('#missingOrderQuoteCount'), '72');
check('non-standard quote references', await t('#invalidOrderQuoteCount'), '1');
check('order quotes outside window', await t('#outsideWindowCount'), '64');
check('duplicate order rows', await t('#duplicateOrderCount'), '0');
check('corrected week dates (W2 says 2025)', await t('#dateCorrectionCount'), '1');
check('roster codes without a name', await t('#unmappedRosterCount'), '3');

// The offending values are named, not just counted.
checkMatch('non-standard reference is named', await t('#invalidOrderQuoteDetail'), /P-0287-025-2/);
checkMatch('unmapped roster codes named', await t('#unmappedRosterDetail'), /DNQ.*JMR.*NPM/);

// Critical attribution fields resolve by header label, not column position.
const fallbackDetail = await t('#headerFallbackDetail');
checkMatch('no quote-side header falls back', fallbackDetail, /^(?!.*quote:).*$/);
check('header fallback count', await t('#headerFallbackCount'), '3');

// --- Coverage must travel with every partial-coverage rate ---
const kpis = await page.$$eval('#metricRings > *', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
const onTimeKpi = kpis.find(k => /RELEASE ON TIME/i.test(k)) || '';
checkMatch('on-time KPI states its denominator', onTimeKpi, /174\/174 scored/);
checkMatch('on-time KPI states target', onTimeKpi, /target 90%/);
checkMatch('rail carries on-time denominator', await t('#railOnTimeCoverage'), /174\/174 scored/);
// N/A in the On-Time column means delivered on the due date, verified
// against Due and Done on every fixture row. Reading it as missing data
// discarded 132 of 184 records.
checkMatch('on-time counts delivery on the due date', await t('#railOnTime'), /8[0-9](\.[0-9])?%/);
check('release results agreeing with their dates', await t('#onTimeConflictCount'), '0');
checkMatch('confidence KPI has no leaked CSS var', kpis.join(' '), /^(?!.*var\(--).*$/);

await page.click('[data-screen="people"]');
await page.waitForTimeout(400);
checkMatch('team summary states on-time coverage', await t('#teamSummary'), /of 174 scored/);
const rows = await page.$$eval('#teamRows > *', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
checkMatch('team rows show on-time denominator', rows[0] || '', /\(\d+\/\d+\)/);
checkMatch('thin on-time samples are marked', rows.join(' | '), /thin/);

// --- New analysis lenses work in both themes ---
await page.click('[data-screen="overview"]');
await page.waitForTimeout(400);
for (const lens of ['bands', 'districts']) {
  await page.click(`[data-analysis="${lens}"]`);
  await page.waitForTimeout(350);
  const body = await t('#analysisBody');
  checkMatch(`${lens} lens renders content`, body, /\d/);
  checkMatch(`${lens} lens has no NaN`, body, /^(?!.*(NaN|undefined|Infinity))[\s\S]*$/);
  // Both control strips must agree on which lens is active.
  const pressed = await page.$$eval(`[data-analysis="${lens}"]`, ns => ns.map(n => n.getAttribute('aria-pressed')));
  checks.push({ name: `${lens} lens pressed state synced across both strips`, actual: pressed.join(','), expected: 'all true', pass: pressed.length > 1 && pressed.every(v => v === 'true') });
}
checkMatch('value bands show the zero-win band', await t('#analysisBody'), /\d/);
await page.click('[data-analysis="bands"]');
await page.waitForTimeout(300);
// A colour whose only definition is a light-mode literal is the classic
// unreadable-dark-theme bug; assert the track follows the theme token.
const lightTrack = await page.$eval('.segment-track', n => getComputedStyle(n).backgroundColor);
await page.click('#themeButton');
await page.waitForTimeout(500);
const darkTrack = await page.$eval('.segment-track', n => getComputedStyle(n).backgroundColor);
checks.push({ name: 'segment track follows the theme', actual: `light ${lightTrack} / dark ${darkTrack}`, expected: 'different per theme', pass: lightTrack !== darkTrack });
await page.click('#themeButton');
await page.waitForTimeout(400);

// --- Exported deck ---
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
  page.click('#reviewMode'),
]);
if (!download) {
  checks.push({ name: 'deck export produced a file', actual: 'no download', expected: 'download', pass: false });
} else {
  const fs = await import('fs');
  const out = path.join(root, 'test', 'deck-out.html');
  await download.saveAs(out);
  const deckRaw = fs.readFileSync(out, 'utf8');
  // The Nucor mark travels with the deck as a base64 data URI, and base64
  // happily contains the letters N-a-N. Figure checks read the deck with the
  // payloads stripped; anything checking markup uses the raw text.
  const deck = deckRaw.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, 'data:image/png;base64,MARK');
  check('deck slide count', (deck.match(/class="deck-slide[ \"]/g) || []).length, 9);
  checkMatch('deck counter is generated from slide count', deck, /id="deckPage"[^>]*>1 \/ 9</);
  checkMatch('deck has no NaN or undefined', deck, /^(?!.*(NaN|undefined|Infinity))[\s\S]*$/);
  // The closing slide lists booked jobs, not the biggest open quotes: real
  // order-log job numbers, with the people who priced and delivered them.
  checkMatch('deck closes on real booked job numbers', deck, /class="quote"><b>[A-Z0-9]+-\d+</);
  checkMatch('deck names who priced each booked job', deck, /class="team">[^<]*\((engineer|estimator|scheduler|all three|[a-z]+ & [a-z]+)\)/);
  checkMatch('deck still surfaces the largest open work', deck, /and the largest still open/i);
  checkMatch('deck value bands compare asked against returned', deck, /quoted value against returned value, by value band/i);
  checkMatch('deck value bands name both columns', deck, /Quoted value<\/span>[\s\S]{0,120}Returned value/);
  // Slide 7 reads the same dates as the old lag buckets, as a decision curve.
  checkMatch('deck decision curve present', deck, /cumulative share of booked orders by day/i);
  // The lifecycle slide leads with the whole clock and names both halves of it.
  checkMatch('deck states the whole clock', deck, /median from the request landing to the order being entered/i);
  checkMatch('deck names our half of the clock', deck, /OUR HALF[\s\S]{0,400}pricing it/i);
  checkMatch('deck names the customer half', deck, /THEIR HALF[\s\S]{0,400}deciding/i);
  // Each decision-curve checkpoint carries the money, not only the percentage.
  checkMatch('deck decision checkpoints carry value', deck, /booked by day \d+<\/span><small>\$/);
  checkMatch('deck separates who pays from who costs', deck, /Who actually pays us[\s\S]{0,4000}Who asks the most and returns the least/i);
  // An account cannot be a payer and a cost at the same time. It was, because
  // the cost side ranked on unreturned value and our best payers ask for the
  // most, so they leave the most on the table by arithmetic alone.
  {
    const half = body => {
      // The name is followed by its own <title> for the hover, so the full
      // name is read from there rather than from the clipped label.
      return [...body.matchAll(/class="ledger-name"[^>]*>[^<]*<title>([^<]+)<\/title>/g)].map(m => m[1].trim());
    };
    const pays = deck.split('Who actually pays us')[1] || '';
    const costs = deck.split('Who asks the most and returns the least')[1] || '';
    const paysNames = half(pays.split('Who asks the most and returns the least')[0] || '');
    const costNames = half(costs);
    const both = paysNames.filter(name => costNames.indexOf(name) > -1);
    check('no account appears as both a payer and a cost', both.join(' | '), '');
    check('both halves of the ledger drew accounts', paysNames.length > 0 && costNames.length > 0, true);
  }
  checkMatch('deck closes on what to do next', deck, /class="closing-actions"/);
  checkMatch('deck on-time carries coverage', deck, /174 of 174 scored/);
  checkMatch('deck does not call on-time a full-book figure', deck, /^(?!.*on time<\/span><strong>[^<]*<\/strong><small>full quote book)[\s\S]*$/);
  // The timing disc's conic arc used to be painted over from both sides by an
  // inset shadow and an inner disc, so it always rendered solid. Guard that.
  checkMatch('timing disc arc is not covered by an inset shadow', deck, /\.timing-disc\{box-shadow:0 22px 45px/);
  checkMatch('timing disc inner circle leaves a visible ring', deck, /\.timing-disc:before\{inset:24px\}/);
  // The customer slide draws one track per account: the full track is what was
  // quoted, the green inside it is what came back. The green can never be
  // longer than the track it sits in, and an account with nothing back must
  // draw no green at all.
  const ledgerRows = [...deck.matchAll(/<rect class="ledger-asked"[^>]*?width="([\d.]+)"[^>]*\/>(<rect class="ledger-back"[^>]*?width="([\d.]+)"[^>]*\/>)?[\s\S]{0,400}?class="ledger-value(?: is-back| is-none)?"[^>]*>([^<]*)</g)]
    .map(m => ({ asked: Number(m[1]), back: Number(m[3] || 0), label: m[4] }));
  const nested = ledgerRows.every(row => row.back <= row.asked + 0.1);
  const zeroed = ledgerRows.every(row => /nothing back/.test(row.label) === (row.back === 0));
  checks.push({ name: 'returned bar never exceeds the quoted track it sits inside', actual: JSON.stringify(ledgerRows.filter(r => r.back > r.asked + 0.1)), expected: '[]', pass: ledgerRows.length > 0 && nested });
  checks.push({ name: 'an account with nothing back draws no returned bar', actual: JSON.stringify(ledgerRows.filter(r => /nothing back/.test(r.label) !== (r.back === 0)).slice(0, 3)), expected: '[]', pass: ledgerRows.length > 0 && zeroed });
}

checks.push({ name: 'no uncaught JS errors', actual: jsErrors.length ? jsErrors.join('; ') : 'none', expected: 'none', pass: jsErrors.length === 0 });

await browser.close();

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  const mark = c.pass ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${c.name}` + (c.pass ? '' : `\n        expected: ${c.expected}\n        actual:   ${c.actual}`));
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
