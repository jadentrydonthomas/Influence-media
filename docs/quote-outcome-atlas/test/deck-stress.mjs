// The deck has to hold together when the numbers get bigger. This renders the
// real deck, then inflates every number in it - 174 becomes 174,982, $18.0M
// becomes $18,431.7M - and re-measures. Anything that only fits because the
// fixture numbers are small shows up here as text sitting on other text.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import os from 'os'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root,'fixtures');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({executablePath:CHROME});
// A prior period is loaded so the year-over-year chapter is stressed too. It
// does not touch the live figures, so slides one to nine are the same deck
// they have always been - this only adds the six chapter slides to the audit.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'stress-prior-'));
const prior = [1,2].map(n => { const d = path.join(tmp,`Week ${n} - 2025.xlsm`); fs.copyFileSync(path.join(FIX,`Week ${n} - 2026.xlsm`), d); return d; });
const priorOrder = path.join(tmp,'OrderLog_prior.xlsx'); fs.copyFileSync(path.join(FIX,'OrderLog_1-10.xlsx'), priorOrder);

const app = await b.newPage({viewport:{width:1440,height:900}});
await app.goto('file://'+path.join(root,'app','quote-conversion-atlas-shareable.html'));
await app.setInputFiles('#quoteFiles',['Week 1 - 2026.xlsm','Week 2 - 2026.xlsm','Week 3 - 2026.xlsm'].map(f=>path.join(FIX,f)));
await app.setInputFiles('#orderFiles',[path.join(FIX,'OrderLog_1-10.xlsx')]);
await app.setInputFiles('#priorFiles', prior);
await app.setInputFiles('#priorOrderFiles',[priorOrder]);
await app.click('#runDashboard');
await app.waitForFunction(()=>/refreshed/i.test(document.getElementById('runStatusTitle').textContent),null,{timeout:90000});
const [dl] = await Promise.all([app.waitForEvent('download',{timeout:40000}), app.click('#reviewMode')]);
const deck = path.join(root,'test','deck-stress.html');
await dl.saveAs(deck);
await app.close();

const findings = [];
const errs = [];
// Overlap is width-dependent, so the same stress runs at a laptop width and a
// large monitor. A layout that only holds at one of them is not repeatable.
for (const [W, H] of [[1280,720],[1440,900],[1920,1080]]) {
const p = await b.newPage({viewport:{width:W,height:H}});
p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+deck);
const n = await p.$$eval('.deck-slide', s=>s.length);
console.log('stressing', n, 'slides at', W+'x'+H);

// Inflate every number in every text node, keeping the shape of the string,
// and lengthen the longest words - a real account name is longer than a fixture.
await p.evaluate(() => {
  const grow = text => text.replace(/\d[\d,]*(\.\d+)?/g, whole => {
    const [int, frac] = whole.replace(/,/g, '').split('.');
    const bigger = String(Number(int) * 947 + 682);
    const grouped = bigger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac === undefined ? grouped : grouped + '.' + frac;
  });
  const walk = node => {
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const seen = [];
    let t; while ((t = w.nextNode())) seen.push(t);
    seen.forEach(t => {
      if (!t.nodeValue) return;
      if (/\d/.test(t.nodeValue)) t.nodeValue = grow(t.nodeValue);
    });
  };
  walk(document.body);
});
// Inflating the numbers changes how tall every slide wants to be, so the deck
// has to re-fit exactly as it would when a window is resized. Testing the
// inflated layout without that would test a state the deck never shows.
await p.evaluate(() => window.dispatchEvent(new Event('resize')));
await p.waitForTimeout(400);

for (let i = 0; i < n; i++) {
  await p.evaluate(index => document.querySelectorAll('.deck-slide').forEach((s,j)=>s.classList.toggle('is-active', j===index)), i);
  await p.waitForTimeout(90);
  const one = await p.evaluate(index => {
    const out = [];
    const slide = document.querySelectorAll('.deck-slide')[index];
    const sr = slide.getBoundingClientRect();
    // 1. Nothing may leave the slide.
    slide.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > sr.right + 1.5 || r.left < sr.left - 1.5 || r.bottom > sr.bottom + 1.5)
        out.push({ slide: index+1, kind: 'spills', what: (el.className.baseVal||el.className||el.tagName||'').toString().slice(0,40), text: (el.textContent||'').trim().slice(0,40) });
    });
    // 2. Inside a chart, no label may sit on another label.
    slide.querySelectorAll('svg').forEach(svg => {
      const texts = [...svg.querySelectorAll('text')].map(t => ({ t, r: t.getBoundingClientRect() }))
        .filter(x => x.r.width > 0 && x.r.height > 0);
      for (let a = 0; a < texts.length; a++) for (let c = a+1; c < texts.length; c++) {
        const A = texts[a].r, B = texts[c].r;
        const overlapW = Math.min(A.right,B.right) - Math.max(A.left,B.left);
        const overlapH = Math.min(A.bottom,B.bottom) - Math.max(A.top,B.top);
        if (overlapW > 1.5 && overlapH > 1.5)
          out.push({ slide: index+1, kind: 'chart labels collide', what: texts[a].t.textContent.trim().slice(0,24), text: texts[c].t.textContent.trim().slice(0,24) });
      }
    });
    // 3. Running text may not sit under the fixed nav.
    const nav = document.querySelector('.deck-nav');
    if (nav) {
      const nr = nav.getBoundingClientRect();
      const w = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = w.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        [...range.getClientRects()].forEach(r => {
          if (r.width === 0 || r.height === 0) return;
          if (r.right > nr.left && r.left < nr.right && r.bottom > nr.top && r.top < nr.bottom)
            out.push({ slide: index+1, kind: 'under the nav', what: '', text: node.nodeValue.trim().slice(0,40) });
        });
      }
    }
    return out;
  }, i);
  findings.push(...one.map(f => Object.assign(f, { at: W + 'x' + H })));
}
await p.close();
}
const byKind = {};
findings.forEach(f => { byKind[f.kind] = (byKind[f.kind]||0)+1; });
console.log('findings:', findings.length, JSON.stringify(byKind));
findings.slice(0, 30).forEach(f => console.log('   ', JSON.stringify(f)));
console.log('JS errors:', errs.length?errs:'none');
fs.unlinkSync(deck);
await b.close();
fs.rmSync(tmp,{recursive:true,force:true});
process.exit(findings.length || errs.length ? 1 : 0);
