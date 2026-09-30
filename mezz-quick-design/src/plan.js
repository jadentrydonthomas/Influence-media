/* Floor-plan reader. The eQuote floor plan (last PCS page) has no text layer: everything, text included,
   is stroked vectors. What can be read reliably is geometry:
     - grid bubbles  : circles r ≈ 6–14 pt (numbers along the top/bottom, letters along the sides)
     - ⊗ mezz columns: a small circle r ≈ 2.5–7 pt with two short diagonals crossing at its centre
   The bubbles register the drawing to the building grid; each ⊗ is then snapped to a grid intersection so
   the derived layout can be checked against the drawing. */
(function (root) {
  'use strict';

  // Walk a pdf.js operator list and return every subpath in page coordinates (top-origin y).
  function subpaths(opList, OPS, pageHeight) {
    const out = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let inAnnot = 0;
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const P = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], pageHeight - (ctm[1] * x + ctm[3] * y + ctm[5])];
    const { fnArray, argsArray } = opList;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], args = argsArray[i];
      if (fn === OPS.beginAnnotation) { inAnnot++; continue; }
      if (fn === OPS.endAnnotation) { inAnnot--; continue; }
      if (inAnnot) continue;
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin && args && args[0]) { stack.push(ctm); ctm = mul(ctm, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.constructPath) {
        const [ops, coords] = args;
        let k = 0, cur = null;
        for (const op of ops) {
          if (op === OPS.moveTo) { if (cur && cur.length) out.push(cur); cur = [P(coords[k], coords[k + 1])]; k += 2; }
          else if (op === OPS.lineTo) { (cur = cur || []).push(P(coords[k], coords[k + 1])); k += 2; }
          else if (op === OPS.curveTo) { (cur = cur || []).push(P(coords[k + 4], coords[k + 5])); k += 6; }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { (cur = cur || []).push(P(coords[k + 2], coords[k + 3])); k += 4; }
          else if (op === OPS.closePath) { if (cur && cur.length) cur.closed = true; }
          else if (op === OPS.rectangle) {
            if (cur && cur.length) out.push(cur);
            const [x, y, w, h] = coords.slice(k, k + 4); k += 4;
            cur = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)]; cur.closed = true; out.push(cur); cur = null;
          }
        }
        if (cur && cur.length) out.push(cur);
      }
    }
    return out;
  }

  function circleOf(pts) {
    if (pts.length < 10) return null;
    let cx = 0, cy = 0;
    pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
    const d = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy));
    const r = d.reduce((a, b) => a + b, 0) / d.length;
    if (r < 1.5 || r > 30) return null;
    const dev = Math.max(...d.map(x => Math.abs(x - r)));
    const closedish = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < r * 0.6;
    return dev / r < 0.15 && closedish ? { x: cx, y: cy, r } : null;
  }

  function readSymbols(paths) {
    const circles = [], segs = [];
    paths.forEach(p => {
      if (p.length === 2) {
        const [a, b] = p, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > 0.5 && len < 25) segs.push({ a, b, len, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, slope: (b[1] - a[1]) / ((b[0] - a[0]) || 1e-9) });
        return;
      }
      const c = circleOf(p);
      if (c) circles.push(c);
    });
    // merge concentric duplicates (filled rings are drawn as an outer + inner polyline)
    const uniq = [];
    circles.sort((a, b) => b.r - a.r).forEach(c => { if (!uniq.some(u => Math.hypot(u.x - c.x, u.y - c.y) < Math.max(0.8, c.r * 0.3) && Math.abs(u.r - c.r) < u.r * 0.25)) uniq.push(c); });
    const crosses = [], plain = [];
    uniq.forEach(c => {
      const diag = segs.filter(s => Math.hypot(s.mx - c.x, s.my - c.y) < c.r * 0.35 && s.len > c.r * 1.1 && s.len < c.r * 2.4 && Math.abs(Math.abs(s.slope) - 1) < 0.6);
      const hasX = diag.some(s => s.slope > 0) && diag.some(s => s.slope < 0);
      (hasX && c.r <= 8 ? crosses : plain).push(c);
    });
    return { crosses, circles: plain };
  }

  // Group bubble circles: the most common radius among the larger plain circles
  function bubbles(circles) {
    const big = circles.filter(c => c.r >= 5 && c.r <= 16);
    if (!big.length) return [];
    const bins = {};
    big.forEach(c => { const k = Math.round(c.r * 2) / 2; (bins[k] = bins[k] || []).push(c); });
    const best = Object.values(bins).sort((a, b) => b.length - a.length)[0];
    const r = best[0].r;
    return big.filter(c => Math.abs(c.r - r) < r * 0.12);
  }

  // Cluster 1-D values (bubble rows / columns)
  function cluster(vals, tol) {
    const s = vals.slice().sort((a, b) => a - b), out = [];
    s.forEach(v => { const c = out[out.length - 1]; if (c && v - c[c.length - 1] <= tol) c.push(v); else out.push([v]); });
    return out.map(c => c.reduce((a, b) => a + b, 0) / c.length);
  }
  function fit(pdfVals, bldgVals) { // least squares bldg = a*pdf + b
    const n = pdfVals.length, mx = pdfVals.reduce((a, b) => a + b, 0) / n, my = bldgVals.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    pdfVals.forEach((x, i) => { sxy += (x - mx) * (bldgVals[i] - my); sxx += (x - mx) ** 2; });
    const a = sxy / sxx, b = my - a * mx;
    const res = Math.max(...pdfVals.map((x, i) => Math.abs(a * x + b - bldgVals[i])));
    return { a, b, res };
  }

  /* grid: { xs:[frame line x, ft], colY:[column line y from FSW, ft] }
     returns { ok, reason, columns:[{x,y}] in building ft, raw } */
  function registerAndRead(paths, grid) {
    const { crosses, circles } = readSymbols(paths);
    const bub = bubbles(circles);
    const out = { ok: false, crosses: crosses.length, bubbles: bub.length, columns: [] };
    if (!crosses.length) { out.reason = 'no ⊗ symbols found'; return out; }
    if (bub.length < 4) { out.reason = 'grid bubbles not found'; return out; }
    const r = bub[0].r;
    // rows of bubbles (numbers) share y; columns of bubbles (letters) share x
    const ys = cluster(bub.map(b => b.y), r), xs = cluster(bub.map(b => b.x), r);
    const rowY = ys.map(y => ({ y, n: bub.filter(b => Math.abs(b.y - y) <= r).length })).sort((a, b) => b.n - a.n);
    const colX = xs.map(x => ({ x, n: bub.filter(b => Math.abs(b.x - x) <= r).length })).sort((a, b) => b.n - a.n);
    const topRow = rowY.filter(q => q.n === rowY[0].n).sort((a, b) => a.y - b.y)[0];
    const leftCol = colX.filter(q => q.n === colX[0].n).sort((a, b) => a.x - b.x)[0];
    const numX = bub.filter(b => Math.abs(b.y - topRow.y) <= r).map(b => b.x).sort((a, b) => a - b);
    const letY = bub.filter(b => Math.abs(b.x - leftCol.x) <= r).map(b => b.y).sort((a, b) => a - b); // top (BSW) first
    const gx = grid.xs.slice().sort((a, b) => a - b), gy = grid.colY.slice().sort((a, b) => b - a);   // BSW first
    if (numX.length !== gx.length || letY.length !== gy.length) {
      out.reason = `bubble count ${numX.length}×${letY.length} does not match the grid ${gx.length}×${gy.length}`;
      return out;
    }
    const fx = fit(numX, gx), fy = fit(letY, gy);
    const spanX = gx[gx.length - 1] - gx[0] || 1, spanY = Math.abs(gy[0] - gy[gy.length - 1]) || 1;
    if (fx.res > spanX * 0.02 + 0.5 || fy.res > spanY * 0.02 + 0.5) { out.reason = 'bubble spacing does not match the bay / endwall spacing'; return out; }
    out.columns = crosses.map(c => ({ x: fx.a * c.x + fx.b, y: fy.a * c.y + fy.b }));
    out.ok = true;
    out.map = { fx, fy };
    return out;
  }

  // Compare detected ⊗ with the derived layout's mezzanine columns (tolerance in ft)
  function compare(detected, mezzCols, tol = 1.5) {
    const used = new Set();
    const matched = [], extra = [];
    detected.forEach(d => {
      const i = mezzCols.findIndex((c, k) => !used.has(k) && Math.hypot(c.x - d.x, c.y - d.y) <= tol);
      if (i >= 0) { used.add(i); matched.push(mezzCols[i].label); } else extra.push(d);
    });
    const missing = mezzCols.filter((c, k) => !used.has(k)).map(c => c.label);
    return { matched, extra, missing, agree: !extra.length && !missing.length };
  }

  const api = { subpaths, readSymbols, registerAndRead, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_PLAN = api;
})(typeof self !== 'undefined' ? self : this);
