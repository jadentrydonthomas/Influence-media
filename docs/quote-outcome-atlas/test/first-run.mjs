// What a first-time recipient sees before loading anything.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
await p.waitForTimeout(900);
const r = await p.evaluate(() => {
  const active = document.querySelector('.screen.is-active');
  const run = document.querySelector('#runDashboard');
  const runBox = run.getBoundingClientRect();
  return {
    screen: active ? active.id : '(none)',
    heading: [...document.querySelectorAll('.screen.is-active h1, .screen.is-active h2')]
      .slice(0, 2).map(n => n.innerText.trim().replace(/\s+/g, ' ').slice(0, 80)),
    runButtonInViewport: runBox.height > 0 && runBox.top < window.innerHeight && runBox.bottom > 0,
    runButtonY: Math.round(runBox.top),
    status: document.getElementById('runStatusTitle').textContent.trim(),
    statusCopy: document.getElementById('runStatusCopy').textContent.trim().slice(0, 120),
  };
});
console.log(JSON.stringify(r, null, 2));
await p.screenshot({ path: path.join(root, 'test', 'first-open.png') });
await b.close();
