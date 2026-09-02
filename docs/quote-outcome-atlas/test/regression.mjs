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
checkMatch('on-time KPI states its denominator', onTimeKpi, /174 of 174 scored/);
checkMatch('on-time KPI states target', onTimeKpi, /target 90%/);
checkMatch('rail carries on-time denominator', await t('#railOnTimeCoverage'), /174\/174 scored/);
// N/A in the On-Time column means delivered on the due date, verified
// against Due and Done on every fixture row. Reading it as missing data
// discarded 132 of 184 records.
checkMatch('on-time counts delivery on the due date', await t('#railOnTime'), /8[0-9](\.[0-9])?%/);
check('release results agreeing with their dates', await t('#onTimeConflictCount'), '0');
checkMatch('confidence KPI has no leaked CSS var', kpis.join(' '), /^(?!.*var\(--).*$/);

// The supporting line under each headline figure is prose, and prose is not
// clipped. These four used to be one nowrap line with an ellipsis, so two of
// them ended mid-word.
{
  const clipped = await page.$$eval('#metricRings .metric-copy b, #metricRings .metric-copy small',
    nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1)
      .map(node => node.textContent.trim()));
  check('no figure or supporting line in the measure strip is clipped', clipped.join(' | '), '');
}

// The run summary is the first thing read after a run. It used to be one
// paragraph of clauses joined by semicolons.
{
  const run = await page.$eval('#runStatus', node => ({
    text: node.innerText.replace(/\s+/g, ' ').trim(),
    facts: node.querySelectorAll('.fact').length,
    notes: node.querySelectorAll('.run-notes i').length,
    upper: [...node.querySelectorAll('.run-notes i')].filter(n => getComputedStyle(n).textTransform !== 'none').length
  }));
  checks.push({ name: 'the run summary lays its counts out', actual: run.facts + ' facts', expected: 'at least three', pass: run.facts >= 3 });
  checks.push({ name: 'the run summary lists each repair on its own line', actual: run.notes + ' notes', expected: 'at least one', pass: run.notes >= 1 });
  check('no container rule uppercases the run summary notes', run.upper, 0);
  checkMatch('the run summary does not run its clauses together', run.text, /^(?!.*;)[\s\S]*$/);
}

await page.click('[data-screen="people"]');
await page.waitForTimeout(400);
checkMatch('team summary states on-time coverage', await t('#teamSummary'), /of 174 scored/);
const rows = await page.$$eval('#teamRows > *', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
checkMatch('team rows show on-time denominator', rows[0] || '', /\(\d+\/\d+\)/);
checkMatch('thin on-time samples are marked', rows.join(' | '), /thin/);

// A fact strip lays out figure and unit as separate elements. The gap between
// them must be a real space in the text layer and not only CSS margin,
// otherwise the copied text and the screen-reader reading both say "12quotes".
{
  const fused = [];
  for (const screen of ['overview', 'customers', 'people', 'timeline', 'compare', 'data']) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(450);
    // Units, and any mark that sits beside text — a roster flag, a thin
    // marker — need the space in the markup, not only in CSS. ".row-flag" was
    // reading as "NPMNOT ON THE ROSTER" while looking correct on screen.
    const bad = await page.$$eval('.fact .unit, .row-flag, .thin-mark, .payer-state', nodes => nodes
      .filter(node => {
        const before = node.previousSibling;
        if (!before || !before.textContent) return false;
        return !/\s$/.test(before.textContent);
      })
      .slice(0, 3)
      .map(node => (node.parentElement || node).textContent.replace(/\s+/g, ' ').trim()));
    bad.forEach(text => fused.push(screen + ': ' + text));
  }
  check('no mark fuses to the text beside it', fused.join(' | '), '');
}

// A fact strip is dropped into containers that already style bare span and b
// descendants. Three of those rules reached inside it: one broke every figure
// onto its own line, one uppercased the units, one both. Each was invisible in
// the source and obvious on the screen.
{
  const captured = [];
  for (const screen of ['overview', 'customers', 'people', 'timeline', 'compare', 'data']) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(450);
    const bad = await page.$$eval('.facts', nodes => {
      const out = [];
      nodes.forEach(strip => {
        const stripStyle = getComputedStyle(strip);
        if (stripStyle.display !== 'flex') out.push('strip display ' + stripStyle.display + ': ' + strip.textContent.trim());
        // A .fact is a flex item, so it is blockified by its own strip; only
        // the parts inside one carry a display worth checking.
        strip.querySelectorAll('.fact b, .fact .unit').forEach(part => {
          const style = getComputedStyle(part);
          if (style.display === 'block') out.push('block: ' + part.textContent.trim());
        });
        strip.querySelectorAll('.fact, .fact b, .fact .unit').forEach(part => {
          const style = getComputedStyle(part);
          if (style.textTransform !== 'none') out.push(style.textTransform + ': ' + part.textContent.trim());
        });
      });
      return out.slice(0, 3);
    });
    bad.forEach(text => captured.push(screen + ' — ' + text));
  }
  check('no container rule reaches inside a fact strip', captured.join(' | '), '');
}

