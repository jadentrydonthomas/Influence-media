/* pdf.js page extraction shared by the browser tool and the Node tests.
   Produces the page shape src/pcs.js expects: top-origin text items + annotations. */
(function (root) {
  'use strict';

  async function extractPage(page) {
    const vp = page.getViewport({ scale: 1 });
    const H = vp.height;
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str != null && i.str.trim()).map(i => {
      const [a, b, , d, e, f] = i.transform;
      const h = Math.hypot(b, d) || i.height || 8;
      return { str: i.str, x: e, y: H - f, w: i.width || Math.abs(a) * i.str.length * 0.5, h };
    });
    let annots = [];
    try {
      annots = (await page.getAnnotations()).map(a => {
        const text = (a.contentsObj && a.contentsObj.str) || a.contents || (Array.isArray(a.textContent) ? a.textContent.join(' ') : '') || '';
        const [x1, y1, x2, y2] = a.rect || [0, 0, 0, 0];
        const o = { subtype: a.subtype, text, x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: H - Math.max(y1, y2), y2: H - Math.min(y1, y2) };
        // markup drawn over the floor plan: its colour and, for a line, its two ends (top-origin like the rest)
        if (a.color && a.color.length >= 3) o.color = [a.color[0], a.color[1], a.color[2]];
        if (a.lineCoordinates && a.lineCoordinates.length === 4) { const L = a.lineCoordinates; o.line = [[L[0], H - L[1]], [L[2], H - L[3]]]; }
        return o;
      });
    } catch (e) { annots = []; }
    return { width: vp.width, height: H, items, annots };
  }

  async function extractDoc(pdf) {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push({ num: n, ...(await extractPage(page)), _page: page });
    }
    return pages;
  }

  /* Checkbox states on a rendered page: the eQuote draws checkboxes as vector glyphs just left of each
     label. Render the page, then compare the ink inside the box with the ink of an unchecked box. */
  async function detectChecks(page, targets, pdfPage, scale = 3) {
    if (!targets.length || typeof document === 'undefined') return {};
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

  const api = { extractPage, extractDoc, detectChecks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_EXTRACT = api;
})(typeof self !== 'undefined' ? self : this);
