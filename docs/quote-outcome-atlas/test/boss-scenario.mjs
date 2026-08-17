// Simulates what actually happens on a recipient's laptop: a copy of the file
// in a different folder, a clean browser profile, the run repeated, the file
// set changed without reloading, and every external request blocked.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// "Emailed it to himself and saved it to Downloads."
const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-downloads-'));
const copied = path.join(inbox, 'quote-conversion-atlas-shareable.html');
fs.copyFileSync(path.join(root, 'app', 'quote-conversion-atlas-shareable.html'), copied);
console.log('copied to', copied, '·', fs.statSync(copied).size, 'bytes');

const w = n => path.join(FIX, `Week ${n} - 2026.xlsm`);
const ORDER = path.join(FIX, 'OrderLog_1-10.xlsx');
const fail = [];

const browser = await chromium.launch({ executablePath: CHROME });
// Fresh context: no IndexedDB, no storage, like a genuine first open.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

// Block anything that is not local: proves the file needs no network.
let external = 0;
await p.route('**', route => {
  const u = route.request().url();
  if (!/^(file|data|blob):/.test(u)) { external += 1; return route.abort(); }
  return route.continue();
});

await p.goto('file://' + copied);
await p.waitForTimeout(800);

const firstOpen = await p.evaluate(() => ({
  stamp: document.getElementById('dataStamp').textContent.trim(),
  status: document.getElementById('runStatusTitle').textContent.trim(),
}));
const landing = await p.evaluate(() => {
  const active = document.querySelector('.screen.is-active');
  const box = document.querySelector('#runDashboard').getBoundingClientRect();
  return { screen: active ? active.id : '(none)', runVisible: box.height > 0 && box.top < window.innerHeight };
});
console.log('first open:', JSON.stringify(firstOpen), '· lands on', landing.screen, '· run button visible:', landing.runVisible);
if (landing.screen !== 'data') fail.push('first open does not land on Data Mapping, it lands on ' + landing.screen);
if (!landing.runVisible) fail.push('the run button is not visible on first open');
if (!/awaiting|import|preview|incomplete/i.test(firstOpen.stamp + ' ' + firstOpen.status)) {
  fail.push('first open does not present as a blank intake: ' + JSON.stringify(firstOpen));
}

async function run(weeks, label) {
  await p.click('[data-screen="data"]');
  await p.waitForTimeout(250);
  await p.setInputFiles('#quoteFiles', weeks);
  await p.setInputFiles('#orderFiles', [ORDER]);
  const t0 = Date.now();
  await p.click('#runDashboard');
  await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 120000 });
  const ms = Date.now() - t0;
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    quotes: document.getElementById('railQuoted').textContent.trim(),
    wins: document.getElementById('railOrders').textContent.trim(),
    conv: document.getElementById('railConversion').textContent.trim(),
  }));
  console.log(`${label}: ${JSON.stringify(r)} in ${ms}ms`);
  return { ...r, ms };
}

const a = await run([w(1), w(2), w(3)], 'run 1  (W1-W3)          ');
const afterRun = await p.evaluate(() => (document.querySelector('.screen.is-active') || {}).id);
console.log('after a successful run it moves to:', afterRun);
if (afterRun !== 'overview') fail.push('a successful run does not land on the Outcome dashboard, it lands on ' + afterRun);
const b = await run([w(1), w(2), w(3)], 'run 2  same files       ');
if (a.quotes !== b.quotes || a.conv !== b.conv) fail.push('a repeated run gave a different answer');
const c = await run([w(1), w(2)], 'run 3  fewer weeks      ');
if (c.quotes === a.quotes) fail.push('changing the file set did not change the result');
const d = await run([w(1), w(2), w(3)], 'run 4  back to original ');
if (d.quotes !== a.quotes || d.conv !== a.conv) fail.push('returning to the original set did not reproduce the original answer');

const [dl] = await Promise.all([
  p.waitForEvent('download', { timeout: 40000 }).catch(() => null),
  p.click('#reviewMode'),
]);
console.log('deck export after four runs:', dl ? 'ok' : 'FAILED');
if (!dl) fail.push('deck export failed after repeated runs');

console.log('external network requests attempted:', external);
if (external) fail.push(external + ' external requests attempted - not fully offline');
console.log('JS errors:', errs.length ? errs : 'none');
if (errs.length) fail.push(errs.length + ' JS errors');

await browser.close();
fs.rmSync(inbox, { recursive: true, force: true });
console.log('\n' + (fail.length ? 'FAILURES:\n  ' + fail.join('\n  ') : 'All boss-scenario checks passed.'));
process.exit(fail.length ? 1 : 0);