// The same trap, five times now, on five different components: a container
// styles bare span / b / em descendants and wins on specificity over whatever
// is dropped inside it. These are the components that carry their own casing,
// so an inherited uppercase is always a bug.
{
  const shouted = [];
  for (const screen of ['overview', 'customers', 'people', 'timeline', 'compare', 'data']) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(450);
    const bad = await page.$$eval('.run-notes i, .brief-who, .brief-when, .stamp-cell > strong, .member-name strong, .account-name strong, .payer-name > b',
      nodes => nodes.filter(node => getComputedStyle(node).textTransform !== 'none')
        .slice(0, 3)
        .map(node => (node.className || node.tagName) + ': ' + node.textContent.trim().slice(0, 30)));
    bad.forEach(text => shouted.push(screen + ' — ' + text));
  }
  check('no container rule shouts at a component that sets its own casing', [...new Set(shouted)].join(' | '), '');
}

// The code face is for figures and identifiers. Prose set in it is most of
// what "overly digital" means, and it drifts back every time a value rule
// reaches a phrase — which it did on the release mark, the identity note, both
// intake statuses, a chart annotation and a numeric column's header.
{
  const shouted = [];
  // Each year-over-year view builds its own markup when it is opened, so
  // scanning the compare screen once only ever reaches whichever view is
  // showing. Every view gets walked.
  const stops = [['overview', ''], ['customers', ''], ['people', ''], ['timeline', ''], ['data', '']]
    .concat(['headline', 'momentum', 'speed', 'mix', 'customers', 'people', 'ledger'].map(view => ['compare', view]));
  for (const [screen, view] of stops) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(400);
    if (view) { await page.click(`[data-compare-view="${view}"]`); await page.waitForTimeout(650); }
    const bad = await page.$$eval(`#${screen} *`, nodes => nodes
      .filter(node => {
        if (node.children.length) return false;
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 4) return false;
        if (!/mono|consolas|courier/i.test(getComputedStyle(node).fontFamily)) return false;
        // Prose: three or more words, three of which are plain words.
        // A list of file names is a list of identifiers, however wordy.
        if (/\.(xlsm|xlsx|csv)\b/i.test(text)) return false;
        const words = text.split(' ');
        return words.length >= 3 && words.filter(w => /^[A-Za-z][A-Za-z'\u2019-]{2,}$/.test(w)).length >= 3;
      })
      .map(node => {
        const cls = node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className;
        return (typeof cls === 'string' && cls ? '.' + cls.trim().split(/\s+/)[0] : node.tagName)
          + ': ' + node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      })
      // The step eyebrow is a deliberate technical mark, not prose. Excluded
      // here rather than after the slice, or three allowed hits would hide
      // every real one behind them.
      .filter(text => !/^\.flow-step/.test(text))
      .slice(0, 3));
    bad.forEach(text => shouted.push(screen + (view ? '/' + view : '') + ' — ' + text));
  }
  check('prose is not set in the code face', [...new Set(shouted)].join(' | '), '');
}

// Every screen that carries analysis opens with one generated sentence naming
// what it found. A screen whose lead still reads as the import placeholder, or
// whose lead never names a figure, is one the reader has to derive from.
{
  const leads = [];
  for (const [screen, id] of [
    ['overview', '#managementReadout'],
    ['customers', '#custReadout'],
    ['people', '#teamReadout'],
    ['timeline', '#timeReadout']]) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(450);
    const lead = await page.$eval(id, node => ({
      strong: (node.querySelector('strong') || {}).textContent || '',
      all: node.textContent.replace(/\s+/g, ' ').trim()
    }));
    if (/awaiting source files/i.test(lead.all)) leads.push(screen + ': still the import placeholder');
    else if (!/\d/.test(lead.strong)) leads.push(screen + ': lead names no figure — ' + lead.strong);
    else if (lead.strong.length < 20) leads.push(screen + ': lead is too short — ' + lead.strong);
  }
  check('every analysis screen leads with a generated finding', leads.join(' | '), '');
}

