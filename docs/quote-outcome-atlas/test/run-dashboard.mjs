// Drives the real dashboard in Chromium against the real fixture workbooks and
// prints the rendered figures. This is the regression harness the spec's T-16
// asks for: any parser/model change is checked against these numbers.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const APP = path.join(root, 'app', 'quote-conversion-atlas-shareable.html');
const FIX = path.join(root, 'fixtures');
const WEEKS = ['Week 1 - 2026.xlsm', 'Week 2 - 2026.xlsm', 'Week 3 - 2026.xlsm'].map(f => path.join(FIX, f));
const ORDERS = [path.join(FIX, 'OrderLog_1-10.xlsx')];

const text = async (page, sel) => {
  const el = await page.$(sel);
  return el ? (await el.innerText()).replace(/\s+/g, ' ').trim() : '<missing ' + sel + '>';
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('file://' + APP);
await page.click('[data-screen="data"]');
await page.waitForTimeout(300);
await page.setInputFiles('#quoteFiles', WEEKS);
await page.setInputFiles('#orderFiles', ORDERS);
await page.waitForTimeout(300);
await page.click('#runDashboard');
await page.waitForFunction(() => {
  const n = document.querySelector('#railConversion');
  return n && n.textContent.trim() !== '' && !/^0(\.0)?%$/.test(n.textContent.trim());
}, null, { timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => /refreshed|complete|Dashboard/i.test(document.getElementById("runStatusTitle").textContent), null, { timeout: 60000 }).catch(()=>{});
 await page.waitForTimeout(800);

const out = {};
out.status = await text(page, '#runStatus, .run-status');
out.stamp = await text(page, '#dataStamp');
out.railConversion = await text(page, '#railConversion');
out.railConversionNote = await text(page, '#railConversionNote');
out.railQuoted = await text(page, '#railQuoted');
out.railQuoteValue = await text(page, '#railQuoteValue');
out.railOrders = await text(page, '#railOrders');
out.railOnTime = await text(page, '#railOnTime');
out.conversionValue = await text(page, '#conversionValue');
out.conversionCaption = await text(page, '#conversionCaption');
out.quotedCount = await text(page, '#quotedCount');
out.confirmedCount = await text(page, '#confirmedCount');
out.unconvertedCount = await text(page, '#unconvertedCount');
out.scopeNarrative = await text(page, '#scopeNarrative');
out.managementReadout = await text(page, '#managementReadout');

out.quality = await page.evaluate(() => {
  const ids = ['missingOrderQuoteCount', 'outsideWindowCount', 'invalidOrderQuoteCount',
    'duplicateOrderCount', 'headerFallbackCount', 'unmappedRosterCount',
    'missingEngineerCount', 'dateCorrectionCount', 'invalidDateCount'];
  const o = {};
  ids.forEach(id => { const n = document.getElementById(id); if (n) o[id] = n.textContent.trim(); });
  const d = document.getElementById('unmappedRosterDetail');
  if (d) o.unmappedRosterDetail = d.textContent.trim();
  return o;
});

out.kpis = await page.$$eval('#metricRings > *', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));

await page.click('[data-screen="people"]').catch(() => {});
await page.waitForTimeout(400);
out.teamSummary = await text(page, '#teamSummary');
out.teamRows = await page.$$eval('#teamRows > *', ns => ns.slice(0, 4).map(n => n.innerText.replace(/\s+/g, ' ').trim()));

await page.click('[data-screen="quotes"]').catch(() => {});
await page.waitForTimeout(400);
out.quoteRowCount = await page.$$eval('#quoteRows > *', ns => ns.length);

console.log(JSON.stringify(out, null, 2));
if (errors.length) { console.log('\n--- JS ERRORS ---'); errors.slice(0, 20).forEach(e => console.log(e)); }
else console.log('\nNo JS errors.');

await browser.close();
