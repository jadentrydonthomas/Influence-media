// The Year over year screen: a dashboard inside a dashboard. It must appear
// only with a prior period, every one of its six views must render real marks
// rather than empty containers, and it must survive the dark theme.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import os from 'os';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yoy-'));
const prior = [1, 2].map(n => { const d = path.join(tmp, `Week ${n} - 2025.xlsm`); fs.copyFileSync(w(n), d); return d; });
const priorOrder = path.join(tmp, 'OrderLog_prior.xlsx'); fs.copyFileSync(ORDER, priorOrder);

const fails = []; const check = (n, c, d) => { if (!c) fails.push(n); console.log((c ? 'ok   ' : 'FAIL ') + n + (d ? '  ' + d : '')); };
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1512, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));

async function load({ withPrior, withPriorOrder }) {
  await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await p.setInputFiles('#quoteFiles', [w(1), w(2), w(3)]);
  await p.setInputFiles('#orderFiles', [ORDER]);
  if (withPrior) await p.setInputFiles('#priorFiles', prior);
  if (withPriorOrder) await p.setInputFiles('#priorOrderFiles', [priorOrder]);
  await p.click('#runDashboard');
  await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  await p.waitForTimeout(800);
}
const text = id => p.$eval(id, n => n.innerText.replace(/\s+/g, ' ').trim());

await load({ withPrior: false });
check('the nav hides Year over year with no prior period', await p.$eval('[data-screen="compare"]', n => n.hidden));

await load({ withPrior: true, withPriorOrder: true });
check('the nav shows Year over year once a prior period is loaded', await p.$eval('[data-screen="compare"]', n => !n.hidden));
await p.click('[data-screen="compare"]');
await p.waitForTimeout(600);
check('the screen is the one on show', await p.$eval('#compare', n => n.classList.contains('is-active')));

const banner = await text('#compareBanner');
console.log('\n[banner] ' + banner + '\n');
check('the banner names both periods', /2026/.test(banner) && /2025/.test(banner));
check('the banner separates the two bases', /matched on/i.test(banner) && /every loaded week/i.test(banner));
check('the banner credits the prior order log', /joined to its own order log/.test(banner));

// One view visible at a time is the whole point of the sub-dashboard.
const views = ['headline', 'momentum', 'speed', 'mix', 'customers', 'people', 'ledger'];
check('there are seven views', await p.$$eval('[data-compare-panel]', n => n.length) === 7);
check('exactly one view is open at a time',
  await p.$$eval('[data-compare-panel]', n => n.filter(x => !x.hidden).length) === 1);