// A control or shell that draws a full border and squares its corners is the
// most dated thing on a screen. Thirty-three of them were doing it.
{
  const square = [];
  for (const screen of ['overview', 'customers', 'people', 'timeline', 'compare', 'data']) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(450);
    const bad = await page.$$eval('#app *', nodes => nodes
      .filter(node => {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parseFloat(style.borderTopWidth) < 0.5) return false;
        if (style.borderTopStyle === 'none') return false;
        const box = node.getBoundingClientRect();
        // A hairline used as a rule, not as a box, has no second border.
        if (parseFloat(style.borderLeftWidth) < 0.5 || parseFloat(style.borderBottomWidth) < 0.5) return false;
        if (box.width < 24 || box.height < 16) return false;
        return parseFloat(style.borderTopLeftRadius) < 1;
      })
      .slice(0, 4)
      .map(node => (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/)[0] : node.tagName.toLowerCase())));
    bad.forEach(name => square.push(screen + ': ' + name));
  }
  check('no bordered control or shell squares its corners', [...new Set(square)].join(' | '), '');
}

// The motion layer is opt-in behind a root class the script adds. Nothing may
// be left invisible: a reader who never scrolls, whose script fails, or who
// prints must still see every figure.
{
  await page.click('[data-screen="overview"]');
  await page.waitForTimeout(900);
  const armed = await page.evaluate(() => document.documentElement.classList.contains('motion-on'));
  checks.push({ name: 'the motion layer arms itself', actual: armed ? 'armed' : 'not armed', expected: 'armed', pass: armed });

  // Every drawn line measures its own length rather than guessing one.
  const drawn = await page.$$eval('[data-draw]', nodes => ({
    total: nodes.length,
    measured: nodes.filter(n => n.style.getPropertyValue('--draw-len')).length
  }));
  checks.push({ name: 'every drawn line measures its own length',
    actual: drawn.measured + ' of ' + drawn.total, expected: drawn.total + ' of ' + drawn.total,
    pass: drawn.total > 0 && drawn.measured === drawn.total });

  // Anything on screen has arrived. A staged element that never receives
  // is-in is an element a reader can never read.
  const stranded = [];
  for (const screen of ['overview', 'customers', 'people', 'timeline', 'data']) {
    await page.click(`[data-screen="${screen}"]`);
    await page.waitForTimeout(700);
    const bad = await page.$$eval('[data-rise], [data-wash]', nodes => nodes.filter(node => {
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      if (box.top > window.innerHeight || box.bottom < 0) return false;
      return parseFloat(getComputedStyle(node).opacity) < 0.9;
    }).slice(0, 3).map(node => (node.className || '').toString().trim().split(/\s+/)[0]));
    bad.forEach(name => stranded.push(screen + ': .' + name));
  }
  check('nothing staged for motion is left invisible on screen', [...new Set(stranded)].join(' | '), '');

  // The counters put the true figure back. A figure caught mid-count is a
  // wrong number to anything that reads text: copy, print, a screen reader.
  await page.click('[data-screen="overview"]');
  await page.waitForTimeout(2400);
  const midCount = await page.$$eval('[data-odo]', nodes => nodes
    .map(node => node.textContent.trim())
    .filter(text => text === '0' || text === '0.0' || text === '0.0%' || text === '$0.0M')
    .slice(0, 3));
  check('every counting figure settles on its real value', midCount.join(' | '), '');
}

