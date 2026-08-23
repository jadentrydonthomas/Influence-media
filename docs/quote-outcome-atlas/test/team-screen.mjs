// The Team performance screen. Its list, its chart and the sheet under it are
// one view of one roster, so they have to agree about the order they are in —
// and about what counts as a person. Work that arrived with no owner code is
// real and stays visible, but it cannot head a ranking of people.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const APP = path.join(root, 'app', 'quote-conversion-atlas-shareable.html');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const fails = [];
const check = (name, ok, detail) => { if (!ok) fails.push(name); console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + APP);
await page.setInputFiles('#quoteFiles', [1, 2, 3].map(n => path.join(FIX, `Week ${n} - 2026.xlsm`)));
await page.setInputFiles('#orderFiles', [path.join(FIX, 'OrderLog_1-10.xlsx')]);
await page.click('#runDashboard');
await page.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
await page.click('[data-screen="people"]');
await page.waitForTimeout(1000);

const listNames = () => page.$$eval('#teamRows .team-row .member-name strong', n => n.map(x => x.textContent.trim()));
const listValues = () => page.$$eval('#teamRows .team-row', rows => rows.map(r => {
  const el = r.querySelector('.member-metric strong, .member-metric');
  return el ? el.textContent.trim() : '';
}));

// Quote volume: the ranked measure the screen opens on.
{
  const names = await listNames();
  const unattributedAt = names.findIndex(n => /no initials/i.test(n));
  check('the roster ranks a person first, not the unowned bucket', unattributedAt !== 0, 'row 1 is ' + names[0]);
  check('the unowned bucket is held at the end of the roster', unattributedAt === -1 || unattributedAt === names.length - 1,
    'at ' + unattributedAt + ' of ' + names.length);
  check('the unowned row is marked as having no owner code',
    await page.$$eval('#teamRows .team-row.is-unattributed', n => n.length) === (unattributedAt === -1 ? 0 : 1));
}

// The chart beside the list is the same roster answering the same question, so
// it has to be in the same sequence.
const chartNames = () => page.$$eval('#teamChart .team-chart-row span:first-child, #teamChart .chart-row span:first-child, #teamChart [class*="row"] > span:first-child',
  n => n.map(x => x.textContent.trim()).filter(Boolean));
{
  const list = await listNames();
  const chart = await chartNames();
  check('the chart follows the list order', chart.length > 0 && chart.join(',') === list.join(','),
    list.slice(0, 4).join(',') + ' vs ' + chart.slice(0, 4).join(','));
}

// Changing the measure re-ranks both.
{
  const before = await listNames();
  await page.click('[data-team-metric="value"]');
  await page.waitForTimeout(700);
  const list = await listNames();
  const chart = await chartNames();
  check('choosing a measure re-ranks the list', list.join(',') !== before.join(','),
    before.slice(0, 3).join(',') + ' → ' + list.slice(0, 3).join(','));
  check('the chart re-ranks with it', chart.join(',') === list.join(','),
    list.slice(0, 4).join(',') + ' vs ' + chart.slice(0, 4).join(','));
  const unattributedAt = list.findIndex(n => /no initials/i.test(n));
  check('the unowned bucket stays at the end on every measure', unattributedAt === -1 || unattributedAt === list.length - 1,
    'at ' + unattributedAt + ' of ' + list.length);
}

// A rate chart is deliberately ordered most-scored first. That is a different
// order from the list, so the description has to say so.
{
  await page.click('[data-team-metric="conversion"]');
  await page.waitForTimeout(700);
  const description = await page.$eval('#teamChartDescription', n => n.textContent);
  check('a rate chart states the order it is in', /most-scored first/i.test(description), description.slice(0, 60));
}

// The capacity list is what the panel is for: the overruns come first.
{
  await page.click('[data-team-metric="volume"]');
  await page.waitForTimeout(700);
  const variances = await page.$$eval('#teamLoad .cap-row b', n => n.map(x => Number(x.textContent.replace('−', '-').replace('+', ''))));
  const sorted = variances.slice().sort((a, b) => a - b);
  check('the capacity rows run biggest overrun first', variances.join(',') === sorted.join(','), variances.join(','));
  const note = await page.$eval('#teamLoadNote', n => n.textContent);
  check('the capacity panel states both orders', /biggest overrun first/i.test(note) && /ordered by quote volume/i.test(note));
}

// "1 quotes" anywhere on the screen.
{
  const text = await page.$eval('#people', n => n.innerText);
  const bad = (text.match(/\b1 (quotes|wins|jobs|orders|people|persons|hours)\b/g) || []).slice(0, 4);
  check('a count of one takes a singular unit', bad.length === 0, bad.join(' '));
}

