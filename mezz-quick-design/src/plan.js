/* Floor-plan reader. The eQuote floor plan (a drawing page near the end of the PCS) has no text layer: everything, text included,
   is stroked vectors. What can be read reliably is geometry:
     - grid bubbles  : circles r ≈ 6–14 pt (numbers along the top/bottom, letters along the sides)
     - mezz columns  : a small circle r ≈ 2.5–7 pt with two diagonals (⊗), one diagonal (⊘) or an I-shape (web +
                       flange strokes) at its centre — all three conventions appear on eQuote drawings
     - frame columns : a bare I (web stroke with a flange stroke across each end, no circle) — sidewall, endwall
                       and interior frame columns; and ✱ (four strokes through one point: horizontal, vertical,
                       two diagonals), the interior frame columns "designated as Most Economical" in Box 5
     - joist arrows  : "Mez. Jst." / "JOIST" — a straight shaft with a half arrowhead (~15–30°) at each end
     - joist symbols : a short truss drawn along the joists — a chord line with a zigzag of webs beside it
     - markup        : what the quote engineer marks up over the plan as PDF annotations — an "X" text box on each
                       mezzanine column, a line labelled "JOISTS" (and lines of its colour) across the joist span
   Circles are drawn either as one polyline or as dozens of 2-point segments; segments are chained first.
   A drawing sheet is often a rotated page (/Rotate 90 or 270, set landscape): paths are taken through the page's
   viewport transform, so the plan reads the way it is printed.
   The bubbles register the drawing to the building grid (same scale on both axes, so extra bubbles — a
   lean-to, an offset letter — cannot throw the fit), every side bubble is lettered from the BSW down
   skipping I and O like the drafting, and each symbol is snapped to building coordinates. */