// Team performance answers "which work", not only "who". The same two blocks
// the Customers screen carries for an account, for a person.
{
  await page.click('[data-screen="people"]');
  await page.waitForTimeout(900);
  const record = await page.$eval('#personRecord', n => n.innerText.replace(/\s+/g, ' '));
  checkMatch('the roster opens the work behind a person', record, /quotes owned/);
  const quoteRows = await page.$$eval('#personRecord .profile-block:last-of-type tbody tr', n => n.length);
  checks.push({ name: 'the person record lists the quotes they own',
    actual: quoteRows + ' rows', expected: 'at least one', pass: quoteRows > 0 });
  // Choosing a different person opens different work.
  const first = await page.$eval('#personRecord .account-name strong', n => n.textContent);
  // Pick a row that is somebody else, rather than assuming a fixed index:
  // the roster is ranked, so which row holds which person moves with the data.
  const names = await page.$$eval('#teamRows .team-row .member-name strong', n => n.map(x => x.textContent.trim()));
  const other = names.findIndex(name => name !== first);
  if (other >= 0) {
    const rows = await page.$$('#teamRows .team-row');
    await rows[other].click();
    await page.waitForTimeout(700);
    const second = await page.$eval('#personRecord .account-name strong', n => n.textContent);
    checks.push({ name: 'the record follows the person selected',
      actual: first + ' \u2192 ' + second, expected: 'two different people', pass: first !== second });
  }
}
await page.click('[data-screen="people"]');
await page.waitForTimeout(400);

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
  // Nine content slides and the outro that closes on the mark.
  check('deck slide count', (deck.match(/class="deck-slide[ \"]/g) || []).length, 10);
  checkMatch('deck counter is generated from slide count', deck, /id="deckPage"[^>]*>1 \/ 10</);
  check('the outro is last and there is only one', (deck.match(/deck-slide is-outro/g) || []).length, 1);
  checkMatch('the outro closes on the mark and the run, not on instructions', deck,
    /is-outro[\s\S]*deck-mark is-huge[\s\S]*outro-source/);
  checkMatch('deck has no NaN or undefined', deck, /^(?!.*(NaN|undefined|Infinity))[\s\S]*$/);
  // The closing slide lists booked jobs, not the biggest open quotes: real
  // order-log job numbers, with the people who priced and delivered them.
  checkMatch('deck closes on real booked job numbers', deck, /class="quote"><b>[A-Z0-9]+-\d+</);
  // The role is a tag beside the name now rather than a bracketed suffix, so
  // the check reads the mark instead of the punctuation around it.
  // Every dashboard screen marks a role code with no full-name row in the
  // roster. The deck printed the bare code as though it were somebody's name.
  // Only the weekly workbook's own role codes resolve against the roster. The
  // sales engineer and CSR initials come off the order log and are not names it
  // could ever have resolved, so they carry no mark.
  {
    const lines = [...deck.matchAll(/<i class="team-line"><u>(ENG|EST|SCH|ALL|EST\+SCH|ENG\+EST|ENG\+SCH)<\/u><b>([^<]+)(<s class="no-roster">)?/g)]
      .map(m => ({ who: m[2].trim(), marked: !!m[3] }))
      .concat([...deck.matchAll(/<em class="open-owner">([^<]+)(<s class="no-roster">)?/g)]
        .map(m => ({ who: m[1].trim(), marked: !!m[2] })));
    checks.push({ name: 'the deck lists owners at all', actual: lines.length + ' owner lines', expected: 'at least one', pass: lines.length > 0 });
    // This fixture happens to resolve every owner it prints, so the check
    // guards the shape rather than being exercised by the data here. The
    // behaviour itself is visible on the real-data deck, where NPM carries it.
    const unmarked = lines.filter(entry => /^[A-Z]{2,4}$/.test(entry.who) && !entry.marked).map(entry => entry.who);
    check('the deck marks a role code that resolved to no roster name', unmarked.slice(0, 3).join(' | '), '');
  }
  checkMatch('deck names who priced each booked job', deck,
    /class="team">(<i class="team-line"><u>(ENG|EST|SCH|ALL|EST\+SCH|ENG\+EST|ENG\+SCH)<\/u><b>[^<]+<\/b><\/i>)/);
  checkMatch('deck still surfaces the largest open work', deck, /and the largest still open/i);
  checkMatch('deck value bands compare asked against returned', deck, /quoted value against returned value, by value band/i);
  checkMatch('deck value bands name both columns', deck, /Quoted value<\/span>[\s\S]{0,120}Returned value/);
  // Slide 7 reads the same dates as the old lag buckets, as a decision curve.
  checkMatch('deck decision curve present', deck, /cumulative share of booked orders by day/i);
  // The lifecycle slide leads with the whole clock and names both halves of it.
  checkMatch('deck states the whole clock', deck, /median from the request landing to the order being entered/i);
  checkMatch('deck names our part of the clock', deck, /OUR PART[\s\S]{0,400}pricing it/i);
  checkMatch('deck names the customer part', deck, /THE CUSTOMER&#0?39;S PART[\s\S]{0,400}deciding/i);
  // The two parts are medians on different quotes, so they cannot sum to the
  // whole-clock median printed above them. The slide has to say so, or a
  // reader adds 4.0 and 35 and finds 39 where the header says 43.
  checkMatch('the clock says why its parts do not add to its whole', deck, /do not add to this/i);
  // Each decision-curve checkpoint carries the money, not only the percentage.
  checkMatch('deck decision checkpoints carry value', deck, /booked by day \d+<\/span><small>\$/);
  // Both blocks are present and the paying one leads. The old form matched
  // across a fixed 4000-character window, so it failed the moment the markup
  // between the two headings grew — which says nothing about the slide.
  {
    const pays = deck.search(/Who actually pays us/i);
    const costs = deck.search(/Who asks the most and returns the least/i);
    check('deck separates who pays from who costs',
      pays >= 0 && costs > pays ? 'pays then costs' : 'pays ' + pays + ', costs ' + costs, 'pays then costs');
  }
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
  // The deck reports; it does not instruct. The penultimate slide states the
  // book in three figures and the last one is a closing mark.
  checkMatch('deck states the book before it closes', deck, /class="closing-facts"/);
  checkMatch('deck no longer issues instructions', deck, /^(?!.*class="closing-actions")[\s\S]*$/);
  // The class rename was not the point: the cards themselves used to be
  // imperatives ("Qualify the repeat askers", "Ring the ones who used to pay").
  // A deck that reports states what is true and leaves the orders to the room.
  {
    const heads = [...deck.matchAll(/class="closing-facts"[\s\S]*?<\/div>/g)]
      .flatMap(m => [...m[0].matchAll(/<strong>([^<]+)<\/strong>/g)].map(h => h[1].trim()));
    const orders = heads.filter(head => /^(Qualify|Answer|Hold|Finish|Protect|Ring|Call|Chase|Spread|Convert|Ask|Win|Get|Keep|Understand)\b/.test(head));
    check('closing cards state findings, not orders', orders.join(' | '), '');
    check('the closing cards drew', heads.length > 0, true);
  }
  // The deck and the dashboard set the same signed figures, so they have to set
  // them with the same character. A hyphen in front of a figure that carries a
  // unit is the old formatter leaking through.
  {
    // Stylesheets and scripts are not prose: translate(-50%) is not a figure.
    const text = deck.replace(/<(style|script)[\s\S]*?<\/\1>/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&minus;/g, '−').replace(/&[a-z]+;/g, ' ');
    const found = (text.match(/-\$?\d[\d.,]*\s*(?:%|pts|points)/g) || []).slice(0, 5);
    check('every signed figure in the deck uses a true minus', found.join(' '), '');
  }
  // K-17 applies to headlines too, not only to the closing cards. "Who we
  // should ring" is the room's decision; the slide's job is to say who came
  // back and who did not.
  {
    const heads = [...deck.matchAll(/<h1>([\s\S]*?)<\/h1>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim());
    check('the deck drew its headlines', heads.length > 8, true);
    const directive = heads.filter(head =>
      /\b(we should|we must|we need to|let us|let's|you should|make sure)\b/i.test(head)
      || /^(Qualify|Ring|Call|Chase|Fix|Protect|Hold|Finish|Convert|Ask|Win|Get|Keep|Spread|Answer)\b/i.test(head));
    check('no slide headline gives an instruction', directive.join(' | '), '');
  }

  // A name clipped to an ellipsis has been found in five different places now.
  // A person or a company nobody can name is not evidence of anything, and the
  // cells this happens in have a second line they could use.
  {
    const cells = [...deck.matchAll(/<(?:td|span|b|em)[^>]*>([^<]*…)</g)].map(m => m[1].trim());
    // An axis tick or a deliberate truncation of free text is not a name; a
    // name is what sits in these columns.
    check('no name in the deck is clipped to an ellipsis', cells.slice(0, 5).join(' | '), '');
  }
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
  // Read one row group at a time rather than assuming the two rects are
  // adjacent — the extruded faces sit between them now, and a regex that
  // depended on adjacency reported every returned bar as zero.
  const ledgerRows = [...deck.matchAll(/<g class="ledger-row-g"[\s\S]*?<\/g>/g)].map(m => m[0]).map(row => ({
    asked: Number((row.match(/<rect class="ledger-asked"[^>]*?width="([\d.]+)"/) || [])[1] || 0),
    back: Number((row.match(/<rect class="ledger-back"[^>]*?width="([\d.]+)"/) || [])[1] || 0),
    label: (row.match(/class="ledger-value(?: is-back| is-none)?"[^>]*>([^<]*)</) || [])[1] || ''
  }));
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