// The account list's bar used to be drawn on quote counts while the figures
// beside it were money, so an account that booked two of three quotes drew a
// mostly-filled bar next to "$283k of $828k".
{
  await page.click('[data-screen="customers"]');
  await page.waitForTimeout(900);
  const rows = await page.$$eval('#custRows .account-row', nodes => nodes.slice(0, 12).map(row => {
    const ask = row.querySelector('.askbook-track .ask');
    const book = row.querySelector('.askbook-track .book');
    const value = row.querySelector('.account-value b');
    const of = row.querySelector('.account-value small');
    const num = text => {
      const m = (text || '').replace(/[^0-9.kMB]/g, '');
      const n = parseFloat(m);
      if (!isFinite(n)) return null;
      return /M/.test(text) ? n * 1000 : /B/.test(text) ? n * 1000000 : n;
    };
    return {
      ask: ask ? parseFloat(ask.style.width) : null,
      book: book ? parseFloat(book.style.width) : 0,
      returned: num(value && value.textContent),
      asked: num(of && of.textContent),
    };
  }));
  // Without this the check below passes vacuously if the parsing ever breaks.
  const readable = rows.filter(r => r.asked && r.ask);
  check('the account rows parsed', readable.length >= 5, readable.length + ' of ' + rows.length);
  const bad = rows.filter(r => r.asked && r.ask
    // The filled share of the bar has to be the returned share of what was asked.
    && Math.abs((r.book / r.ask) - (r.returned / r.asked)) > 0.06);
  check('the account bar carries the same measure as the figure beside it', bad.length === 0,
    bad.slice(0, 2).map(r => `bar ${(r.book / r.ask * 100).toFixed(0)}% vs figure ${(r.returned / r.asked * 100).toFixed(0)}%`).join(' | '));
  const names = await page.$$eval('#custRows .account-name strong', n => n.map(x => x.textContent.trim()));
  check('no account name is clipped to an ellipsis', names.every(n => !/…$/.test(n)), names.filter(n => /…$/.test(n)).join(' | '));
}

// M-47 and M-48 on this screen, not just on the year-over-year one it mirrors.
{
  await page.click('[data-screen="people"]');
  await page.waitForTimeout(700);
  await page.click('[data-team-metric="conversion"]');
  await page.waitForTimeout(800);
  const rows = await page.$$eval('#teamRows .team-row', nodes => nodes.map(row => {
    const sub = row.querySelector('.member-name span');
    const metric = row.querySelector('.member-metric');
    const bar = row.querySelector('.member-bar b');
    const quotes = sub ? Number((sub.textContent.match(/(\d[\d,]*) quotes?/) || [])[1] || '0'.replace(/,/g, '')) : 0;
    return {
      name: (row.querySelector('.member-name strong') || {}).textContent || '',
      quotes: quotes,
      value: metric ? metric.textContent.replace(/\s+/g, ' ').trim() : '',
      thin: /thin/i.test(metric ? metric.textContent : ''),
      bar: bar ? parseFloat(bar.style.getPropertyValue('--member-bar')) : null,
      unowned: row.classList.contains('is-unattributed'),
    };
  }));
  const owned = rows.filter(r => !r.unowned);
  const noBook = owned.filter(r => r.quotes === 0);
  check('a close rate with no quotes behind it reads as a dash, not as zero',
    noBook.length > 0 && noBook.every(r => r.value.startsWith('—')),
    noBook.map(r => r.name.trim() + ' ' + r.value).join(' | '));
  const solidIndexes = owned.map((r, i) => ({ r, i })).filter(x => x.r.quotes >= 10).map(x => x.i);
  const thinIndexes = owned.map((r, i) => ({ r, i })).filter(x => x.r.thin).map(x => x.i);
  check('a rate on a thin book is marked', thinIndexes.length > 0, thinIndexes.length + ' marked');
  check('every thin book ranks below every solid one',
    thinIndexes.every(t => solidIndexes.every(sIdx => sIdx < t)),
    'thin at ' + thinIndexes.join(',') + ' · solid at ' + solidIndexes.join(','));
  check('a thin rate draws no emphasis bar',
    owned.filter(r => r.thin).every(r => !r.bar),
    owned.filter(r => r.thin && r.bar).map(r => r.name.trim()).join(' | '));
  const summary = await page.$eval('#teamSummary', n => n.innerText);
  check('the sentence over the list reads off the same floor', /under 10 quotes/.test(summary), summary.slice(-70));
}

// The analysis panels put a bar and a figure on the same row. They have to be
// the same measure: a bar drawn on quote counts beside a conversion rate, or on
// value beside a rate, invites a reader to take one for the other.
{
  await page.click('[data-screen="overview"]');
  await page.waitForTimeout(700);
  for (const tab of ['bands', 'districts']) {
    await page.click(`[data-analysis="${tab}"]`);
    await page.waitForTimeout(700);
    const rows = await page.$$eval('#analysisBody .segment-row', nodes => nodes.map(row => {
      const fill = row.querySelector('.segment-track i');
      const figure = row.querySelector('b');
      const text = figure ? figure.textContent.trim() : '';
      const n = parseFloat(text.replace(/[^0-9.]/g, ''));
      return {
        width: fill ? parseFloat(fill.style.getPropertyValue('--segment')) : null,
        value: isFinite(n) ? (/M$/.test(text) ? n * 1000 : n) : null,
      };
    }));
    const readable = rows.filter(r => r.width !== null && r.value !== null && r.value > 0);
    check(`the ${tab} rows parsed`, readable.length >= 3, readable.length + ' of ' + rows.length);
    // Ranking by the figure and ranking by the bar must give the same order.
    const byFigure = readable.slice().sort((a, b) => b.value - a.value).map(r => r.width);
    const sortedWidths = readable.map(r => r.width).sort((a, b) => b - a);
    check(`the ${tab} bar and figure rank the same way`, byFigure.join(',') === sortedWidths.join(','),
      byFigure.slice(0, 4).join(',') + ' vs ' + sortedWidths.slice(0, 4).join(','));
  }
}

check('no JS errors', errs.length === 0, errs.slice(0, 2).join('; '));
await browser.close();
console.log('\n' + (fails.length ? 'FAILURES:\n  ' + fails.join('\n  ') : 'The roster, its chart and its sheet are one view in one order, and unowned work is counted without being ranked as a person.'));
process.exit(fails.length ? 1 : 0);
