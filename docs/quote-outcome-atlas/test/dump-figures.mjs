// Dumps every figure the dashboard displays, for independent verification
// against the workbooks by test/audit.py.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
await p.click('[data-screen="data"]');
await p.setInputFiles('#quoteFiles', ['Week 1 - 2026.xlsm', 'Week 2 - 2026.xlsm', 'Week 3 - 2026.xlsm'].map(f => path.join(FIX, f)));
await p.setInputFiles('#orderFiles', [path.join(FIX, 'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 90000 });
await p.waitForTimeout(700);

const out = { scopes: {}, lenses: {}, people: {} };

// Every exposure lens, so the cohort filtering is checked too.
for (const scope of ['all', 'mature', 'high']) {
  await p.click(`[data-scope="${scope}"]`).catch(() => {});
  await p.waitForTimeout(450);
  out.scopes[scope] = await p.evaluate(() => ({
    quotes: document.getElementById('railQuoted').textContent.trim(),
    wins: document.getElementById('railOrders').textContent.trim(),
    conv: document.getElementById('railConversion').textContent.trim(),
    value: document.getElementById('railQuoteValue').textContent.trim(),
    onTime: document.getElementById('railOnTime').textContent.trim(),
    onTimeCoverage: document.getElementById('railOnTimeCoverage').textContent.trim(),
    unconverted: document.getElementById('unconvertedCount').textContent.trim(),
    kpis: [...document.querySelectorAll('#metricRings > *')].map(n => n.innerText.replace(/\s+/g, ' ')),
  }));
}

await p.click('[data-scope="mature"]');
await p.waitForTimeout(400);
for (const lens of ['outcomes', 'bands', 'districts', 'compare']) {
  await p.click(`[data-analysis="${lens}"]`);
  await p.waitForTimeout(400);
  out.lenses[lens] = await p.$eval('#analysisBody', n => n.innerText.replace(/\s+/g, ' ').trim());
}

await p.click('[data-screen="people"]');
await p.waitForTimeout(500);
for (const role of ['engineers', 'estimators', 'schedulers']) {
  await p.click(`[data-role="${role}"]`).catch(() => {});
  await p.waitForTimeout(450);
  out.people[role] = await p.$$eval('#teamRows > *', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
}

fs.writeFileSync(path.join(root, 'test', 'figures.json'), JSON.stringify(out, null, 2));
console.log('wrote test/figures.json');
console.log('scopes:', Object.keys(out.scopes).map(k => `${k}=${out.scopes[k].quotes}/${out.scopes[k].wins}`).join(' '));
console.log('roles:', Object.keys(out.people).map(k => `${k}=${out.people[k].length}`).join(' '));
await b.close();