// Every view must draw real marks, not empty boxes.
const wants = {
  headline: ['#cmpHeadlineLede .yoy-stat', '#cmpAttribution .because-card', '#cmpAttribution .attr-ribbon', '#cmpChange .chg-row'],
  momentum: ['#cmpMomentumLede .yoy-stat', '#cmpWeekChart .swing-bar', '#cmpWeekChart .cmp-col', '#cmpWeekValueChart .cmp-col', '#cmpRace path'],
  speed: ['#cmpSpeedLede .yoy-stat', '#cmpSurvival .cmp-col, #cmpSurvival .ops-note', '#cmpTiming .chg-row'],
  mix: ['#cmpMixLede .yoy-stat', '#cmpLorenz .lorenz-line', '#cmpBandChart .cmp-col', '#cmpMixShift .chg-row', '#cmpDistricts .cmp-col'],
  customers: ['#cmpCustomerLede .yoy-stat', '#cmpBrief .brief-row', '#cmpBrief .pair-cell', '#cmpBrief .cust-sort-btn',
              '#cmpPayers .payer-row', '#cmpPayers .payer-strip', '#cmpFlow .flow-block',
              '#cmpLost .acct-table tbody tr, #cmpLost .analysis-empty',
              '#cmpGained .acct-table tbody tr, #cmpGained .analysis-empty', '#cmpQuadrant .quad-dot'],
  // The roster reads like Team performance now: a ranked list, one person open
  // beside it, a chart, and a reference sheet. Each of those four has to draw.
  people: ['#cmpPeopleLede .yoy-stat', '#cmpPeopleLayout .team-row', '#cmpPeopleLayout .person-card .pair-cell',
    '#cmpPeopleChart .cmp-col', '#cmpPeopleTable .ops-table tbody tr'],
  ledger: ['#cmpTable .ledger-group', '#cmpTable .ledger-row', '#cmpMethod li']
};
for (const view of views) {
  await p.click(`[data-compare-view="${view}"]`);
  await p.waitForTimeout(450);
  check(`${view}: its tab opens only its own view`,
    await p.$eval(`[data-compare-panel="${view}"]`, n => !n.hidden) &&
    await p.$$eval('[data-compare-panel]', n => n.filter(x => !x.hidden).length) === 1);
  for (const selector of wants[view]) {
    const count = await p.$$eval(selector, n => n.length);
    check(`${view}: ${selector.split(' ')[0]} draws marks`, count > 0, count + ' found');
  }
  const spill = await p.evaluate(name => {
    const box = document.querySelector(`[data-compare-panel="${name}"]`).getBoundingClientRect();
    return [...document.querySelectorAll(`[data-compare-panel="${name}"] *`)]
      .filter(n => { const r = n.getBoundingClientRect(); return r.width && (r.right > box.right + 1 || r.left < box.left - 1); })
      .slice(0, 3).map(n => (n.className.baseVal || n.className || n.tagName) + '');
  }, view);
  check(`${view}: nothing spills out of the column`, spill.length === 0, spill.join(', '));
  // Chart labels are placed by hand, so they are the ones that collide.
  const collisions = await p.evaluate(name => {
    const out = [];
    document.querySelectorAll(`[data-compare-panel="${name}"] svg`).forEach(svg => {
      const texts = [...svg.querySelectorAll('text')].map(t => ({ t: t, r: t.getBoundingClientRect() }))
        .filter(e => e.r.width && e.r.height);
      for (let a = 0; a < texts.length; a++) for (let c = a + 1; c < texts.length; c++) {
        const x = texts[a].r, y = texts[c].r;
        if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1.5 &&
            Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1.5)
          out.push('"' + texts[a].t.textContent.slice(0, 14) + '" / "' + texts[c].t.textContent.slice(0, 14) + '"');
      }
    });
    return out.slice(0, 4);
  }, view);
  check(`${view}: no chart label sits on another`, collisions.length === 0, collisions.join(' | '));
  await p.screenshot({ path: path.join(root, 'test', `yoy-${view}.png`), fullPage: true });
}

// The churn view is the point of the exercise: it has to name who to ring.
await p.click('[data-compare-view="customers"]');
await p.waitForTimeout(400);
const retention = await text('#cmpCustomerLede');
check('the customer lede states the base, the keepers and the losses',
  (/quoting last period/i.test(retention) && /came back/i.test(retention) && /gone quiet/i.test(retention) && /slipping/i.test(retention))
  || (/quoted in both/i.test(retention) && /only last period/i.test(retention) && /only this period/i.test(retention) && /weeks loaded/i.test(retention)),
  retention.slice(0, 90));
const lostHeads = await p.$$eval('#cmpLost thead th, #cmpLost .analysis-empty b', n => n.map(x => x.textContent.trim()).join('|'));
check('the churn list carries who, how much, how often and whose account it was',
  /Account/.test(lostHeads) && /Quotes/.test(lostHeads) && /Owner/.test(lostHeads) || /Nobody stopped asking/.test(lostHeads),
  lostHeads.slice(0, 90));