(function (root) {
  'use strict';

  /* Walk a pdf.js operator list and return every subpath in top-origin page coordinates, as the page is shown.
     view: the page's viewport transform (page.getViewport({ scale: 1 }).transform; a rotated page turns with it),
     or just the page height for an unrotated page. */
  function subpaths(opList, OPS, view) {
    const out = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let inAnnot = 0;
    const V = view && typeof view === 'object' && view.length === 6 ? view : [1, 0, 0, -1, 0, view];
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const P = (x, y) => { const u = ctm[0] * x + ctm[2] * y + ctm[4], w = ctm[1] * x + ctm[3] * y + ctm[5]; return [V[0] * u + V[2] * w + V[4], V[1] * u + V[3] * w + V[5]]; };
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
    // centre: the vertex average, or the bounding-box centre when the vertices are bunched on one side
    // (a hand-traced or unevenly stroked circle) — whichever makes it rounder
    let ax = 0, ay = 0;
    pts.forEach(p => { ax += p[0]; ay += p[1]; }); ax /= pts.length; ay /= pts.length;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const fitAt = (cx, cy) => { const d = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy)), r = d.reduce((a, b) => a + b, 0) / d.length; return { x: cx, y: cy, r, dev: Math.max(...d.map(x => Math.abs(x - r))) / r }; };
    const c = [fitAt(ax, ay), fitAt((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)].sort((p, q) => p.dev - q.dev)[0];
    if (c.r < 1.5 || c.r > 30) return null;
    const closedish = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < c.r * 0.6;
    return c.dev < 0.15 && closedish ? { x: c.x, y: c.y, r: c.r } : null;
  }

  // Join consecutive short 2-point segments that continue one another (circles stroked as segments)
  function chains(paths) {
    const out = [];
    let cur = null;
    const close = (p, q) => Math.abs(p[0] - q[0]) < 0.2 && Math.abs(p[1] - q[1]) < 0.2;
    paths.forEach(p => {
      if (p.length === 2 && Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) < 6) {
        if (cur && close(cur[cur.length - 1], p[0])) { cur.push(p[1]); return; }
        if (cur && cur.length >= 10) out.push(cur);
        cur = [p[0], p[1]];
        return;
      }
      if (cur && cur.length >= 10) out.push(cur);
      cur = null;
    });
    if (cur && cur.length >= 10) out.push(cur);
    return out;
  }

  /* A bucket grid over points: near(x, y, r) gives every item whose point lies within r (and a few more — the callers
     keep their exact distance tests), so a symbol looks only at the strokes around it, not the whole sheet's. */
  function bucket(items, X, Y, cell = 6) {
    const m = new Map(), K = (i, j) => (i + 1048576) * 2097152 + (j + 1048576);
    const add = it => { const k = K(Math.floor(X(it) / cell), Math.floor(Y(it) / cell)); const a = m.get(k); if (a) a.push(it); else m.set(k, [it]); };
    items.forEach(add);
    return {
      add,
      near(x, y, r) { return this.rect(x - r, y - r, x + r, y + r); },
      rect(x0, y0, x1, y1) {
        const out = [], i0 = Math.floor(x0 / cell), i1 = Math.floor(x1 / cell), j0 = Math.floor(y0 / cell), j1 = Math.floor(y1 / cell);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = m.get(K(i, j)); if (a) for (const it of a) out.push(it); }
        return out;
      },
    };
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
    chains(paths).forEach(p => { const c = circleOf(p); if (c) circles.push(c); });
    // merge concentric duplicates (filled rings are drawn as an outer + inner polyline)
    const uniq = [], uIdx = bucket([], u => u.x, u => u.y, 8);
    circles.sort((a, b) => b.r - a.r).forEach(c => { if (!uIdx.near(c.x, c.y, Math.max(0.8, c.r * 0.3)).some(u => Math.hypot(u.x - c.x, u.y - c.y) < Math.max(0.8, c.r * 0.3) && Math.abs(u.r - c.r) < u.r * 0.25)) { uniq.push(c); uIdx.add(c); } });
    const crosses = [], plain = [];
    const axial = s => (Math.abs(s.b[0] - s.a[0]) < 0.12 * s.len ? 'v' : Math.abs(s.b[1] - s.a[1]) < 0.12 * s.len ? 'h' : null);
    const sIdx = bucket(segs, sg => sg.mx, sg => sg.my);
    uniq.forEach(c => {
      if (c.r > 8) { plain.push(c); return; }
      const diag = sIdx.near(c.x, c.y, c.r * 0.35).filter(s => Math.hypot(s.mx - c.x, s.my - c.y) < c.r * 0.35 && s.len > c.r * 1.1 && s.len < c.r * 2.4 && Math.abs(Math.abs(s.slope) - 1) < 0.6);
      const hasX = diag.some(s => s.slope > 0) && diag.some(s => s.slope < 0), hasSlash = !hasX && diag.length > 0;
      // circled I: a web stroke through the centre (either orientation) with a flange stroke across one end
      const webs = sIdx.near(c.x, c.y, c.r * 0.3).filter(s => axial(s) && Math.hypot(s.mx - c.x, s.my - c.y) < c.r * 0.3 && s.len > c.r * 0.6 && s.len < c.r * 1.6);
      const hasI = webs.some(w => [...sIdx.near(w.a[0], w.a[1], c.r * 0.3), ...sIdx.near(w.b[0], w.b[1], c.r * 0.3)].some(f => f !== w && axial(f) && axial(f) !== axial(w) && f.len > c.r * 0.35 && f.len < c.r * 1.3
        && Math.min(Math.hypot(f.mx - w.a[0], f.my - w.a[1]), Math.hypot(f.mx - w.b[0], f.my - w.b[1])) < c.r * 0.3));
      if (hasX) crosses.push({ ...c, kind: 'x' });
      else if (hasI) crosses.push({ ...c, kind: 'i' });
      else if (hasSlash) crosses.push({ ...c, kind: 's' });
      else plain.push(c);
    });
    const cIdx = bucket(uniq.filter(c => c.r <= 8), c => c.x, c => c.y, 8);
    const inCircle = p => cIdx.near(p.x, p.y, 8.4).some(c => c.r <= 8 && Math.hypot(c.x - p.x, c.y - p.y) < c.r * 1.05);
    // frame columns, bare I: a web with a flange stroke across each end (either orientation), not inside a circle
    const frameCols = [], fIdx = bucket([], q => q.x, q => q.y, 4);
    const nearCol = c => fIdx.near(c.x, c.y, 1).some(q => Math.hypot(q.x - c.x, q.y - c.y) < 1);
    const ax = segs.filter(sg => axial(sg) && sg.len >= 0.8 && sg.len <= 12), axIdx = bucket(ax, sg => sg.mx, sg => sg.my);
    ax.forEach(w => {
      if (w.len < 2.5 || w.len > 10) return;
      const o = axial(w), tol = Math.max(0.35, w.len * 0.12);
      const flange = end => axIdx.near(end[0], end[1], tol).some(f => f !== w && axial(f) !== o && f.len >= w.len * 0.25 && f.len <= w.len * 1.4 && Math.hypot(f.mx - end[0], f.my - end[1]) < tol);
      const c = { x: w.mx, y: w.my };
      if (!flange(w.a) || !flange(w.b) || inCircle(c) || nearCol(c)) return;
      const q = { ...c, kind: 'I' };
      frameCols.push(q); fIdx.add(q);
    });
    // ✱: three or more strokes crossing at their common midpoint in three or more directions, one diagonal
    const ang = sg => Math.round(((Math.atan2(sg.b[1] - sg.a[1], sg.b[0] - sg.a[0]) * 180 / Math.PI) % 180 + 180) % 180 / 15) % 12;
    const mid = segs.filter(sg => sg.len >= 2.5 && sg.len <= 10), midIdx = bucket(mid, sg => sg.mx, sg => sg.my);
    mid.forEach(sg => {
      const c = { x: sg.mx, y: sg.my };
      if (nearCol(c)) return;
      const r = Math.max(0.35, sg.len * 0.1), thru = midIdx.near(c.x, c.y, r).filter(t => Math.hypot(t.mx - c.x, t.my - c.y) < r);
      if (thru.length >= 3 && new Set(thru.map(ang)).size >= 3 && thru.some(t => !axial(t)) && !inCircle(c)) { const q = { ...c, kind: 'star' }; frameCols.push(q); fIdx.add(q); }
    });
    const longSegs = paths.filter(p => p.length === 2).map(p => ({ a: p[0], b: p[1], len: Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) })).filter(sg => sg.len >= 25);
    return { crosses, frameCols, circles: plain, arrows: readArrows(segs.concat(longSegs)).concat(readJoistSymbols(paths)) };
  }

  /* "Mez. Jst." / "JOIST" joist-span arrows: an axis-aligned shaft with a short stroke leaving each end at ~15–30° to
     it (a half arrowhead; the two heads sit on opposite sides). Hatching and dimension ticks are at 45°, so the
     10–40° window plus a head at both ends keeps them out. */
  function readArrows(segs) {
    const out = [];
    const long = segs.filter(s => s.len >= 25 && s.len <= 400 && (Math.abs(s.b[0] - s.a[0]) < 0.02 * s.len || Math.abs(s.b[1] - s.a[1]) < 0.02 * s.len));
    const short = segs.filter(s => s.len >= 3 && s.len <= 14);
    const at = (p, q) => Math.abs(p[0] - q[0]) < 0.4 && Math.abs(p[1] - q[1]) < 0.4;
    // the short strokes by each end, so a shaft's ends look only at the strokes that start or finish there
    const ends = bucket(short.flatMap(h => [{ h, p: h.a }, { h, p: h.b }]), e => e.p[0], e => e.p[1], 4);
    long.forEach(sh => {
      const vert = Math.abs(sh.b[0] - sh.a[0]) < Math.abs(sh.b[1] - sh.a[1]);
      const head = end => [...new Set(ends.near(end[0], end[1], 0.6).map(e => e.h))].some(h => {
        const o = at(h.a, end) ? h.b : at(h.b, end) ? h.a : null;
        if (!o) return false;
        const along = Math.abs(vert ? o[1] - end[1] : o[0] - end[0]), across = Math.abs(vert ? o[0] - end[0] : o[1] - end[1]);
        const ang = Math.atan2(across, along) * 180 / Math.PI;
        return ang > 10 && ang < 40;
      });
      if (head(sh.a) && head(sh.b)) out.push({ x: (sh.a[0] + sh.b[0]) / 2, y: (sh.a[1] + sh.b[1]) / 2, len: sh.len, vert, a: sh.a, b: sh.b });
    });
    // the same shaft may be stroked twice
    return out.filter((a, i) => !out.slice(0, i).some(b => Math.hypot(a.x - b.x, a.y - b.y) < 1 && a.vert === b.vert));
  }

  /* Joist symbol (a joist in elevation, drawn along the joists): an axis-aligned chord with a zigzag of short webs
     alternating left / right beside it — at least four webs. The chord's direction is the joist direction.
     Zigzags may be one polyline or separate strokes. */
  function readJoistSymbols(paths) {
    const seg = [];
    paths.forEach(p => { if (p.length >= 2 && p.length <= 60 && !p.closed) for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len > 0.3) seg.push({ a, b, len, i: seg.length }); } });
    // the web candidates by their first end: a web has both ends in the band beside the chord, so the band is looked up
    const wIdx = bucket(seg.filter(q => q.len >= 1.5 && q.len <= 12), q => q.a[0], q => q.a[1], 8);
    const out = [];
    seg.filter(c => c.len >= 18 && c.len <= 320).forEach(c => {
      const horiz = Math.abs(c.b[1] - c.a[1]) < 0.02 * c.len, vert = Math.abs(c.b[0] - c.a[0]) < 0.02 * c.len;
      if (!horiz && !vert) return;
      const u = p => (horiz ? p[0] : p[1]), w = p => (horiz ? p[1] : p[0]);   // along / across the chord
      const lo = Math.min(u(c.a), u(c.b)), hi = Math.max(u(c.a), u(c.b)), off = w(c.a);
      const band = (horiz ? wIdx.rect(lo - 1, off - 9.5, hi + 1, off + 9.5) : wIdx.rect(off - 9.5, lo - 1, off + 9.5, hi + 1)).sort((p, q) => p.i - q.i);
      for (const sideSign of [1, -1]) {
        const webs = band.filter(q => {
          if (q === c || q.len < 1.5 || q.len > 12) return false;
          const da = (w(q.a) - off) * sideSign, db = (w(q.b) - off) * sideSign, along = Math.abs(u(q.b) - u(q.a)), across = Math.abs(w(q.b) - w(q.a));
          return Math.min(da, db) > -0.4 && Math.max(da, db) < 9 && across > 1 && along > 0.4 && along < 3 * across && u(q.a) > lo - 1 && u(q.a) < hi + 1 && u(q.b) > lo - 1 && u(q.b) < hi + 1;
        }).sort((p, q) => (u(p.a) + u(p.b)) - (u(q.a) + u(q.b)));
        // one connected zigzag, slopes alternating / \ / \, webs of about one length
        const touch = (p, q) => [p.a, p.b].some(e => [q.a, q.b].some(f => Math.hypot(e[0] - f[0], e[1] - f[1]) < 0.4));
        const sl = q => Math.sign((u(q.b) - u(q.a)) * (w(q.b) - w(q.a)));
        let best = 0, run = 0;
        webs.forEach((q, i) => {
          const p = webs[i - 1];
          run = p && touch(p, q) && sl(p) && sl(q) && sl(p) !== sl(q) && Math.abs(q.len - p.len) < 0.4 * Math.max(q.len, p.len) ? run + 1 : 1;
          best = Math.max(best, run);
        });
        if (best >= 4) { out.push({ x: (c.a[0] + c.b[0]) / 2, y: (c.a[1] + c.b[1]) / 2, len: c.len, vert, kind: 'truss' }); break; }
      }
    });
    return out.filter((a, i) => !out.slice(0, i).some(b => Math.hypot(a.x - b.x, a.y - b.y) < 12 && a.vert === b.vert));
  }

  /* Markup annotations over the plan (top-origin page coords, from extract.js): mezzanine columns are "X" text boxes
     (or ×, ⊗); joist direction is a long straight line with a "JOIST" note beside it, and every line of that colour
     and direction (the same markup repeated). Lines of another colour (the beam lines) are only kept as beams. */
  function readMarkup(annots) {
    const out = { crosses: [], arrows: [], beams: [] };
    if (!annots || !annots.length) return out;
    const ctr = a => ({ x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 });
    annots.filter(a => /FreeText|Text|Square|Circle/i.test(a.subtype) && /^\s*[Xx×✕✖⊗]\s*$/.test(a.text || '')).forEach(a => out.crosses.push({ ...ctr(a), kind: 'x', markup: true }));
    const lines = annots.filter(a => a.line).map(a => {
      const [p, q] = a.line, len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return { a: p, b: q, len, vert: Math.abs(q[0] - p[0]) < Math.abs(q[1] - p[1]), color: (a.color || []).join(','), x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 };
    }).filter(l => l.len >= 25 && (l.vert ? Math.abs(l.b[0] - l.a[0]) : Math.abs(l.b[1] - l.a[1])) < 0.05 * l.len);
    const notes = annots.filter(a => /FreeText|Text/i.test(a.subtype) && a.text);
    const near = (l, n) => { const c = ctr(n), along = l.vert ? c.y : c.x, lo = Math.min(l.vert ? l.a[1] : l.a[0], l.vert ? l.b[1] : l.b[0]), hi = Math.max(l.vert ? l.a[1] : l.a[0], l.vert ? l.b[1] : l.b[0]);
      return along > lo - 10 && along < hi + 10 && Math.abs(l.vert ? c.x - l.x : c.y - l.y) < 30; };
    const joist = lines.filter(l => notes.some(n => /JOIST/i.test(n.text) && near(l, n)));
    const keys = new Set(joist.map(l => l.color + '|' + l.vert));
    lines.forEach(l => {
      if (keys.has(l.color + '|' + l.vert)) out.arrows.push({ x: l.x, y: l.y, len: l.len, vert: l.vert, a: l.a, b: l.b, kind: 'markup' });
      else out.beams.push({ a: l.a, b: l.b, vert: l.vert });
    });
    return out;
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

  // drafting letters: A, B, … skipping I and O, then AA, AB, …
  function gridLetters(n) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''), out = [];
    for (let i = 0; i < n; i++) out.push(i < abc.length ? abc[i] : abc[Math.floor(i / abc.length) - 1] + abc[i % abc.length]);
    return out;
  }

  /* grid: { xs:[frame line x, ft], colY:[column line y from FSW, ft], lewY?, rewY?, width?, letterLines? (column lines + ridge) }
     returns { ok, reason, columns:[{x,y,kind}] (mezzanine ⊗ 'x' / circled-I 'i'), frameCols:[{x,y,kind}] (bare I 'I' /
     ✱ 'star'), arrows:[{x,y,dir,len}], letters:[{y,letter}], map } in building ft */
  function registerAndRead(paths, grid, annots) {
    const sym = readSymbols(paths), mk = readMarkup(annots);
    // marked-up columns win over drawn ⊗ at the same spot (the markup is the quote engineer's)
    const crosses = mk.crosses.concat(sym.crosses.filter(c => !mk.crosses.some(m => Math.hypot(m.x - c.x, m.y - c.y) < 6)));
    const { frameCols, circles } = sym, arrows = sym.arrows.concat(mk.arrows);
    const bub = bubbles(circles);
    const out = { ok: false, crosses: crosses.length, bubbles: bub.length, columns: [], arrows: [], letters: [] };
    if (bub.length < 4) { out.reason = 'grid bubbles not found'; return out; }
    const r = bub[0].r;
    // rows of bubbles (numbers) share y; columns of bubbles (letters) share x
    const ys = cluster(bub.map(b => b.y), r), xs = cluster(bub.map(b => b.x), r);
    const rowY = ys.map(y => ({ y, n: bub.filter(b => Math.abs(b.y - y) <= r).length })).sort((a, b) => b.n - a.n);
    const colX = xs.map(x => ({ x, n: bub.filter(b => Math.abs(b.x - x) <= r).length })).sort((a, b) => b.n - a.n);
    const gx = grid.xs.slice().sort((a, b) => a - b);
    const spanX = gx[gx.length - 1] - gx[0] || 1, tolX = spanX * 0.02 + 0.5;
    // frame-line bubbles: a row whose spacing matches the bays. A row can carry an extra bubble (a lean-to's end line
    // 1'-4" off the endwall, drawn overlapping), so the first / last frame line may sit on the first or second bubble
    // from either end; every frame line must find a bubble, extra bubbles are left over
    let fx = null, bestRes = Infinity, rowN = 0, numberOffset = 0;
    rowY.filter(q => q.n >= Math.max(3, gx.length - 2)).forEach(q => {
      const row = bub.filter(b => Math.abs(b.y - q.y) <= r).map(b => b.x).sort((a, b) => a - b);
      rowN = Math.max(rowN, row.length);
      for (let i = 0; i < Math.min(3, row.length); i++) for (let j = row.length - 1; j > i && j >= row.length - 3; j--) {
        const f0 = fit([row[i], row[j]], [gx[0], gx[gx.length - 1]]);
        if (!(f0.a > 0)) continue;
        const pick = gx.map(g => row.map(x => ({ x, d: Math.abs(f0.a * x + f0.b - g) })).sort((p, s) => p.d - s.d)[0]);
        if (pick.some(o => o.d > tolX) || new Set(pick.map(o => o.x)).size !== gx.length) continue;
        const f1 = fit(pick.map(o => o.x), gx);
        // bubbles before the first frame line: the drawing numbers its frame lines from 1 + that many
        if (f1.res < bestRes) { bestRes = f1.res; fx = f1; numberOffset = row.filter(x => x < pick[0].x - Math.max(0.8, r * 0.3)).length; }
      }
    });
    if (!fx) { out.reason = `${rowN} frame-line bubbles in a row on the drawing do not line up with the ${gx.length} frame lines from the bays`; return out; }
    if (fx.res > tolX) { out.reason = 'frame-line bubble spacing does not match the bays'; return out; }
    // letter bubbles: the outermost bubble columns left and right (not in a numbers row)
    const rowsN = rowY.filter(q => q.n >= Math.max(3, gx.length - 1)).map(q => q.y);
    const side = bub.filter(b => !rowsN.some(y => Math.abs(b.y - y) <= r));
    if (side.length < 2) { out.reason = 'letter bubbles not found'; return out; }
    const sx = cluster(side.map(b => b.x), r * 1.5);
    const leftX = sx[0], rightX = sx[sx.length - 1];
    const left = side.filter(b => Math.abs(b.x - leftX) <= r * 1.5), right = sx.length > 1 ? side.filter(b => Math.abs(b.x - rightX) <= r * 1.5) : [];
    // same scale both ways; page y grows toward the FSW, building y toward the BSW
    const a = -Math.abs(fx.a);
    const W = grid.width || Math.max(...grid.colY);
    const setL = [0, W, ...(grid.lewY || grid.colY)], setR = [0, W, ...(grid.rewY || grid.colY)];
    const tol = Math.max(0.5, spanX * 0.004);
    const score = b => left.filter(q => setL.some(g => Math.abs(a * q.y + b - g) < tol)).length + right.filter(q => setR.some(g => Math.abs(a * q.y + b - g) < tol)).length;
    let best = null;
    [[left, setL], [right, setR]].forEach(([bs, set]) => bs.forEach(q => set.forEach(g => {
      const b = g - a * q.y, sc = score(b);
      if (!best || sc > best.sc) best = { b, sc };
    })));
    const need = Math.max(3, Math.ceil(0.6 * new Set([...setL, ...setR].map(v => v.toFixed(2))).size));
    if (!best || best.sc < need) { out.reason = 'letter bubbles do not line up with the endwall column spacing'; return out; }
    // refine the offset on the inliers
    const inl = [];
    [[left, setL], [right, setR]].forEach(([bs, set]) => bs.forEach(q => { const g = set.find(g2 => Math.abs(a * q.y + best.b - g2) < tol); if (g != null) inl.push(g - a * q.y); }));
    const b0 = inl.reduce((p, q) => p + q, 0) / inl.length;
    const fy = { a, b: b0, res: Math.max(...inl.map(v => Math.abs(v - b0))) };
    const toB = (px, py) => ({ x: fx.a * px + fx.b, y: fy.a * py + fy.b });
    // lettered from the BSW down over every side bubble plus every column line and the ridge (a ridge with no
    // bubble still takes a letter on eQuote drawings), skipping I and O like the drafting
    const ly = cluster([...[...left, ...right].map(q => fy.a * q.y + fy.b), ...(grid.letterLines || [])], 1).sort((p, q) => q - p);
    const L = gridLetters(ly.length);
    out.letters = ly.map((y, i) => ({ y, letter: L[i] }));
    out.columns = crosses.map(c => ({ ...toB(c.x, c.y), kind: c.kind, markup: !!c.markup }));
    // frame columns inside the building outline (a lean-to or the title block cannot pass for one)
    const xEnd = gx[gx.length - 1];
    out.frameCols = frameCols.map(c => ({ ...toB(c.x, c.y), kind: c.kind })).filter(c => c.x > gx[0] - 3 && c.x < xEnd + 3 && c.y > -3 && c.y < W + 3);
    // joist symbols inside the building and off the wall lines (wall-liner marks and hatch ends are not joists)
    const offWalls = q => q.x > gx[0] + 1.5 && q.x < gx[gx.length - 1] - 1.5 && q.y > 1.5 && q.y < W - 1.5;
    out.arrows = arrows.map(ar => ({ ...toB(ar.x, ar.y), dir: ar.vert ? 'y' : 'x', len: ar.len * Math.abs(fx.a), kind: ar.kind || 'arrow', ends: ar.kind === 'markup' && ar.a && ar.b ? [toB(ar.a[0], ar.a[1]), toB(ar.b[0], ar.b[1])] : null }))
      .filter(q => q.kind !== 'truss' || (offWalls(q) && q.len >= 5 && q.len <= 60));
    out.beams = mk.beams.map(l => ({ a: toB(l.a[0], l.a[1]), b: toB(l.b[0], l.b[1]), dir: l.vert ? 'y' : 'x' }));
    out.markup = { columns: mk.crosses.length, joists: mk.arrows.length, beams: mk.beams.length };
    out.numberOffset = numberOffset; out.frameLines = gx.length;
    out.ok = true;
    if (!crosses.length) out.reason = 'no mezzanine column symbols found';
    out.map = { fx, fy };
    return out;
  }

  // registerAndRead's grid from LAYOUT.buildingGrid: the frame lines, every column line (sidewalls, endwall columns,
  // interior frame columns), the endwall column lines, and the lettered lines (column lines + ridge)
  // (null when Box 2 gave no building size: nothing to register a drawing to)
  const gridOf = g => (g && g.width > 0 ? { xs: g.xs, colY: [...new Set([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()].filter(Number.isFinite).map(v => +v.toFixed(3)))], lewY: g.lewY, rewY: g.rewY, width: g.width, letterLines: g.allY } : null);

  /* The floor plan among a PCS's pages: a drawing (no text layer, hundreds of vector paths) whose grid bubbles register
     to the building's frame lines. A quote can carry other vector-only sheets — the components-and-cladding wind
     table, elevations — so the drawings are tried from the last page back: the first that registers and shows
     mezzanine columns or joist arrows is the plan; else the first that registers; else the one with the most grid
     bubbles, whose reason says why it did not read. opsOf(page) → the page's operator list (async). */
  async function findPlan(pages, grid, opsOf, OPS) {
    let fit = null, best = null;
    for (const p of pages.slice().reverse()) {
      // a page with text is no drawing — nor is a form whose words are drawn as outlines (read by OCR: src/ocr.js)
      if ((p.nativeItems ?? p.items.length) > 40 || p.kind === 'outlined' || p.kind === 'scan') continue;
      const paths = subpaths(await opsOf(p), OPS, p.vt || p.height);
      if (paths.length < 800) continue;
      const reg = grid ? registerAndRead(paths, grid, p.annots || []) : { ok: false, reason: 'no building grid to register the drawing to', bubbles: 0 };
      const c = { page: p.num, paths, annots: p.annots || [], reg };
      if (reg.ok && (reg.columns.length || reg.arrows.length)) return c;
      if (reg.ok && !fit) fit = c;
      if (!best || (reg.bubbles || 0) > (best.reg.bubbles || 0)) best = c;
    }
    return fit || best;
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

  const api = { readMarkup, subpaths, readSymbols, readArrows, readJoistSymbols, chains, registerAndRead, compare, gridLetters, gridOf, findPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_PLAN = api;
})(typeof self !== 'undefined' ? self : this);
