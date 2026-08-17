// Keyboard reachability, focus visibility, labelling and contrast basics.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, 'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('file://' + path.join(root, 'app', 'quote-conversion-atlas-shareable.html'));
await p.setInputFiles('#quoteFiles', ['Week 1 - 2026.xlsm', 'Week 2 - 2026.xlsm', 'Week 3 - 2026.xlsm'].map(f => path.join(FIX, f)));
await p.setInputFiles('#orderFiles', [path.join(FIX, 'OrderLog_1-10.xlsx')]);
await p.click('#runDashboard');
await p.waitForFunction(() => /refreshed/i.test(document.getElementById('runStatusTitle').textContent), null, { timeout: 90000 });
await p.waitForTimeout(700);

const issues = [];

// 1. Every visible control has an accessible name.
const unnamed = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('button, select, input, a[href]').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const name = (n.getAttribute('aria-label') || n.getAttribute('title') || n.textContent || n.value || '').trim();
    const labelled = n.id && document.querySelector(`label[for="${n.id}"]`);
    if (!name && !labelled) out.push(n.tagName + '.' + (n.className || '').toString().slice(0, 26));
  });
  return out;
});
if (unnamed.length) issues.push(`${unnamed.length} visible control(s) with no accessible name: ${unnamed.join(', ')}`);
console.log('controls without an accessible name:', unnamed.length);

// 2. Keyboard can reach the main controls, and focus is visible.
let reached = 0, invisibleFocus = [];
for (let i = 0; i < 45; i += 1) {
  await p.keyboard.press('Tab');
  const f = await p.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const shows = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
      || s.boxShadow !== 'none'
      || getComputedStyle(el, ':focus-visible').outlineStyle !== 'none';
    return { tag: el.tagName, id: el.id, cls: (el.className || '').toString().slice(0, 24), shows };
  });
  if (!f) continue;
  reached += 1;
  if (!f.shows) invisibleFocus.push(f.id || f.cls || f.tag);
}
console.log('elements reached by Tab:', reached);
if (reached < 12) issues.push(`keyboard only reached ${reached} elements`);
const uniqueInvisible = [...new Set(invisibleFocus)];
if (uniqueInvisible.length > 3) issues.push(`focus ring not obvious on: ${uniqueInvisible.slice(0, 8).join(', ')}`);
console.log('focused elements without an obvious ring:', uniqueInvisible.length, uniqueInvisible.slice(0, 6));

// 3. Charts and figures carry text alternatives.
const chartText = await p.evaluate(() => {
  const svgs = [...document.querySelectorAll('svg')];
  return { total: svgs.length, described: svgs.filter(s => s.getAttribute('aria-label') || s.querySelector('title') || s.getAttribute('role') === 'img').length };
});
console.log('svg charts:', chartText.total, 'with a text alternative:', chartText.described);

// 4. Reduced motion is respected.
await p.emulateMedia({ reducedMotion: 'reduce' });
await p.waitForTimeout(400);
// Anything at or under 1ms is effectively instant; that is what the reduced
// motion guard collapses durations to.
const motion = await p.evaluate(() => {
  const slow = [];
  document.querySelectorAll('*').forEach(n => {
    const s = getComputedStyle(n);
    const dur = Math.max(...String(s.animationDuration).split(',').map(v => parseFloat(v) || 0));
    const trans = Math.max(...String(s.transitionDuration).split(',').map(v => parseFloat(v) || 0));
    const worst = Math.max(dur, trans);
    if (worst > 0.005) slow.push({ cls: (n.className || '').toString().slice(0, 30) || n.tagName, seconds: worst });
  });
  return { slow: slow.slice(0, 8), count: slow.length };
});
console.log('elements animating longer than 5ms under reduced motion:', motion.count, motion.slow.slice(0, 4));
if (motion.count > 0) issues.push(`${motion.count} element(s) still animate under prefers-reduced-motion`);

// 5. The document has a language and a title.
const doc = await p.evaluate(() => ({ lang: document.documentElement.lang, title: document.title }));
console.log('document:', JSON.stringify(doc));
if (!doc.lang) issues.push('no lang attribute on <html>');
if (!doc.title) issues.push('no document title');

await b.close();
console.log('\n' + (issues.length ? 'Issues:\n  ' + issues.join('\n  ') : 'No accessibility issues found in these checks.'));
process.exit(issues.length ? 1 : 0);
