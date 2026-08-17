// What happens when the wrong file gets picked. A recipient will do this, and
// the failure has to be specific and recoverable, never a silent wrong number.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-inputs-'));
// An order log renamed to look like a quote week.
const mislabelled = path.join(tmp, 'Week 4 - 2026.xlsx');
fs.copyFileSync(ORDER, mislabelled);
// A quote week handed in as an order log.
const swapped = path.join(tmp, 'OrderLog_bogus.xlsx');
fs.copyFileSync(w(1), swapped);
// Something that is not a spreadsheet at all.
const junk = path.join(tmp, 'Week 5 - 2026.xlsx');
fs.writeFileSync(junk, 'this is not a workbook');
// A workbook with no recognisable week number in the name.
const unnamed = path.join(tmp, 'quotes-final-v2.xlsm');
fs.copyFileSync(w(2), unnamed);

const CASES = [
  { name: 'order log picked as a quote week', weeks: [mislabelled], orders: [ORDER] },
  { name: 'quote week picked as an order log', weeks: [w(1)], orders: [swapped] },
  { name: 'file that is not a spreadsheet', weeks: [junk], orders: [ORDER] },
  { name: 'no week number in the filename', weeks: [unnamed], orders: [ORDER] },
  { name: 'good weeks, junk order log', weeks: [w(1), w(2)], orders: [junk] },
];

const browser = await chromium.launch({ executablePath: CHROME });
const fails = [];
for (const c of CASES) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
  await p.click('[data-screen="data"]');
  await p.setInputFiles('#quoteFiles', c.weeks);
  await p.setInputFiles('#orderFiles', c.orders);
  await p.click('#runDashboard');
  // Either it refuses with a message, or it succeeds. Both are fine; hanging or
  // silently showing figures from nothing is not.
  await p.waitForFunction(
    () => !/reading selected sources/i.test(document.getElementById('runStatusTitle').textContent),
    null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => ({
    title: document.getElementById('runStatusTitle').textContent.trim(),
    copy: document.getElementById('runStatusCopy').textContent.trim().slice(0, 190),
    tone: document.getElementById('runStatus').dataset.tone || '',
    quotes: document.getElementById('railQuoted').textContent.trim(),
    stamp: document.getElementById('dataStamp').textContent.trim(),
  }));
  const refused = /could not|cannot|stopped|no |not |error|fail|need/i.test(r.title + ' ' + r.copy);
  const showsFigures = r.quotes !== '-' && r.quotes !== '' && Number(r.quotes) > 0;
  // The bad outcome: it shows numbers without having said anything about the problem.
  const bad = (showsFigures && !refused && c.name !== 'no week number in the filename') || errs.length > 0;
  if (bad) fails.push(c.name);
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${c.name}`);
  console.log(`        status : ${r.title}`);
  console.log(`        detail : ${r.copy}`);
  console.log(`        quoted : ${r.quotes}   tone: ${r.tone || '(none)'}`);
  if (errs.length) errs.slice(0, 2).forEach(e => console.log('        JS ERROR ' + e));
  await p.close();
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails.length ? 'Needs work: ' + fails.join('; ') : 'Every bad input produced a specific, recoverable message.'));
process.exit(fails.length ? 1 : 0);
