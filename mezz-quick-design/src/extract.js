/* pdf.js page extraction shared by the browser tool and the Node tests.
   Produces the page shape src/pcs.js expects: top-origin text items + annotations, placed through the page's
   viewport transform (vt) so a rotated sheet (a floor plan set landscape with /Rotate 90) reads as printed. */
(function (root) {
  'use strict';

  async function extractPage(page) {
    const vp = page.getViewport({ scale: 1 });
    const H = vp.height, T = vp.transform;
    const P = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str != null && i.str.trim()).map(i => {
      const [a, b, , d, e, f] = i.transform;
      const h = Math.hypot(b, d) || i.height || 8, [x, y] = P(e, f);
      return { str: i.str, x, y, w: i.width || Math.abs(a) * i.str.length * 0.5, h };
    });
    let annots = [];
    try {
      annots = (await page.getAnnotations()).map(a => {
        const text = (a.contentsObj && a.contentsObj.str) || a.contents || (Array.isArray(a.textContent) ? a.textContent.join(' ') : '') || '';
        const [x1, y1, x2, y2] = a.rect || [0, 0, 0, 0], c = [P(x1, y1), P(x2, y2)];
        const o = { subtype: a.subtype, text, x1: Math.min(c[0][0], c[1][0]), x2: Math.max(c[0][0], c[1][0]), y1: Math.min(c[0][1], c[1][1]), y2: Math.max(c[0][1], c[1][1]) };
        // markup drawn over the floor plan: its colour and, for a line, its two ends (top-origin like the rest)
        if (a.color && a.color.length >= 3) o.color = [a.color[0], a.color[1], a.color[2]];
        if (a.lineCoordinates && a.lineCoordinates.length === 4) { const L = a.lineCoordinates; o.line = [P(L[0], L[1]), P(L[2], L[3])]; }
        return o;
      });
    } catch (e) { annots = []; }
    return { width: vp.width, height: H, vt: Array.from(T), items, annots };
  }

  /* Every page, text layer first. With an OCR engine (src/ocr.js), a page with no text layer whose words are drawn
     as outlines, or a scan, is then read from its picture: its items are the recognised words (each with .conf),
     page.ocr says how it went, page.boxes holds its checkboxes and page.struck the words struck out on it.
     opts: { ocr: engine or () => Promise<engine> (started only when a page needs it), OPS: pdfjsLib.OPS,
             onPage(n, total), onOcr(done, total, pageNum) — done 0 when the reader starts } */
  async function extractDoc(pdf, opts = {}) {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push({ num: n, ...(await extractPage(page)), _page: page });
      if (opts.onPage) opts.onPage(n, pdf.numPages);
    }
    pages.ocr = await ocrPages(pages, opts);
    return pages;
  }

  // the pages that need reading from their picture, then each read (in parallel up to the engine's workers)
  async function ocrPages(pages, opts) {
    const OCR = typeof module !== 'undefined' && module.exports ? require('./ocr.js') : root.MZ_OCR;
    const todo = [];
    for (const p of pages) {
      const chars = p.items.reduce((a, i) => a + String(i.str).replace(/\s/g, '').length, 0);
      p.kind = chars >= 200 || !opts.OPS || !p._page ? 'text' : OCR.pageKind(chars, await p._page.getOperatorList(), opts.OPS);
      if (p.kind === 'outlined' || p.kind === 'scan') todo.push(p);
    }
    if (!todo.length || !opts.ocr) return { pages: todo.map(p => p.num), read: false };
    if (opts.onOcr) opts.onOcr(0, todo.length, todo[0].num);
    let engine;
    try { engine = typeof opts.ocr === 'function' ? await opts.ocr() : opts.ocr; } catch (e) { return { pages: todo.map(p => p.num), read: false, error: e.message || String(e) }; }
    let done = 0;
    const one = async p => {
      const r = await OCR.readPage(p._page, engine);
      p.nativeItems = p.items.length;
      p.items = p.items.concat(r.items);
      p.struck = r.struck; p.boxes = r.boxes; p.ocr = r.ocr;
      if (opts.onOcr) opts.onOcr(++done, todo.length, p.num);
    };
    const queue = todo.slice(), n = Math.max(1, engine.workers || 1);
    await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
    const confs = todo.map(p => p.ocr.conf);
    return { pages: todo.map(p => p.num), read: true, conf: Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) };
  }

  /* Checkbox states on a rendered page: the eQuote draws checkboxes as vector glyphs just left of each
     label. Render the page, then compare the ink inside the box with the ink of an unchecked box. */
  async function detectChecks(page, targets, pdfPage, scale = 3) {
    if (!targets.length) return {};
    // a page read by OCR already found its boxes: the one just left of each label, on its line
    if (page.boxes) {
      const out = {};
      targets.forEach(t => {
        const b = page.boxes.filter(b => b.x2 <= t.x + 1 && t.x - b.x2 < 3 * t.h && Math.abs((b.y1 + b.y2) / 2 - (t.y - 0.35 * t.h)) < t.h)
          .sort((a, b) => b.x2 - a.x2)[0];
        out[t.key || t.label] = b ? b.checked : null;
      });
      return { states: out, raw: [] };
    }
    if (typeof document === 'undefined') return {};
    const vp = pdfPage.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pdfPage.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
    const out = {};
    const dark = [];
    targets.forEach(t => {
      // box sits ~8-16 pt left of the label, vertically centred on the text
      const bx = (t.x - 15) * scale, by = (t.y - t.h * 0.95) * scale, bw = 11 * scale, bh = t.h * 1.1 * scale;
      const img = ctx.getImageData(Math.max(0, bx | 0), Math.max(0, by | 0), Math.max(1, bw | 0), Math.max(1, bh | 0)).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i] + img[i + 1] + img[i + 2] < 300) n++;
      dark.push({ label: t.key || t.label, n });
    });
    // an empty box has only its outline; a checked one carries the tick as well
    const counts = dark.map(d => d.n).sort((a, b) => a - b);
    const base = counts[0] || 0;
    dark.forEach(d => { out[d.label] = d.n > base * 1.35 + 6; });
    return { states: out, raw: dark };
  }

  const api = { extractPage, extractDoc, ocrPages, detectChecks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_EXTRACT = api;
})(typeof self !== 'undefined' ? self : this);
