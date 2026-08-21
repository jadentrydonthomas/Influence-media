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
  customers: ['#cmpCustomerLede .yoy-stat', '#cmpBrief .brief-row', '#cmpBrief .pair-cell', '#cmpFlow .flow-block',
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
await p.click('[data-cmp-person-metric="quotes"]');
await p.waitForTimeout(400);

// Borrowed order log: the screen must say so rather than imply a real read.
await load({ withPrior: true, withPriorOrder: false });
await p.click('[data-screen="compare"]'); await p.waitForTimeout(600);
check('a prior period with no order log of its own says so', /add a prior order log/.test(await text('#compareBanner')));

check('no JS errors', errs.length === 0, errs.slice(0, 2).join('; '));
await b.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'Year over year renders seven views, states its finding, names who left, and declares its own limits.'));
process.exit(fails.length ? 1 : 0);
