// Every surface, driven with the real year-over-year books and measured rather
// than looked at. It reports four classes of defect that a screenshot review
// keeps missing: a figure that formatted to nothing, a panel that drew nothing,
// anything painted outside the screen it belongs to, and any two pieces of text
// whose ink lands on the same pixels.
//
// It runs at five widths and in both themes, because every one of those defects
// has appeared at one width and not another. It needs the real books in
// fixtures/yoy — those never enter this repository, so it skips instead of
// failing when they are not there.
import { chromium } from 'playwright';
import { openReal, haveReal } from './yoy-real.mjs';
if (!haveReal()) { console.log('real year-over-year fixtures not present, skipping'); process.exit(0); }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const screens = ['overview','people','customers','timeline','compare','data'];
const views = ['headline','momentum','speed','mix','customers','people','ledger'];
const passes = [
  { width: 1512, height: 950, dark: false },
  { width: 1440, height: 900, dark: false },
  { width: 1366, height: 768, dark: false },
  { width: 1280, height: 800, dark: false },
  { width: 1024, height: 768, dark: false },
  { width: 1440, height: 900, dark: true }
];
const findings = [];
const jsErrors = [];
async function scan(p, label, at) {
  const out = await p.evaluate(name => {
    const live = [...document.querySelectorAll('.screen')].find(s => s.classList.contains('is-active'));
    if (!live) return { name, problems: ['no active screen'] };
    const problems = [];
    const text = live.innerText;
    // Formatting tells
    const bad = text.match(/\$0\.0M|\bNaN\b|\bundefined\b|\bInfinity\b|\$-|-\$0\b|—%|\.00%|\bnullb?\b/g);
    if (bad) problems.push('formatting: ' + [...new Set(bad)].join(', '));
    if (/\$0\.0M/.test(text)) {
      [...live.querySelectorAll('*')].forEach(node => {
        if (node.children.length) return;
        if (!/\$0\.0M/.test(node.textContent)) return;
        problems.push('zero-money at: ' + ((node.className.baseVal || node.className || node.tagName) + '').slice(0,26)
          + ' in #' + ((node.closest('[id]') || {}).id || '?') + ' :: ' + node.textContent.trim().slice(0, 46));
      });
    }
    // Empty containers that should have drawn something
    live.querySelectorAll('.ops-body, .cmp-view > section .ops-body').forEach(node => {
      if (node.offsetParent !== null && !node.innerHTML.trim()) problems.push('empty body: ' + (node.id || node.className));
    });
    // Horizontal spill
    const box = live.getBoundingClientRect();
    [...live.querySelectorAll('*')].forEach(node => {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // A node inside a horizontally scrolling container is allowed to be wider
      // than the screen; that is what the container is for.
      let scroller = node.parentElement, scrolls = false;
      while (scroller && scroller !== live) {
        const style = getComputedStyle(scroller);
        if (/auto|scroll/.test(style.overflowX)) { scrolls = true; break; }
        scroller = scroller.parentElement;
      }
      if (scrolls) return;
      if (r.right > box.right + 1.5 || r.left < box.left - 1.5)
        problems.push('spill: ' + ((node.className.baseVal || node.className || node.tagName) + '').slice(0, 30)
          + ' by ' + Math.round(Math.max(r.right - box.right, box.left - r.left)) + 'px');
    });
    // Text overlapping other text, measured on the text itself
    const rects = [];
    const walker = document.createTreeWalker(live, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      // Adjacent line boxes of one wrapped heading overlap by design when the
      // leading is tight; only compare text that belongs to different elements.
      const owner = node.parentElement;
      // Content scrolled out of a clipping ancestor still reports a layout
      // rect, and that rect lands on top of whatever is further down the page.
      // It is not painted there, so it is not a collision.
      // Every clipping ancestor, not the first one found: an account name
      // carries overflow:hidden of its own for the ellipsis, which would stop
      // the walk before it reached the list that actually clips it.
      const boxes = [];
      for (let clip = owner; clip && clip !== live; clip = clip.parentElement) {
        const style = getComputedStyle(clip);
        if (/auto|scroll|hidden/.test(style.overflowY + style.overflowX)) boxes.push(clip.getBoundingClientRect());
      }
      // A line box is taller than the ink in it, and a 60px numeral set on a
      // tight leading has a box that reaches over the label above it without a
      // pixel of either touching. Compare the ink band, not the line box.
      const size = parseFloat(getComputedStyle(owner).fontSize) || 12;
      for (const raw of range.getClientRects()) {
        if (raw.width <= 2 || raw.height <= 2) continue;
        // Ellipsised text still reports its full unclipped rect, so the rect is
        // intersected with every clipping ancestor rather than only dropped
        // when it falls entirely outside one.
        let left = raw.left, right = raw.right, top = raw.top, bottom = raw.bottom;
        for (const box of boxes) {
          left = Math.max(left, box.left); right = Math.min(right, box.right);
          top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
        }
        if (right - left <= 2 || bottom - top <= 2) continue;
        const ink = Math.min(bottom - top, size * 0.80);
        const mid = (top + bottom) / 2;
        rects.push({ r: { left, right, top: mid - ink / 2, bottom: mid + ink / 2, height: ink },
          t: node.nodeValue.trim(), owner });
      }
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].owner === rects[j].owner) continue;
      if (rects[i].owner && rects[j].owner && (rects[i].owner.contains(rects[j].owner) || rects[j].owner.contains(rects[i].owner))) continue;
      const a = rects[i].r, c = rects[j].r;
      const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (ox > 3 && oy > 3) {
        const own = n => n ? ((n.className.baseVal || n.className || n.tagName) + '').slice(0, 30) + '#' + ((n.closest('[id]')||{}).id || '?') : '?';
        problems.push('text overlap: "' + rects[i].t.slice(0,20) + '" [' + own(rects[i].owner) + '] / "' + rects[j].t.slice(0,20) + '" [' + own(rects[j].owner) + '] ox=' + ox.toFixed(0) + ' oy=' + oy.toFixed(0));
      }
    }
    return { name, problems: [...new Set(problems)].slice(0, 12) };
  }, label);
  if (out.problems.length) findings.push(Object.assign(out, { at: at }));
}


for (const pass of passes) {
  const at = pass.width + 'x' + pass.height + (pass.dark ? ' dark' : ' light');
  const p = await openReal(b, { width: pass.width, height: pass.height });
  if (pass.dark) { await p.click('#themeButton'); await p.waitForTimeout(500); }
  for (const screen of screens) {
    await p.click(`[data-screen="${screen}"]`); await p.waitForTimeout(800);
    if (screen === 'compare') {
      for (const view of views) {
        await p.click(`[data-compare-view="${view}"]`); await p.waitForTimeout(700);
        await scan(p, 'compare/' + view, at);
      }
    } else {
      await scan(p, screen, at);
    }
  }
  jsErrors.push(...p.__errors.map(message => at + ': ' + message));
  console.log('scanned', at);
  await p.close();
}
await b.close();

findings.forEach(item => {
  console.log('  ' + item.at + '  ' + item.name);
  item.problems.forEach(problem => console.log('      ' + problem));
});
if (jsErrors.length) jsErrors.slice(0, 6).forEach(message => console.log('  JS ERROR ' + message));
console.log(findings.length || jsErrors.length
  ? '\n' + findings.length + ' surface(s) carry a visual defect and ' + jsErrors.length + ' JS error(s).'
  : '\nEvery screen and every year-over-year view is clean at six width-and-theme combinations.');
process.exit(findings.length || jsErrors.length ? 1 : 0);