// No number may be missing anywhere on the screen.
const html = await p.$eval('#compare', n => n.innerHTML);
check('no figure resolves to NaN or undefined', !/NaN|undefined/.test(html.replace(/data:[^"')\s]+/g, '')),
  (html.match(/.{0,40}(NaN|undefined).{0,40}/) || [])[0] || '');

// Selecting a named account must land on that account's record.
const opener = await p.$('#cmpLost [data-open-account], #cmpGained [data-open-account]');
if (opener) {
  const key = await opener.getAttribute('data-open-account');
  await opener.click(); await p.waitForTimeout(600);
  const shown = await p.$eval('#cmpBrief .brief-head h3', n => n.textContent.trim());
  check('selecting an account opens its brief without leaving the screen',
    await p.$eval('#compare', n => n.classList.contains('is-active')) && shown.length > 1, key.slice(0, 24) + ' → ' + shown.slice(0, 24));
} else check('selecting an account opens its brief without leaving the screen', false, 'no account row rendered');

// The dark theme flips half the palette; a filled header must survive it.
await p.click('#themeButton');
await p.waitForTimeout(500);
const lowContrast = await p.evaluate(() => {
  const parse = colour => (colour.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = colour => { const [r, g, b] = parse(colour); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const out = [];
  document.querySelectorAll('#compare *').forEach(node => {
    if (!node.textContent.trim() || node.children.length || node.closest('[hidden]')) return;
    const style = getComputedStyle(node);
    let background = style.backgroundColor, walk = node;
    while (background === 'rgba(0, 0, 0, 0)' && walk.parentElement) { walk = walk.parentElement; background = getComputedStyle(walk).backgroundColor; }
    if (Math.abs(lum(style.color) - lum(background)) < 0.16)
      out.push(node.textContent.trim().slice(0, 22) + ' — ' + style.color + ' on ' + background);
  });
  return out.slice(0, 6);
});
check('every line survives the dark theme', lowContrast.length === 0, lowContrast.join(' | '));
await p.screenshot({ path: path.join(root, 'test', 'yoy-dark.png'), fullPage: true });
await p.click('#themeButton');
await p.waitForTimeout(400);

// A prior period wider than this one is the case churn actually shows up in:
// accounts that quoted in a prior week with no counterpart here have gone
// quiet, and the screen has to name them rather than report a count.
const wide = [1, 2, 3].map(n => { const d = path.join(tmp, `Week ${n} - 2025.xlsm`); fs.copyFileSync(w(n), d); return d; });
await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
await p.setInputFiles('#quoteFiles', [w(1), w(2)]);
await p.setInputFiles('#orderFiles', [ORDER]);
await p.setInputFiles('#priorFiles', wide);
await p.setInputFiles('#priorOrderFiles', [priorOrder]);
await p.click('#runDashboard');
await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
await p.waitForTimeout(900);
await p.click('[data-screen="compare"]');
await p.click('[data-compare-view="customers"]');
await p.waitForTimeout(600);
const churnRows = await p.$$eval('#cmpLost .acct-table tbody tr', n => n.length);
check('a wider prior period produces a real churn list', churnRows > 0, churnRows + ' accounts named');
const churn = await text('#cmpLost');
check('the churn list carries a name, a value and a last-quote date',
  /\$/.test(churn) && /20\d\d/.test(churn), churn.slice(0, 110));
check('the churn note warns when fewer weeks are loaded on this side',
  /may read as quiet/.test(await text('#cmpLostNote')));
// Who paid, both periods: the comparison the Customers screen has and this one
// did not. An account can quote in both periods and have stopped paying, and
// ranking on this period alone buried every one of them.
{
  await p.click('[data-compare-view="customers"]');
  await p.waitForTimeout(500);
  const payers = await p.$$eval('#cmpPayers .payer-row', rows => rows.map(row => ({
    name: (row.querySelector('.payer-name b') || {}).textContent || '',
    state: (row.querySelector('.payer-name i') || {}).textContent || '',
    then: (row.querySelector('.payer-figures i') || {}).textContent || '',
    now: (row.querySelector('.payer-figures b') || {}).textContent || ''
  })));
  check('the payer list names accounts and both periods',
    payers.length > 0 && payers.every(row => row.name && row.then && row.now),
    payers.length + ' payers, first ' + (payers[0] ? payers[0].name + ' ' + payers[0].then + '→' + payers[0].now : '—'));
  const strip = await p.$$eval('#cmpPayers .payer-strip > div', cells => cells.map(c => c.innerText.replace(/\s+/g, ' ').trim()));
  check('the payer strip states both bases and both directions', strip.length === 4, strip.join(' | ').slice(0, 110));
  // A sort the reader cannot reach is a sort that does not exist.
  const sorts = await p.$$eval('#cmpBrief .cust-sort-btn', b => b.length);
  check('the account list can be reordered by the question being asked', sorts >= 5, sorts + ' sorts');
  const before = await p.$eval('#cmpBrief .brief-row b', n => n.textContent.trim());
  await p.click('#cmpBrief [data-cmp-sort="fell"]');
  await p.waitForTimeout(400);
  const after = await p.$eval('#cmpBrief .brief-row b', n => n.textContent.trim());
  check('choosing a sort actually reorders the list', before !== after, before + ' → ' + after);
  await p.click('#cmpBrief [data-cmp-sort="combined"]');
  await p.waitForTimeout(300);
}

// Money and counts move in percent, rates move in points. A bar scaled on one
// unit printed beside a figure stated in the other is two answers to one
// question, and it read as a −7.1 pts bar longer than a −30.7% bar.
{
  await p.click('[data-compare-view="headline"]');
  await p.waitForTimeout(500);
  const blocks = await p.$$eval('#cmpChange .ops-subhead', n => n.map(x => x.textContent.trim()));
  check('the ranked list separates counts and money from rates', blocks.length === 2, blocks.join(' | '));
  const rows = await p.$$eval('#cmpChange .chg-row', list => list.map(row => ({
    label: (row.querySelector('.chg-label') || {}).textContent.trim(),
    delta: (row.querySelector('.chg-delta') || {}).textContent.trim(),
    // A row whose measure is not scored in both periods draws no fill at all.
    width: (() => { const fill = row.querySelector('.chg-fill'); return fill ? Number((fill.getAttribute('style') || '').replace(/[^\d.]/g, '')) || 0 : 0; })()
  })));
  const pts = rows.filter(r => /pts/.test(r.delta));
  const pct = rows.filter(r => /%$/.test(r.delta));
  check('both units are present', pts.length > 0 && pct.length > 0, pct.length + ' in percent, ' + pts.length + ' in points');
  // Within each unit, a bigger stated figure must draw a longer bar.
  const consistent = list => list.slice().sort((a, b) => b.width - a.width).every((row, i, sorted) =>
    i === 0 || Math.abs(parseFloat(sorted[i - 1].delta.replace(/[^\d.]/g, ''))) + 0.05
      >= Math.abs(parseFloat(row.delta.replace(/[^\d.]/g, ''))));
  check('bar length agrees with the figure beside it, in percent', consistent(pct), pct.map(r => r.label + ' ' + r.delta).join(' | ').slice(0, 90));
  check('bar length agrees with the figure beside it, in points', consistent(pts), pts.map(r => r.label + ' ' + r.delta).join(' | ').slice(0, 90));
}

check('the badge on the customers tab counts the losses',
  await p.$eval('#cmpLostBadge', n => !n.hidden && Number(n.textContent) > 0));
await p.screenshot({ path: path.join(root, 'test', 'yoy-churn.png'), fullPage: true });

// ---- The roster reads one question at a time -------------------------------
// It is built on the Team performance skeleton: pick a measure, rank by it,
// open one person beside the list. Three rules keep it honest and each has
// already been broken once, so each is asserted here.
await p.click('[data-compare-view="people"]');
await p.waitForTimeout(600);
const rosterHead = () => p.$eval('#cmpPeopleLayout .team-list-head', n => n.innerText.replace(/\s+/g, ' ').trim());
const rosterRows = () => p.$$eval('#cmpPeopleLayout .team-row', rows => rows.map(row => ({
  code: (row.querySelector('.member-initials') || {}).textContent || '',
  measure: (row.querySelector('.cmp-then-now') || {}).innerText.replace(/\s+/g, ' ').trim(),
  move: (row.querySelector('.member-bar span') || {}).innerText.replace(/\s+/g, ' ').trim(),
  thin: !!row.querySelector('.cmp-thin'),
  tone: ((row.querySelector('.cmp-move-track b') || {}).className || '')
})));

const byVolume = await rosterRows();
check('the roster ranks by the measure on show, largest first',
  byVolume.length > 1 && byVolume.every((row, i) =>
    i === 0 || Number(byVolume[i - 1].measure.split('→').pop()) >= Number(row.measure.split('→').pop())),
  byVolume.slice(0, 3).map(r => r.code + ' ' + r.measure).join(' | '));

await p.click('[data-cmp-person-metric="conversion"]');
await p.waitForTimeout(450);
check('choosing a measure re-heads and re-ranks the list', /close rate/i.test(await rosterHead()), await rosterHead());
const byRate = await rosterRows();
const firstThin = byRate.findIndex(row => row.thin);
check('a rate on a thin book is marked and ranked below every solid one',
  firstThin === -1 || byRate.slice(firstThin).every(row => row.thin),
  firstThin === -1 ? 'no thin books' : byRate.filter(r => r.thin).length + ' thin, first at ' + (firstThin + 1));

// A person who owned no quotes has no hours per quote. Reporting 0.00 against
// last period's 0.25 painted a hundred per cent improvement, in green, for
// having no book at all.
await p.click('[data-cmp-person-metric="hoursPerQuote"]');
await p.waitForTimeout(450);
const byHours = await rosterRows();
const empty = byHours.filter(row => /→ *—$/.test(row.measure));
check('a derived measure with no book reads as a dash, never as an improvement',
  empty.every(row => row.move === '—' && /is-flat/.test(row.tone)),
  empty.length + ' owners with no book this period');

// Selecting a person opens that person and nobody else.
const second = byHours[1] && byHours[1].code.trim();
if (second) {
  await p.click(`[data-cmp-person="${second}"]`);
  await p.waitForTimeout(400);
  check('selecting a row opens that person beside the list',
    (await p.$eval('#cmpPeopleLayout .person-card h3', n => n.textContent.trim())).length > 0
    && await p.$$eval('#cmpPeopleLayout .team-row[aria-pressed="true"]', rows => rows.length) === 1);
}
check('the roster sheet carries a row for every owner in the list',
  await p.$$eval('#cmpPeopleTable .ops-table tbody tr', rows => rows.length) === byHours.length,
  await p.$$eval('#cmpPeopleTable .ops-table tbody tr', rows => rows.length) + ' rows');
// The list, the chart and the reference sheet are one view. They used to be
// ordered three different ways on the same screen.
await p.click('[data-cmp-person-metric="wonValue"]');
await p.waitForTimeout(700);
{
  const listOrder = await p.$$eval('#cmpPeopleLayout .team-row .member-initials', n => n.map(x => x.textContent.trim()));
  const chartOrder = await p.$$eval('#cmpPeopleChart .cmp-col-label', n => n.map(x => x.textContent.trim()));
  const sheetOrder = await p.$$eval('#cmpPeopleTable tbody tr td:first-child b', n => n.map(x => x.textContent.trim()));
  check('the chart follows the list order', chartOrder.join(',') === listOrder.join(','),
    listOrder.slice(0, 5).join(',') + ' vs ' + chartOrder.slice(0, 5).join(','));
  check('the roster sheet follows the list order', sheetOrder.join(',') === listOrder.join(','),
    listOrder.slice(0, 5).join(',') + ' vs ' + sheetOrder.slice(0, 5).join(','));
  await p.click('[data-cmp-person-metric="quotes"]');
  await p.waitForTimeout(700);
  const reordered = await p.$$eval('#cmpPeopleChart .cmp-col-label', n => n.map(x => x.textContent.trim()));
  check('changing the measure reorders the chart too', reordered.join(',') !== chartOrder.join(','),
    chartOrder.slice(0, 4).join(',') + ' → ' + reordered.slice(0, 4).join(','));
}

// One product, one minus. A signed figure set with a hyphen sits next to one
// set with a true minus and reads as two different marks; the screen carried
// both on a single row of cards.
{
  await p.click('[data-screen="compare"]'); await p.waitForTimeout(500);
  const views = await p.$$eval('[data-compare-view]', n => n.map(x => x.getAttribute('data-compare-view')));
  const offenders = [];
  for (const view of views) {
    await p.click(`[data-compare-view="${view}"]`);
    await p.waitForTimeout(600);
    const found = await p.evaluate(() => {
      const panel = document.querySelector('#compare');
      const text = panel ? panel.innerText : '';
      // A hyphen directly in front of a figure that carries a unit. Dates and
      // ranges use other characters, so nothing else can match this.
      return (text.match(/-\$?\d[\d.,]*\s*(?:%|pts|points|M\b|k\b)/g) || []).slice(0, 4);
    });
    if (found.length) offenders.push(view + ': ' + found.join(' '));
  }
  check('every signed figure uses a true minus, not a hyphen', offenders.length === 0, offenders.join(' | '));
}

// "Some items are not shown": the comparison brief has to carry the same
// follow-up the main Customers profile carries — who priced the quote and
// whether it went out by the promised date, not only the date and the value.
{
  await p.click('[data-screen="compare"]'); await p.waitForTimeout(500);
  await p.click('[data-compare-view="customers"]'); await p.waitForTimeout(900);
  const metas = await p.$$eval('.brief-detail .brief-quote i', n => n.map(x => x.textContent.trim()));
  check('the comparison brief lists quotes', metas.length > 0, metas.length + ' rows');
  const withOwner = metas.filter(m => m.split('·').length >= 2);
  check('each quote in the brief names who priced it', withOwner.length === metas.length,
    metas.filter(m => m.split('·').length < 2).slice(0, 2).join(' | '));
  const withRelease = metas.filter(m => /(early|late|met the date)/i.test(m));
  check('the brief carries the release result where the workbook scored one',
    withRelease.length > 0, withRelease.slice(0, 2).join(' | '));
}

// Borrowed order log: the screen must say so rather than imply a real read.
await load({ withPrior: true, withPriorOrder: false });
await p.click('[data-screen="compare"]'); await p.waitForTimeout(600);
check('a prior period with no order log of its own says so', /add a prior order log/.test(await text('#compareBanner')));

check('no JS errors', errs.length === 0, errs.slice(0, 2).join('; '));
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'Year over year renders seven views, states its finding, names who left, and declares its own limits.'));
process.exit(fails.length ? 1 : 0);
