/* Mezzanine layout: building grid -> beam lines -> beams (span, trib) -> supports -> mezzanine columns.
   The PCS floor plan is vector-only, so the layout is derived from Box 2 / Box 5 / Box 22 and shown
   as a plan for the engineer to confirm against the drawing.

   Coordinates (ft): x runs along the building length from the LEW, y across the width from the FSW. */
(function (root) {
  'use strict';
  const EPS = 0.01;
  const near = (a, b) => Math.abs(a - b) < EPS;
  const uniq = a => a.slice().sort((p, q) => p - q).filter((v, i, s) => i === 0 || !near(v, s[i - 1]));
  const cum = spacings => (spacings || []).reduce((acc, s) => (acc.push(acc[acc.length - 1] + s), acc), [0]);
  const r3 = v => Math.round(v * 1000) / 1000;
  // off-grid positions read as ft-in in labels (40'-4"/D)
  const ftin = v => { const t = Math.round(Math.abs(v) * 12 * 2) / 2, f = Math.floor(t / 12), i = t - f * 12; return (v < 0 ? '-' : '') + f + "'-" + (i % 1 ? Math.floor(i) + ' 1/2' : i) + '"'; };

  // ---- grid labels: frame lines 1..n from the LEW, letters from the BSW over every column line ----
  // drafting letters skip I and O (…G, H, J, K…)
  function letters(n) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''), out = [];
    for (let i = 0; i < n; i++) out.push(i < abc.length ? abc[i] : abc[Math.floor(i / abc.length) - 1] + abc[i % abc.length]);
    return out;
  }

  /**
   * b: { width, length, bays:[ft], lewCols:[ft], rewCols:[ft], ridge?:ft, yLetters?:[{y, letter}] (from the drawing),
   *      frames:[{ from, to, interior:[ft spacings from FSW] }] }   (frame lines numbered from 1 at the LEW)
   */
  function buildingGrid(b) {
    const xs = cum(b.bays);
    // a short bay list: the length closes the last bay. Within 2'-0" it is a dimension convention (Box 2 measured to a
    // different line than the bays), not a bay: the frames stay on the bay lines and the gap is reported
    const gap = b.length > 0 ? b.length - xs[xs.length - 1] : 0;   // no length read (Box 2 unread): the bays as they are
    let lengthGap = 0;
    if (!near(gap, 0) && Math.abs(gap) <= 2 + EPS) lengthGap = gap;
    else if (!near(gap, 0)) xs.push(b.length);
    const length = lengthGap || !(b.length > 0) ? xs[xs.length - 1] : b.length;
    const lewY = b.lewCols && b.lewCols.length ? cum(b.lewCols) : [0, b.width];
    const rewY = b.rewCols && b.rewCols.length ? cum(b.rewCols) : [0, b.width];
    // interior (multi-span) frame columns per frame line
    const interior = xs.map(() => []);
    (b.frames || []).forEach(f => {
      const ys = cum(f.interior || []).slice(1, -1);
      for (let k = f.from; k <= f.to; k++) if (k - 1 < interior.length) interior[k - 1] = ys;
    });
    const allY = uniq([0, b.width, ...lewY, ...rewY, ...interior.flat(), ...(b.ridge ? [b.ridge] : [])]);
    const byBSW = allY.slice().sort((p, q) => q - p);
    const L = letters(byBSW.length);
    // letters read off the PCS floor plan win (they count every bubble, e.g. a lean-to line); else our own
    const drawn = b.yLetters && b.yLetters.length ? b.yLetters : null;
    const yLabel = y => {
      if (drawn) { const d = drawn.find(q => Math.abs(q.y - y) < 0.5); return d ? d.letter : null; }
      const i = byBSW.findIndex(v => near(v, y)); return i < 0 ? null : L[i];
    };
    const xLabel = x => { const i = xs.findIndex(v => near(v, x)); return i < 0 ? null : String(i + 1); };
    // sidewall soldier columns between frames (spacing from the LEW)
    const fswX = b.fswSoldier && b.fswSoldier.length ? cum(b.fswSoldier) : [];
    const bswX = b.bswSoldier && b.bswSoldier.length ? cum(b.bswSoldier) : [];
    return { xs, lewY, rewY, interior, allY, yLabel, xLabel, fswX, bswX, width: b.width, length, boxLength: b.length, lengthGap };
  }

  // Is there a building column at (x, y)?
  function isBuildingColumn(g, x, y) {
    const fi = g.xs.findIndex(v => near(v, x));
    const onFrame = fi >= 0;
    if ((near(y, 0) || near(y, g.width)) && onFrame) return true;             // sidewall frame column
    if (near(y, 0) && (g.fswX || []).some(v => near(v, x))) return true;       // FSW soldier column
    if (near(y, g.width) && (g.bswX || []).some(v => near(v, x))) return true; // BSW soldier column
    if (near(x, 0) && g.lewY.some(v => near(v, y))) return true;              // LEW column (corners incl.)
    if (near(x, g.length) && g.rewY.some(v => near(v, y))) return true;       // REW column
    if (onFrame && g.interior[fi].some(v => near(v, y))) return true;          // interior frame column
    return false;
  }

  /**
   * m: { length (along x), width (along y), startLEW, startFSW }
   * opt: { joists: 'auto' | 'x' | 'y', xLines?:[ft], yLines?:[ft] (absolute, override),
   *        drop?: ['x,y'] — columns taken out: the beam on that line spans through (never a line's first or last),
   *        drawn?: [{x, y}] — the column symbols on the PCS floor plan (building ft),
   *        drawnMezz?: [{x, y}] — the mezzanine column symbols among them, follow?: true — the supports on each beam line
   *          are the building columns and the mezzanine columns drawn on it (nothing the drawing does not show),
   *        openings?: [{ x0, x1, y0, y1 }] — floor openings, framed as frameOpenings says }
   *   joists 'y' => joists span across the width (y), beams run along x.
   */
  const SNAP_EDGE = 1;   // ft: a frame line this close outside a mezzanine edge still frames that edge
  const SNAP_DRAWN = 3;  // ft: how far an edge with no column drawn on it may overhang a line the drawing puts columns on
  function layout(g, m, opt = {}) {
    const x0 = m.startLEW || 0, x1 = x0 + m.length, y0 = m.startFSW || 0, y1 = y0 + m.width;
    const inside = (v, a, b) => v > a + EPS && v < b - EPS;
    const nearerEW = (x0 + x1) / 2 <= g.length / 2 ? g.lewY : g.rewY;
    // column lines across the width: the nearer endwall's, and the interior columns of the frames this mezzanine
    // actually spans — not every frame's (a far endwall column 2' off this one's would make a 2' bay and extra columns)
    const onFrames = g.xs.map((x, i) => (x >= x0 - SNAP_EDGE && x <= x1 + SNAP_EDGE ? g.interior[i] : [])).flat();
    const yCand = uniq([...nearerEW, ...onFrames]);
    // an edge within SNAP of a grid line sits on that line (95'-8" → 96'-0"): the slab overhangs, or stops
    // short of, the line by the difference instead of creating a second line a few inches away
    const SNAP = opt.snap ?? 1;
    const snaps = [];
    // the floor plan's column symbols along a line, within the mezzanine's extent the other way
    const drawn = opt.drawn && opt.drawn.length ? opt.drawn : null;
    const drawnOn = (axis, v) => drawn.some(c => { const a = axis === 'x' ? c.x : c.y, o = axis === 'x' ? c.y : c.x, [lo, hi] = axis === 'x' ? [y0, y1] : [x0, x1]; return Math.abs(a - v) < 0.75 && o > lo - 1 && o < hi + 1; });
    // side: -1 for the edge at the LEW / FSW end of the mezzanine, +1 for the other
    const snapTo = (v, cands, axis, side) => {
      const by = (a, b) => Math.abs(a - v) - Math.abs(b - v);
      // within 1/8" of a line (Box 22's 1/16" dimensions adding up a hair past a wall): on the line, nothing to say
      const on = cands.filter(u => near(u, v)).sort(by)[0];
      if (on != null) return on;
      let c = cands.filter(u => Math.abs(u - v) <= SNAP + EPS && !near(u, v)).sort(by)[0], drawnSnap = false;
      // the PCS floor plan draws no column on this edge but does on a line up to 3'-0" inside it: the edge is framed on
      // that line and the slab overhangs it (a joist or beam cantilever), as drawn — not a beam line of its own on new
      // columns. An edge short of a line (the slab stops inside it) is never moved out to it this way.
      if (c == null && drawn && !drawnOn(axis, v)) {
        c = cands.filter(u => (u - v) * side < -EPS && Math.abs(u - v) <= SNAP_DRAWN + EPS && drawnOn(axis, u)).sort(by)[0];
        drawnSnap = c != null;
      }
      if (c == null) return v;
      snaps.push({ axis, edge: v, line: c, drawn: drawnSnap });
      return c;
    };
    // an edge past the building's end line (within 2'-0", e.g. a Box 2 length longer than the bays) cannot have columns
    // outside the building: it is framed on the end line and the slab overhangs it
    const outside = (v, lo, hi, axis) => { const e = v < lo - EPS ? lo : v > hi + EPS ? hi : null; if (e == null || Math.abs(v - e) > 2 + EPS) return null; snaps.push({ axis, edge: v, line: e, outside: true }); return e; };
    const sx0 = outside(x0, 0, g.length, 'x') ?? snapTo(x0, g.xs, 'x', -1), sx1 = outside(x1, 0, g.length, 'x') ?? snapTo(x1, g.xs, 'x', 1);
    const sy0 = snapTo(y0, uniq([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()]), 'y', -1), sy1 = snapTo(y1, uniq([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()]), 'y', 1);
    const xLines = opt.xLines ? uniq(opt.xLines) : uniq([sx0, sx1, ...g.xs.filter(v => inside(v, sx0, sx1))]);
    const yLines = opt.yLines ? uniq(opt.yLines) : uniq([sy0, sy1, ...yCand.filter(v => inside(v, sy0, sy1))]);
    // slab beyond (+) or short of (−) the first / last line along each axis, added to the edge beam's trib
    const over = { x: [xLines[0] - x0, x1 - xLines[xLines.length - 1]], y: [yLines[0] - y0, y1 - yLines[yLines.length - 1]] };

    const dropKey = (x, y) => `${(+x).toFixed(2)},${(+y).toFixed(2)}`;
    const drop = new Set(opt.drop || []);
    // the drawing's mezzanine columns in or on this mezzanine: when they are followed, a beam line's supports are the
    // building columns on it and the columns drawn on it — a grid line crossing it adds no column the drawing lacks
    const dm = (opt.drawnMezz || []).filter(c => c.x > x0 - 1 && c.x < x1 + 1 && c.y > y0 - 1 && c.y < y1 + 1);
    const follow = !!opt.follow && dm.length > 0 && !opt.xLines && !opt.yLines;
    const build = joists => {
      // joists 'y': beams along x on each y line, spanning between consecutive x lines
      const beamLines = joists === 'y' ? yLines : xLines;
      const supportLines = joists === 'y' ? xLines : yLines;
      // slab past the first / last support line along the beams: the end beams cantilever it to their end supports
      const ovAlong = over[joists === 'y' ? 'x' : 'y'];
      const beams = [], dropped = [];
      beamLines.forEach((c, i) => {
        const prev = i > 0 ? c - beamLines[i - 1] : 0, next = i < beamLines.length - 1 ? beamLines[i + 1] - c : 0;
        const ov = over[joists === 'y' ? 'y' : 'x'];
        const trib = r3(prev / 2 + next / 2 + (i === 0 ? ov[0] : 0) + (i === beamLines.length - 1 ? ov[1] : 0));
        const P = s => (joists === 'y' ? { x: s, y: c } : { x: c, y: s });
        // a column taken out: the beam spans on to the next support line
        const lo = supportLines[0], hi = supportLines[supportLines.length - 1];
        let cand = supportLines;
        if (follow) {
          const onLine = dm.filter(d => Math.abs((joists === 'y' ? d.y : d.x) - c) < 0.75).map(d => r3(joists === 'y' ? d.x : d.y)).filter(v => v > lo + 0.5 && v < hi - 0.5);
          const bldg = supportLines.filter(v => v > lo + EPS && v < hi - EPS && isBuildingColumn(g, P(v).x, P(v).y));
          // a column drawn within 6" of a grid line is on that line
          const merged = [lo, hi, ...bldg].concat(onLine.filter(v => !supportLines.some(u => Math.abs(u - v) <= 0.5))).concat(supportLines.filter(u => u > lo + EPS && u < hi - EPS && !bldg.includes(u) && onLine.some(v => Math.abs(u - v) <= 0.5)));
          cand = uniq(merged);
        }
        const stops = cand.filter((v, k) => {
          if (k === 0 || k === cand.length - 1) return true;
          const p = P(v), out = drop.has(dropKey(p.x, p.y));
          if (out) dropped.push({ x: r3(p.x), y: r3(p.y), line: c, label: (g.xLabel(p.x) || ftin(p.x)) + '/' + (g.yLabel(p.y) || ftin(p.y)) });
          return !out;
        });
        for (let k = 0; k < stops.length - 1; k++) {
          const a = stops[k], b = stops[k + 1];
          const beam = { id: beams.length, line: c, from: a, to: b, span: r3(b - a), trib, dir: joists === 'y' ? 'x' : 'y', edge: prev === 0 || next === 0, ends: [P(a), P(b)],
            ov: [k === 0 ? Math.max(0, r3(ovAlong[0])) : 0, k === stops.length - 2 ? Math.max(0, r3(ovAlong[1])) : 0] };
          beams.push(beam);
        }
      });
      const joistSpan = Math.max(...beamLines.slice(1).map((v, i) => v - beamLines[i]));
      const beamSpan = Math.max(...supportLines.slice(1).map((v, i) => v - supportLines[i]));
      const out = { joists, beamLines, supportLines, beams, joistSpan, beamSpan: Math.max(beamSpan, ...beams.map(b => b.span)), dropped, follow, openings: [] };
      if (opt.openings && opt.openings.length) frameOpenings(out, opt.openings, g);
      Object.assign(out, supportsOf(out.beams, g, out.onBeam));
      if (out.openings.length) out.beamSpan = Math.max(beamSpan, ...out.beams.map(b => b.span));
      return out;
    };
    const A = build('y'), B = build('x');
    let pick = opt.joists === 'x' ? B : opt.joists === 'y' ? A : null, why = 'manual';
    if (!pick) {
      // DM 15.1.1.3: beams run the shorter clear span, joists the longer. Tie -> fewer beams, then fewer columns.
      const score = o => [o.beamSpan <= o.joistSpan + EPS ? 0 : 1, o.beams.length, o.mezzCols.length];
      const sa = score(A), sb = score(B);
      const cmp = sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2];
      pick = cmp <= 0 ? A : B;
      why = sa[0] !== sb[0] ? 'beams on the shorter span (DM 15.1.1.3)' : sa[1] !== sb[1] ? 'equal spans; fewer beams' : 'equal spans and beam count';
    }
    return { ...pick, why, footprint: { x0, x1, y0, y1 }, xLines, yLines, snaps: opt.xLines || opt.yLines ? [] : snaps, alt: pick === A ? B : A };
  }

  /* The supports of a set of beams: one per end point, every beam that ends there (L: the beam lies before the support
     along its own direction, R: after it; a third beam — one the other way at a corner, a trimmer — goes in `more`).
     onBeam: end points that bear on another beam (a cut beam on its trimmer), not on a column. */
  function supportsOf(beams, g, onBeam) {
    const at = new Map(), key = p => r3(p.x) + ',' + r3(p.y);
    beams.forEach(b => {
      [[b.ends[0], 'R'], [b.ends[1], 'L']].forEach(([p, side]) => {
        const k = key(p);
        if (!at.has(k)) at.set(k, { x: r3(p.x), y: r3(p.y), beams: { L: null, R: null } });
        const sp = at.get(k);
        if (sp.beams[side] == null) sp.beams[side] = b.id; else (sp.more = sp.more || []).push({ id: b.id, side });
      });
    });
    const on = new Set(onBeam || []);
    const supports = [...at.values()].map(sp => ({ ...sp, building: isBuildingColumn(g, sp.x, sp.y), onBeam: on.has(sp.x.toFixed(3) + ',' + sp.y.toFixed(3)) || undefined,
      label: (g.xLabel(sp.x) || ftin(sp.x)) + '/' + (g.yLabel(sp.y) || ftin(sp.y)) }));
    return { supports, mezzCols: supports.filter(sp => !sp.building && !sp.onBeam) };
  }

  /* A floor opening framed the way the NBG drawings frame one (a practice job: the 13'-0" × 8'-0" opening by frame line 4):
     - a beam line through the opening stops at a trimmer on the opening's edge across the beams; the trimmer takes the
       cut beam's end as a point load, designed at the uniform trib with the same largest moment and end shear;
     - the joists the opening cuts bear on a header on its edge across the joists, unless a beam line is there already;
     - columns at the header's and the trimmer's ends (a beam they land on is split there); an opening against the slab
       edge needs nothing on that side.
     The beams around keep their full trib (the floor the opening takes away is left on them: conservative).
     L: build()'s result (beams, beamLines, supportLines, joists) — changed in place; ops in building ft. */
  function frameOpenings(L, ops, g) {
    const J = L.joists, U = p => (J === 'y' ? p.y : p.x), V = p => (J === 'y' ? p.x : p.y), XY = (u, v) => (J === 'y' ? { x: v, y: u } : { x: u, y: v });
    const bl = L.beamLines, sl = L.supportLines, uLo = bl[0], uHi = bl[bl.length - 1], vLo = sl[0], vHi = sl[sl.length - 1];
    const snap = (v, lines) => { const c = lines.find(q => Math.abs(q - v) <= 0.5); return c != null ? c : r3(v); };
    let beams = L.beams.slice();
    const onBeam = [], perpDir = J === 'y' ? 'y' : 'x', beamDir = J === 'y' ? 'x' : 'y';
    const mk = (line, from, to, trib, dir, extra) => {
      const ends = dir === beamDir ? [XY(line, from), XY(line, to)] : (J === 'y' ? [{ x: line, y: from }, { x: line, y: to }] : [{ x: from, y: line }, { x: to, y: line }]);
      return { id: -1, line, from: r3(from), to: r3(to), span: r3(to - from), trib: r3(trib), dir, edge: false, ends, ov: [0, 0], ...extra };
    };
    ops.forEach((op, oi) => {
      let u0 = Math.min(U({ x: op.x0, y: op.y0 }), U({ x: op.x1, y: op.y1 })), u1 = Math.max(U({ x: op.x0, y: op.y0 }), U({ x: op.x1, y: op.y1 }));
      let v0 = Math.min(V({ x: op.x0, y: op.y0 }), V({ x: op.x1, y: op.y1 })), v1 = Math.max(V({ x: op.x0, y: op.y0 }), V({ x: op.x1, y: op.y1 }));
      u0 = snap(Math.max(u0, uLo), bl); u1 = snap(Math.min(u1, uHi), bl); v0 = snap(Math.max(v0, vLo), sl); v1 = snap(Math.min(v1, vHi), sl);
      if (u1 - u0 < 0.5 || v1 - v0 < 0.5) return;
      const rec = { index: oi, x0: Math.min(XY(u0, v0).x, XY(u1, v1).x), x1: Math.max(XY(u0, v0).x, XY(u1, v1).x), y0: Math.min(XY(u0, v0).y, XY(u1, v1).y), y1: Math.max(XY(u0, v0).y, XY(u1, v1).y), cut: [], headers: [], trimmers: [], cols: [] };
      const loads = { [v0]: [], [v1]: [] };
      // 1. beam lines through the opening stop at its edges
      const keep = [];
      beams.forEach(b => {
        if (!(b.dir === beamDir && b.line > u0 + 0.3 && b.line < u1 - 0.3 && b.from < v1 - 0.01 && b.to > v0 + 0.01)) { keep.push(b); return; }
        rec.cut.push({ line: b.line, from: b.from, to: b.to });
        if (v0 - b.from > 0.3) { const q = { ...b, to: v0, span: r3(v0 - b.from), ends: [b.ends[0], XY(b.line, v0)], ov: [b.ov[0], 0], cutEnd: 'to' }; keep.push(q); loads[v0].push({ u: b.line, A: q.trib * q.span / 2 }); onBeam.push(XY(b.line, v0)); }
        if (b.to - v1 > 0.3) { const q = { ...b, from: v1, span: r3(b.to - v1), ends: [XY(b.line, v1), b.ends[1]], ov: [0, b.ov[1]], cutEnd: 'from' }; keep.push(q); loads[v1].push({ u: b.line, A: q.trib * q.span / 2 }); onBeam.push(XY(b.line, v1)); }
      });
      beams = keep;
      const colAt = [];
      // 2. a header on each edge across the joists the opening cuts (not on a beam line, not at the slab edge)
      [[u0, -1], [u1, 1]].forEach(([e, side]) => {
        if (bl.some(c => Math.abs(c - e) < 0.3) || Math.abs(e - uLo) < 0.3 || Math.abs(e - uHi) < 0.3) return;
        const beyond = side < 0 ? bl.filter(c => c < e - 0.3) : bl.filter(c => c > e + 0.3);
        if (!beyond.length) return;
        const far = side < 0 ? Math.max(...beyond) : Math.min(...beyond);
        const h = mk(e, v0, v1, Math.abs(e - far) / 2, beamDir, { opening: 'header', openingIndex: oi });
        beams.push(h); rec.headers.push(h); colAt.push(XY(e, v0), XY(e, v1));
      });
      // 3. a trimmer on each edge across the beams where a cut beam ends, carrying its end
      [v0, v1].forEach(f => {
        if (!loads[f].length) return;
        const Lt = u1 - u0, P = loads[f].map(q => ({ a: q.u - u0, A: q.A }));
        const R0 = P.reduce((s2, q) => s2 + q.A * (Lt - q.a) / Lt, 0), R1 = P.reduce((s2, q) => s2 + q.A * q.a / Lt, 0);
        const M = Math.max(...P.map(q => R0 * q.a - P.filter(w => w.a < q.a).reduce((s2, w) => s2 + w.A * (q.a - w.a), 0)));
        // rounded up to the inch, as a neighbour's partial floor is (RUN.equivTrib): the beam sheet takes a uniform trib
        const tribEq = Math.ceil(Math.max(8 * M / (Lt * Lt), 2 * Math.max(R0, R1) / Lt) * 12 - 1e-6) / 12;
        const t = mk(f, u0, u1, tribEq, perpDir, { opening: 'trimmer', openingIndex: oi, points: P.map(q => ({ at: r3(u0 + q.a), area: r3(q.A) })) });
        beams.push(t); rec.trimmers.push(t); colAt.push(XY(u0, f), XY(u1, f));
      });
      // 4. columns at those ends: a beam running through one is split there
      colAt.forEach(p => {
        if (rec.cols.some(q => Math.abs(q.x - p.x) < 0.05 && Math.abs(q.y - p.y) < 0.05)) return;
        rec.cols.push({ x: r3(p.x), y: r3(p.y) });
        const i = beams.findIndex(b => b.dir === beamDir && Math.abs(b.line - U(p)) < 0.05 && V(p) > b.from + 0.05 && V(p) < b.to - 0.05);
        if (i >= 0) {
          const b = beams[i], v = V(p);
          beams.splice(i, 1, { ...b, to: r3(v), span: r3(v - b.from), ends: [b.ends[0], XY(b.line, v)], ov: [b.ov[0], 0] }, { ...b, from: r3(v), span: r3(b.to - v), ends: [XY(b.line, v), b.ends[1]], ov: [0, b.ov[1]] });
        }
      });
      L.openings.push(rec);
    });
    beams.forEach((b, i) => { b.id = i; });
    L.openings.forEach(r => ['headers', 'trimmers'].forEach(k => { r[k] = r[k].map(b => b.id); }));
    L.beams = beams;
    L.onBeam = onBeam.map(p => r3(p.x).toFixed(3) + ',' + r3(p.y).toFixed(3));
  }

  /* Beam marks. mode 'single': one governing mark (max span, max trib) for every beam — the way the
     example job is quoted. mode 'split': group by trib and by span (spans within 5' share a mark, per the
     training guide), up to 4 marks like MB1..MB4. */
  function beamMarks(beams, mode = 'single') {
    if (!beams.length) return [];
    if (mode === 'single') {
      return [{ mark: 'MB1', span: Math.max(...beams.map(b => b.span)), trib: Math.max(...beams.map(b => b.trib)), beams: beams.map(b => b.id) }];
    }
    const spans = uniq(beams.map(b => b.span)).sort((a, b) => b - a);
    const spanGroups = [];
    spans.forEach(s => { const gr = spanGroups.find(gp => gp.max - s <= 5 + EPS); gr ? gr.members.push(s) : spanGroups.push({ max: s, members: [s] }); });
    const marks = [];
    spanGroups.forEach(sg => {
      const inGroup = beams.filter(b => sg.members.some(s => near(s, b.span)));
      // tribs within 6" share a mark (designed at the larger) — two marks a few inches apart would land on one section
      const tGroups = [];
      uniq(inGroup.map(b => b.trib)).sort((a, b) => b - a).forEach(t => { const tg = tGroups.find(q => q.top - t <= 0.5 + 1e-9); tg ? tg.ts.push(t) : tGroups.push({ top: t, ts: [t] }); });
      tGroups.forEach(tg => {
        const ids = inGroup.filter(b => tg.ts.some(t => near(b.trib, t))).map(b => b.id);
        marks.push({ span: sg.max, trib: tg.top, beams: ids, own: ids.slice() });
      });
    });
    marks.sort((a, b) => b.span * b.trib - a.span * a.trib);
    const spanOf = ids => Math.max(...ids.map(u => beams.find(b => b.id === u).span));
    while (marks.length > 4) { // the lightest-loaded group rides on another mark — recorded once per group, so it is said
      const last = marks.pop();
      // its own beams and each group it already carried are placed separately, each by its own span and trib, so a group
      // never rides along to a heavier mark than one that covers it
      const groups = [{ span: spanOf(last.own), trib: last.trib, beams: last.own.slice() }].concat((last.merged || []).map(q => ({ span: q.span, trib: q.trib, beams: q.beams.slice() })));
      groups.forEach(g => {
        // the lightest mark whose span and trib both cover the group carries it at its own design point; only when none
        // does is the lightest remaining mark raised to cover it (conservative)
        const cover = marks.filter(m => m.span >= g.span - EPS && m.trib >= g.trib - EPS).sort((a, b) => a.span * a.trib - b.span * b.trib)[0];
        const host = cover || marks[marks.length - 1];
        host.merged = (host.merged || []).concat({ ...g, covered: !!cover });
        if (!cover) { host.span = Math.max(host.span, g.span); host.trib = Math.max(host.trib, g.trib); }
        host.beams.push(...g.beams);
      });
    }
    return marks.map((mk, i) => { const { own, ...rest } = mk; return { mark: 'MB' + (i + 1), ...rest }; });
  }

  const api = { buildingGrid, layout, beamMarks, isBuildingColumn, cum, letters, frameOpenings, supportsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_LAYOUT = api;
})(typeof self !== 'undefined' ? self : this);
