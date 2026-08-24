import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('file://' + path.join(root, 'test', 'look', 'deck.html'));
await p.waitForTimeout(1200);
const n = await p.$$eval('.deck-slide', s => s.length);
const seen = new Map();
for (let i = 0; i < n; i++) {
  await p.evaluate(idx => {
    document.querySelectorAll('.deck-slide').forEach((s, j) => s.classList.toggle('is-active', j === idx));
  }, i);
  await p.waitForTimeout(180);
  const hits = await p.$$eval('.deck-slide.is-active *', nodes => {
    const out = [];
    nodes.forEach(node => {
      if (node.children.length) return;
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.includes('·')) out.push(t.slice(0, 95));
    });
    return out;
  });
  hits.forEach(t => { if (!seen.has(t)) seen.set(t, i + 1); });
}
[...seen.entries()].forEach(([t, s]) => console.log('slide ' + s + '  ' + t));
await b.close();
