/* Floor-plan reader. The eQuote floor plan (last PCS page) has no text layer: everything, text included,
   is stroked vectors. What can be read reliably is geometry:
     - grid bubbles  : circles r ≈ 6–14 pt (numbers along the top/bottom, letters along the sides)
     - mezz columns  : a small circle r ≈ 2.5–7 pt with either two diagonals (⊗) or an I-shape (web + flange
                       strokes) at its centre — both conventions appear on eQuote drawings
     - frame columns : a bare I (web stroke with a flange stroke across each end, no circle) — sidewall, endwall
                       and interior frame columns; and ✱ (four strokes through one point: horizontal, vertical,
                       two diagonals), the interior frame columns "designated as Most Economical" in Box 5
     - joist arrows  : "Mez. Jst." — a straight shaft with a half arrowhead (~30°) at each end
     - joist symbols : a short truss drawn along the joists — a chord line with a zigzag of webs beside it
   Circles are drawn either as one polyline or as dozens of 2-point segments; segments are chained first.
   The bubbles register the drawing to the building grid (same scale on both axes, so extra bubbles — a
   lean-to, an offset letter — cannot throw the fit), every side bubble is lettered from the BSW down
   skipping I and O like the drafting, and each symbol is snapped to building coordinates. */
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
    const uniq = [];
    circles.sort((a, b) => b.r - a.r).forEach(c => { if (!uniq.some(u => Math.hypot(u.x - c.x, u.y - c.y) < Math.max(0.8, c.r * 0.3) && Math.abs(u.r - c.r) < u.r * 0.25)) uniq.push(c); });
    const crosses = [], plain = [];
    const axial = s => (Math.abs(s.b[0] - s.a[0]) < 0.12 * s.len ? 'v' : Math.abs(s.b[1] - s.a[1]) < 0.12 * s.len ? 'h' : null);
    uniq.forEach(c => {
      if (c.r > 8) { plain.push(c); return; }
      const diag = segs.filter(s => Math.hypot(s.mx - c.x, s.my - c.y) < c.r * 0.35 && s.len > c.r * 1.1 && s.len < c.r * 2.4 && Math.abs(Math.abs(s.slope) - 1) < 0.6);
      const hasX = diag.some(s => s.slope > 0) && diag.some(s => s.slope < 0);
      // circled I: a web stroke through the centre (either orientation) with a flange stroke across one end
      const webs = segs.filter(s => axial(s) && Math.hypot(s.mx - c.x, s.my - c.y) < c.r * 0.3 && s.len > c.r * 0.6 && s.len < c.r * 1.6);
      const hasI = webs.some(w => segs.some(f => f !== w && axial(f) && axial(f) !== axial(w) && f.len > c.r * 0.35 && f.len < c.r * 1.3
        && Math.min(Math.hypot(f.mx - w.a[0], f.my - w.a[1]), Math.hypot(f.mx - w.b[0], f.my - w.b[1])) < c.r * 0.3));
      if (hasX) crosses.push({ ...c, kind: 'x' });
      else if (hasI) crosses.push({ ...c, kind: 'i' });
      else plain.push(c);
    });
    const inCircle = p => uniq.some(c => c.r <= 8 && Math.hypot(c.x - p.x, c.y - p.y) < c.r * 1.05);
    // frame columns, bare I: a web with a flange stroke across each end (either orientation), not inside a circle
    const frameCols = [];
    const ax = segs.filter(sg => axial(sg) && sg.len >= 0.8 && sg.len <= 12);
    ax.forEach(w => {
      if (w.len < 2.5 || w.len > 10) return;
      const o = axial(w), tol = Math.max(0.35, w.len * 0.12);
      const flange = end => ax.some(f => f !== w && axial(f) !== o && f.len >= w.len * 0.25 && f.len <= w.len * 1.4 && Math.hypot(f.mx - end[0], f.my - end[1]) < tol);
      const c = { x: w.mx, y: w.my };
      if (!flange(w.a) || !flange(w.b) || inCircle(c) || frameCols.some(q => Math.hypot(q.x - c.x, q.y - c.y) < 1)) return;
      frameCols.push({ ...c, kind: 'I' });
    });
    // ✱: three or more strokes crossing at their common midpoint in three or more directions, one diagonal
    const ang = sg => Math.round(((Math.atan2(sg.b[1] - sg.a[1], sg.b[0] - sg.a[0]) * 180 / Math.PI) % 180 + 180) % 180 / 15) % 12;
    const mid = segs.filter(sg => sg.len >= 2.5 && sg.len <= 10);
    mid.forEach(sg => {
      const c = { x: sg.mx, y: sg.my };
      if (frameCols.some(q => Math.hypot(q.x - c.x, q.y - c.y) < 1)) return;
      const thru = mid.filter(t => Math.hypot(t.mx - c.x, t.my - c.y) < Math.max(0.35, sg.len * 0.1));
      if (thru.length >= 3 && new Set(thru.map(ang)).size >= 3 && thru.some(t => !axial(t)) && !inCircle(c)) frameCols.push({ ...c, kind: 'star' });
    });
    const longSegs = paths.filter(p => p.length === 2).map(p => ({ a: p[0], b: p[1], len: Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) })).filter(sg => sg.len >= 25);
    return { crosses, frameCols, circles: plain, arrows: readArrows(segs.concat(longSegs)).concat(readJoistSymbols(paths)) };
  }

  /* "Mez. Jst." joist-span arrows: an axis-aligned shaft with a short stroke leaving each end at ~30° to it
     (a half arrowhead; the two heads sit on opposite sides). Hatching is at 45° and dimension lines carry
     ticks, so the 20–40° window plus a head at both ends keeps them out. */
  function readArrows(segs) {
    const out = [];
    const long = segs.filter(s => s.len >= 25 && s.len <= 400 && (Math.abs(s.b[0] - s.a[0]) < 0.02 * s.len || Math.abs(s.b[1] - s.a[1]) < 0.02 * s.len));
    const short = segs.filter(s => s.len >= 3 && s.len <= 14);
    const at = (p, q) => Math.abs(p[0] - q[0]) < 0.4 && Math.abs(p[1] - q[1]) < 0.4;
    long.forEach(sh => {
      const vert = Math.abs(sh.b[0] - sh.a[0]) < Math.abs(sh.b[1] - sh.a[1]);
      const head = end => short.some(h => {
        const o = at(h.a, end) ? h.b : at(h.b, end) ? h.a : null;
        if (!o) return false;
        const along = Math.abs(vert ? o[1] - end[1] : o[0] - end[0]), across = Math.abs(vert ? o[0] - end[0] : o[1] - end[1]);
        const ang = Math.atan2(across, along) * 180 / Math.PI;
        return ang > 20 && ang < 40;
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
    paths.forEach(p => { if (p.length >= 2 && p.length <= 60 && !p.closed) for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len > 0.3) seg.push({ a, b, len }); } });
    const out = [];
    seg.filter(c => c.len >= 18 && c.len <= 320).forEach(c => {
      const horiz = Math.abs(c.b[1] - c.a[1]) < 0.02 * c.len, vert = Math.abs(c.b[0] - c.a[0]) < 0.02 * c.len;
      if (!horiz && !vert) return;
      const u = p => (horiz ? p[0] : p[1]), w = p => (horiz ? p[1] : p[0]);   // along / across the chord
      const lo = Math.min(u(c.a), u(c.b)), hi = Math.max(u(c.a), u(c.b)), off = w(c.a);
      for (const sideSign of [1, -1]) {
        const webs = seg.filter(q => {
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
  function registerAndRead(paths, grid) {
    const { crosses, frameCols, circles, arrows } = readSymbols(paths);
    const bub = bubbles(circles);
    const out = { ok: false, crosses: crosses.length, bubbles: bub.length, columns: [], arrows: [], letters: [] };
    if (bub.length < 4) { out.reason = 'grid bubbles not found'; return out; }
    const r = bub[0].r;
    // rows of bubbles (numbers) share y; columns of bubbles (letters) share x
    const ys = cluster(bub.map(b => b.y), r), xs = cluster(bub.map(b => b.x), r);
    const rowY = ys.map(y => ({ y, n: bub.filter(b => Math.abs(b.y - y) <= r).length })).sort((a, b) => b.n - a.n);
    const colX = xs.map(x => ({ x, n: bub.filter(b => Math.abs(b.x - x) <= r).length })).sort((a, b) => b.n - a.n);
    const topRow = rowY.filter(q => q.n === rowY[0].n).sort((a, b) => a.y - b.y)[0];
    const numX = bub.filter(b => Math.abs(b.y - topRow.y) <= r).map(b => b.x).sort((a, b) => a - b);
    const gx = grid.xs.slice().sort((a, b) => a - b);
    if (numX.length !== gx.length) { out.reason = `${numX.length} frame-line bubbles on the drawing, ${gx.length} frame lines from the bays`; return out; }
    const fx = fit(numX, gx);
    const spanX = gx[gx.length - 1] - gx[0] || 1;
    if (fx.res > spanX * 0.02 + 0.5) { out.reason = 'frame-line bubble spacing does not match the bays'; return out; }
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
    out.columns = crosses.map(c => ({ ...toB(c.x, c.y), kind: c.kind }));
    // frame columns inside the building outline (a lean-to or the title block cannot pass for one)
    const xEnd = gx[gx.length - 1];
    out.frameCols = frameCols.map(c => ({ ...toB(c.x, c.y), kind: c.kind })).filter(c => c.x > gx[0] - 3 && c.x < xEnd + 3 && c.y > -3 && c.y < W + 3);
    // joist symbols inside the building and off the wall lines (wall-liner marks and hatch ends are not joists)
    const offWalls = q => q.x > gx[0] + 1.5 && q.x < gx[gx.length - 1] - 1.5 && q.y > 1.5 && q.y < W - 1.5;
    out.arrows = arrows.map(ar => ({ ...toB(ar.x, ar.y), dir: ar.vert ? 'y' : 'x', len: ar.len * Math.abs(fx.a), kind: ar.kind || 'arrow' }))
      .filter(q => q.kind !== 'truss' || (offWalls(q) && q.len >= 5 && q.len <= 60));
    out.ok = true;
    if (!crosses.length) out.reason = 'no mezzanine column symbols found';
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

  const api = { subpaths, readSymbols, readArrows, readJoistSymbols, chains, registerAndRead, compare, gridLetters };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_PLAN = api;
})(typeof self !== 'undefined' ? self : this);
