/* Reading pages that carry no text layer: a print driver that turned every glyph into a vector outline (DocuWare
   Printer on an SC contract), or a scan. The page is rendered, its checkboxes are found and blanked, the words are
   recognised (Tesseract), and each word becomes an item like pdf.js would give: { str, x, y (baseline), w, h (em) }
   in top-origin page points, plus its confidence. Words drawn in red, and words struck through (a value the
   engineer replaced on the PCS), are told apart from the print.

   The engine is handed in, so the same code runs in the browser (tesseract.js in Web Workers, embedded in the
   tool) and in the Node tests:
     engine = { canvas(w, h), recognize(grey PNM bytes) -> tesseract.js page data (sparse text),
                line(grey PNM bytes) -> the same for one line of figures (digits and ' " - / . @ , : x only) } */
(function (root) {
  'use strict';

  const DPI = 300, MAX_PX = 16e6;   // 300 dpi reads 7 pt text well; a page is held under 16 MP (Safari's canvas cap)
  const scaleFor = (w, h) => Math.min(DPI / 72, Math.sqrt(MAX_PX / (w * h)));

  /* What a page is, from its native text and its drawing operators:
       text     : a text layer — read as is
       outlined : no text, but thousands of curved paths (every glyph an outline, ~20 segments each) — OCR
       scan     : no text, a page-size image — OCR
       drawing  : no text, line work (a floor plan: a few segments a path) — the plan reader takes it */
  function pageKind(nativeChars, opList, OPS) {
    if (nativeChars >= 200) return 'text';
    let paths = 0, segs = 0, big = false;
    const { fnArray, argsArray } = opList;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      if (fn === OPS.constructPath) { paths++; segs += argsArray[i][0].length; }
      else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && argsArray[i][1] * argsArray[i][2] > 1e6) big = true;
    }
    if (paths >= 150 && segs / paths >= 10) return 'outlined';
    if (big) return 'scan';
    return nativeChars ? 'text' : 'drawing';
  }

  const lum = (D, i) => (D[i] + D[i + 1] + D[i + 2]) / 3;
  const isRed = (D, i) => D[i] > 150 && D[i] - Math.max(D[i + 1], D[i + 2]) > 70;
  const isBlue = (D, i) => D[i + 2] > 120 && D[i + 2] - Math.max(D[i], D[i + 1]) > 60;
  // ink for the markup tests: dark print, or red / blue pen — not a yellow highlight, not the grey of a checkbox
  const isInk = (D, i) => lum(D, i) < 140 || isRed(D, i) || isBlue(D, i);

  /* Checkboxes: a square frame 6-14 pt a side standing on its own (not part of a table rule), with a tick inside or
     not. Found as connected components of anything not white; each is blanked so Tesseract does not read it as a
     letter, and kept (top-origin points) with its state for the Box 22 ticks. */
  function findBoxes(img, s) {
    const { width: W, height: H, data: D } = img, N = W * H;
    const on = new Uint8Array(N);
    for (let p = 0, i = 0; p < N; p++, i += 4) on[p] = lum(D, i) < 235 ? 1 : 0;
    const lo = 5.5 * s, hi = 14 * s, boxes = [];
    let stack = new Int32Array(1 << 16);
    for (let p0 = 0; p0 < N; p0++) {
      if (on[p0] !== 1) continue;
      let n = 0, sp = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, big = false;
      stack[sp++] = p0; on[p0] = 2;
      while (sp) {
        const p = stack[--sp], x = p % W, y = (p - x) / W;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (!big && (x1 - x0 > hi * 1.5 || y1 - y0 > hi * 1.5)) big = true;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const q = yy * W + xx;
            if (on[q] !== 1) continue;
            on[q] = 2;
            if (sp >= stack.length) { const t = new Int32Array(stack.length * 2); t.set(stack); stack = t; }
            stack[sp++] = q;
          }
        }
      }
      if (big) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (w < lo || h < lo || w > hi || h > hi || Math.abs(w - h) > 0.2 * Math.max(w, h)) continue;
      // a frame: each side a straight run of ink along its outer 3 px
      const band = Math.max(2, Math.round(0.08 * w));
      const cover = (ax, ay, bx, by, horiz) => {
        let c = 0, t = 0;
        if (horiz) for (let x = ax; x <= bx; x++) { t++; for (let y = ay; y <= by; y++) if (lum(D, (y * W + x) * 4) < 235) { c++; break; } }
        else for (let y = ay; y <= by; y++) { t++; for (let x = ax; x <= bx; x++) if (lum(D, (y * W + x) * 4) < 235) { c++; break; } }
        return c / t;
      };
      if (cover(x0, y0, x1, y0 + band, true) < 0.9 || cover(x0, y1 - band, x1, y1, true) < 0.9 ||
          cover(x0, y0, x0 + band, y1, false) < 0.9 || cover(x1 - band, y0, x1, y1, false) < 0.9) continue;
      // inside: white (empty), a tick (dark, part of the area) — not solid (a filled square is a bullet)
      const m = Math.round(0.2 * w);
      let dark = 0, any = 0, area = 0;
      for (let y = y0 + m; y <= y1 - m; y++) for (let x = x0 + m; x <= x1 - m; x++) { const i = (y * W + x) * 4; area++; if (lum(D, i) < 128) dark++; if (lum(D, i) < 235) any++; }
      if (!area || any / area > 0.6) continue;
      boxes.push({ x1: x0 / s, y1: y0 / s, x2: (x1 + 1) / s, y2: (y1 + 1) / s, checked: dark / area > 0.04, px: [x0, y0, x1, y1] });
    }
    return boxes;
  }
  function blank(img, boxes) {
    const { width: W, data: D } = img;
    boxes.forEach(b => {
      const [x0, y0, x1, y1] = b.px;
      for (let y = Math.max(0, y0 - 2); y <= Math.min(img.height - 1, y1 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) { const i = (y * W + x) * 4; D[i] = D[i + 1] = D[i + 2] = 255; }
    });
  }

  /* The colour of a word's ink, and whether a line runs through it: two or more rows in the middle of the letters'
     body (between the baseline and the cap or x height) inked across ~all the word's width. Letters never do that;
     a strike-out does. */
  function markup(img, bb, base, top) {
    const { width: W, height: H, data: D } = img;
    const x0 = Math.max(0, bb.x0), x1 = Math.min(W - 1, bb.x1), y0 = Math.max(0, bb.y0), y1 = Math.min(H - 1, bb.y1);
    let ink = 0, red = 0, blue = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      if (!isInk(D, i)) continue;
      ink++; if (isRed(D, i)) red++; else if (isBlue(D, i)) blue++;
    }
    const color = ink && red > 0.4 * ink ? 'red' : ink && blue > 0.4 * ink ? 'blue' : null;
    const body = base - top, wd = x1 - x0 + 1;
    // a pen line through printed (black) figures, drawn by hand so maybe on a slant: pen ink in the body of the letters
    // in nearly every column of the word
    if (ink && red + blue < 0.6 * ink && red + blue > 0.04 * ink) {
      let cols = 0;
      const ya = Math.max(0, Math.round(base - 0.9 * body)), yb = Math.min(H - 1, Math.round(base - 0.1 * body));
      for (let x = x0; x <= x1; x++) for (let y = ya; y <= yb; y++) { const i = (y * W + x) * 4; if (isRed(D, i) || isBlue(D, i)) { cols++; break; } }
      if (cols >= 0.85 * wd) return { color: null, struck: true };
    }
    let rows = 0, struck = false;
    for (let y = Math.round(base - 0.7 * body); y <= Math.round(base - 0.3 * body) && !struck; y++) {
      if (y < 0 || y >= H) { rows = 0; continue; }
      let run = 0, best = 0, gap = 0;
      for (let x = x0; x <= x1; x++) {
        if (isInk(D, (y * W + x) * 4)) { run += gap + 1; gap = 0; if (run > best) best = run; }
        else if (run && ++gap > 2) { run = 0; gap = 0; }
      }
      rows = best >= 0.9 * wd ? rows + 1 : 0;
      if (rows >= 2) struck = true;
    }
    return { color, struck };
  }

  /* Tesseract's usual slips on a PCS: curly marks for feet and inches, two quotes for one, O and l inside numbers,
     the foot mark lost (9-10" is 9'-10" — a PCS writes no other number that way), the space before an inch fraction
     lost (0'-21/2" is 0'-2 1/2": a PCS never writes an improper fraction), "(C)" read as the copyright sign. */
  function fixWord(t) {
    let s = String(t).replace(/[‘’′`´]/g, "'").replace(/[“”″]/g, '"').replace(/''/g, '"');
    s = s.replace(/^(\d)[TIl|]@/, '$1@').replace(/^@(?=\d)/, '1@');   // 1T@13'-6" (the @ split in two); @20'-0" (the 1 lost)
    if (/\d/.test(s) && /^[\dOoIlT|'"\-_\/.,:@#%()]+$/.test(s)) s = s.replace(/[Oo]/g, '0').replace(/[IlT|]/g, '1').replace(/_/g, '-');
    s = s.replace(/^(\d+@)?(\d+)-(\d+(?:\.\d+)?)(\/\d+)?"(,?)$/, (m, n, ft, a, f, c) => (f && +a < +f.slice(1) ? m : `${n || ''}${ft}'-${a}${f || ''}"${c}`));   // 2-3/4" is inches
    s = s.replace(/^(\d+@)?(\d+)-(\d+)'(,?)$/, `$1$2'-$3"$4`);   // 10-6' — the inch mark read as the foot mark, the foot mark lost
    s = s.replace(/^((?:\d+'-?)?)(\d{2,})\/(\d+)("?)$/, (m, ft, d, den, inch) => {
      if (+d < +den) return m;
      for (let k = d.length - 1; k >= 1; k--) {
        const whole = d.slice(0, k), num = d.slice(k);
        if (+num < +den && +whole < 12) return `${ft}${whole} ${num}/${den}${inch}`;
      }
      return m;
    });
    s = s.replace(/(\d)Ib(s?\b)/g, '$1lb$2');                      // 5,000Ib.
    s = s.replace(/^\$([1s]):$/, 'S$1:');                             // "$1: 0.076" is S1 (Box 3 seismic)
    if (/^[Il|]{2,4}$/.test(s) && /I/.test(s)) s = s.replace(/[l|]/g, 'I');   // "Ill" is the roman III (risk category)
    return s.replace(/^\(©\)$/, '(C)');
  }

  const median = a => { const b = a.slice().sort((p, q) => p - q); return b.length ? b[b.length >> 1] : null; };
  // symbols that sit on the baseline (no descender) and that reach the cap height or only the x height
  const ON_BASE = /^[A-PR-Za-fh-ik-or-xz0-9]$/, CAP = /^[A-Z0-9bdfhklt]$/, XH = /^[acemnorsuvwxz]$/;

  /* Tesseract's words -> items. y is the baseline under the letters (the bottoms of the symbols that sit on it — the
     line baseline Tesseract fits to a short row of figures can be a third of a line high), shared by the words of a
     row as printed; h is the font size from the cap or x height, the em src/pcs.js measures word gaps with. */
  function items(data, img, s) {
    const out = [], marks = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(par => (par.lines || []).forEach(ln => {
      const rh = (ln.rowAttributes && ln.rowAttributes.row_height) || (ln.bbox.y1 - ln.bbox.y0);
      const ws = ln.words.map(wd => {
        const ss = (wd.symbols || []).filter(sy => ON_BASE.test(sy.text));
        const base = ss.length ? median(ss.map(sy => sy.bbox.y1)) : wd.bbox.y1;
        const caps = ss.filter(sy => CAP.test(sy.text)), xs = ss.filter(sy => XH.test(sy.text));
        const top = caps.length ? median(caps.map(sy => sy.bbox.y0)) : xs.length ? median(xs.map(sy => sy.bbox.y0)) : wd.bbox.y0;
        const em = caps.length ? (base - top) / 0.72 : xs.length ? (base - top) / 0.53 : rh;
        return { wd, base, top, em: em > 4 ? em : rh };
      });
      const lineBase = median(ws.map(w => w.base)), lineEm = median(ws.map(w => w.em));
      ws.forEach((w, k) => {
        const { wd } = w, raw = String(wd.text || '').trim(), conf = wd.confidence;
        if (!raw) return;
        const base = Math.abs(w.base - lineBase) < 0.3 * lineEm ? lineBase : w.base;
        const mk = markup(img, wd.bbox, base, w.top);
        const alnum = (raw.match(/[A-Za-z0-9]/g) || []).length;
        if (mk.struck && alnum >= 2) { marks.push({ str: fixWord(raw), x: wd.bbox.x0 / s, y: base / s, w: (wd.bbox.x1 - wd.bbox.x0) / s, h: lineEm / s, conf: Math.round(conf), color: mk.color }); return; }
        // a word is kept unless it is likely noise: a lone letter Tesseract doubts, or marks with no letters (rules and
        // frames read as | _ ~). Prose keeps its unsure words ("7,500lb." at 20 %); figures read twice and pen markups stay.
        if (!wd.reread && !mk.color && conf < (alnum >= 2 ? 15 : 30)) return;
        if (!alnum && conf < (/^[-–—]$/.test(raw) ? 40 : 70)) return;
        let str = fixWord(raw);
        // "Frame;" before a value is "Frame:"
        const next = ws[k + 1] && String(ws[k + 1].wd.text || '');
        if (/[A-Za-z];$/.test(str) && next && /^(?:\d|TBD|N\/A|Per\b|Yes|No\b)/.test(next)) str = str.slice(0, -1) + ':';
        const it = { str, x: wd.bbox.x0 / s, y: base / s, w: (wd.bbox.x1 - wd.bbox.x0) / s, h: Math.min(40, Math.max(4, lineEm / s)), conf: Math.round(conf), ocr: true };
        if (mk.color) it.color = mk.color;
        out.push(it);
      });
    })));
    return { items: out, struck: marks };
  }

  // grey PNM bytes: Tesseract reads them in Node and in a Web Worker alike, with no image encoder needed
  function pgm(img, x0 = 0, y0 = 0, w = img.width, h = img.height, pad = 0) {
    const { width: W, data: D } = img, cw = w + 2 * pad, ch = h + 2 * pad, head = `P5\n${cw} ${ch}\n255\n`;
    const out = new Uint8Array(head.length + cw * ch).fill(255);
    for (let k = 0; k < head.length; k++) out[k] = head.charCodeAt(k);
    for (let y = 0; y < h; y++) for (let x = 0, i = ((y0 + y) * W + x0) * 4, o = head.length + (y + pad) * cw + pad; x < w; x++, i += 4) out[o + x] = (D[i] * 77 + D[i + 1] * 150 + D[i + 2] * 29) >> 8;
    return out;
  }

  /* Figures alone on a row (a dimension in a table cell) are where the page pass is least sure: no words around
     them to steady the reading — 25'-8" came back as "25-8"" at 1 %. Each such word is read again on its own, as one
     line of figures only, and the surer reading is kept. */
  const FIGURES = /^[\dTIl|OGSBZ'"\-_\/.@,:= ]+$/;   // with the letters a figure is misread as (2G'-8" for 26'-8")
  // a figure as a PCS writes one: 12'-0", 0'-2 1/2", 5", 2-3/4", 3@24'-0", (a list item ends in a comma), 15.0, 1:12
  const FT = String.raw`\d+'(?:-\d+(?:\.\d+)?(?: \d+\/\d+)?")?|\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?"`;
  const FIG_RE = new RegExp(String.raw`^(?:(?:\d+@)?(?:${FT})|\d+(?:[.,]\d+)*|\d+:\d+"?|\d+\/\d+\/\d+)[,.;]?$`);
  const isFigure = s => FIG_RE.test(s);
  async function rereadFigures(data, img, engine) {
    if (!engine.line) return 0;
    let n = 0;
    for (const b of data.blocks || []) for (const par of b.paragraphs || []) for (const ln of par.lines || []) for (const wd of ln.words) {
      const t = String(wd.text || '');
      // letters among the figures only when the word carries a foot, inch or @ mark: S1B-26002 is a name, not 2G'-8"
      const letters = (t.match(/[A-Za-z]/g) || []).length;
      if (wd.confidence >= 85 || !/\d/.test(t) || !FIGURES.test(t) || letters > 2 || (letters && !/['"@]/.test(t))) continue;
      const { x0, y0, x1, y1 } = wd.bbox, h = y1 - y0, m = Math.round(0.25 * h);
      const X0 = Math.max(0, x0 - m), Y0 = Math.max(0, y0 - m), X1 = Math.min(img.width - 1, x1 + m), Y1 = Math.min(img.height - 1, y1 + m);
      const r = await engine.line(pgm(img, X0, Y0, X1 - X0 + 1, Y1 - Y0 + 1, 12));
      const txt = String(r.text || '').trim();
      if (!txt || !/\d/.test(txt) || /\s{2,}|\n/.test(txt)) continue;
      // the reading that makes a well-formed figure wins (10-6" over 10-6'); between two that do, or two that don't,
      // the figures-only one when it is surer or the page pass put a letter among the figures ("1T@13'-6"," for
      // 1@13'-6", — Tesseract's confidence in a lone dimension says little either way)
      const okA = isFigure(fixWord(t)), okB = isFigure(fixWord(txt));
      if (okB && !okA || (okA === okB && (r.confidence > wd.confidence || /[^\d'"\-\/.@,: ]/.test(t)))) {
        wd.text = txt; wd.confidence = Math.max(r.confidence, Math.min(wd.confidence, 50)); wd.reread = true; n++;
      } else if (okA) { wd.reread = true; n++; }   // the page pass's own reading, confirmed well formed
    }
    return n;
  }

  /* Read one page: render at ~300 dpi, find and blank the checkboxes, recognise. Returns the items, the struck-out
     words, the boxes and a summary (word count, mean confidence, the words under 80%). */
  async function readPage(pdfPage, engine) {
    const vp1 = pdfPage.getViewport({ scale: 1 }), s = scaleFor(vp1.width, vp1.height);
    const vp = pdfPage.getViewport({ scale: s });
    const cv = engine.canvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pdfPage.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const boxes = findBoxes(img, s);
    const shown = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };   // the colours, before the boxes go
    if (boxes.length) { blank(img, boxes); ctx.putImageData(img, 0, 0); }
    const t0 = Date.now(), data = await engine.recognize(pgm(img));
    const reread = await rereadFigures(data, img, engine);
    const { items: its, struck } = items(data, shown, s);
    const confs = its.map(i => i.conf);
    return {
      items: its, struck, boxes: boxes.map(({ px, ...b }) => b),
      ocr: { words: its.length, conf: confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0, low: its.filter(i => i.conf < 80).length, reread, scale: s, ms: Date.now() - t0 },
    };
  }

  /* The browser engine. tesseract.js, its WebAssembly core (gzipped) and the English LSTM model travel inside the
     tool in inert blocks the build fills (ocr-lib, ocr-worker, ocr-core, ocr-wasm, ocr-eng), so a PCS is read with no
     network and nothing leaves the machine. Up to three page workers, plus one for figures read on their own. */
  const PAGE_PARAMS = { tessedit_pageseg_mode: '6', user_defined_dpi: '300' };   // one block: list numbers ("1.") kept
  const LINE_PARAMS = { tessedit_pageseg_mode: '7', tessedit_char_whitelist: `0123456789'"-/.@,:x `, user_defined_dpi: '300' };
  // runs inside each worker, ahead of tesseract.js: the core gets its WebAssembly from the gzipped copy
  function workerShim() {
    const core = self.TesseractCore, gz = self.__OCR_WASM;
    let bin = null;
    const wasm = async () => {
      if (bin) return bin;
      const bytes = Uint8Array.from(atob(gz), c => c.charCodeAt(0));
      const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return (bin = new Uint8Array(await new Response(out).arrayBuffer()));
    };
    self.TesseractCore = o => wasm().then(b => core(Object.assign({}, o, { wasmBinary: b })));
  }
  let web = null;
  function webEngine() {
    if (web) return web;
    web = (async () => {
      const txt = id => { const el = document.getElementById(id); return el ? el.textContent.trim() : ''; };
      if (!txt('ocr-eng') || !txt('ocr-wasm')) throw new Error('this copy of the tool was built without the OCR reader');
      if (typeof DecompressionStream === 'undefined' || typeof WebAssembly === 'undefined') throw new Error('this browser cannot run the OCR reader — open the tool in a current Chrome, Edge, Firefox or Safari');
      if (!root.Tesseract) { const sc = document.createElement('script'); sc.textContent = txt('ocr-lib'); document.head.appendChild(sc); }
      const src = `self.__OCR_WASM=${JSON.stringify(txt('ocr-wasm'))};\n${txt('ocr-core')}\n;(${workerShim.toString()})();\n${txt('ocr-worker')}`;
      const workerPath = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      const eng = Uint8Array.from(atob(txt('ocr-eng')), c => c.charCodeAt(0));
      const T = root.Tesseract, opts = { workerPath, workerBlobURL: false, cacheMethod: 'none', gzip: true };
      const make = async params => { const w = await T.createWorker([{ code: 'eng', data: eng }], 1, opts); await w.setParameters(params); return w; };
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      const ws = await Promise.all(Array.from({ length: n + 1 }, (_, i) => make(i < n ? PAGE_PARAMS : LINE_PARAMS)));
      const figures = ws.pop(), scheduler = T.createScheduler();
      ws.forEach(w => scheduler.addWorker(w));
      return {
        workers: n,
        canvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
        recognize: bytes => scheduler.addJob('recognize', bytes, {}, { blocks: true, text: false }).then(r => r.data),
        line: bytes => figures.recognize(bytes, {}, { text: true }).then(r => r.data),
        end: async () => { await scheduler.terminate(); await figures.terminate(); URL.revokeObjectURL(workerPath); web = null; },
      };
    })();
    web.catch(() => { web = null; });
    return web;
  }

  const api = { pageKind, scaleFor, findBoxes, markup, fixWord, items, pgm, readPage, webEngine, PAGE_PARAMS, LINE_PARAMS, DPI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_OCR = api;
})(typeof self !== 'undefined' ? self : this);
