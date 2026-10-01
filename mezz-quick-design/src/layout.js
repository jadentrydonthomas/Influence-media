/* Mezzanine layout: building grid -> beam lines -> beams (span, trib) -> supports -> mezzanine columns.
   The PCS floor plan is vector-only, so the layout is derived from Box 2 / Box 5 / Box 22 and shown
   as a plan for the engineer to confirm against the drawing.

   Coordinates (ft): x runs along the building length from the LEW, y across the width from the FSW. */
(function (root) {
  'use strict';
  const EPS = 0.01;
  const near = (a, b) => Math.abs(a - b) < EPS;
  const uniq = a => a.slice().sort((p, q) => p - q).filter((v, i, s) => i === 0 || !near(v, s[i - 1]));
  const cum = spacings => spacings.reduce((acc, s) => (acc.push(acc[acc.length - 1] + s), acc), [0]);
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
    if (!near(xs[xs.length - 1], b.length)) xs.push(b.length); // tolerate a short bay list
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
    return { xs, lewY, rewY, interior, allY, yLabel, xLabel, fswX, bswX, width: b.width, length: b.length };
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
   * opt: { joists: 'auto' | 'x' | 'y', xLines?:[ft], yLines?:[ft] (absolute, override) }
   *   joists 'y' => joists span across the width (y), beams run along x.
   */
  function layout(g, m, opt = {}) {
    const x0 = m.startLEW || 0, x1 = x0 + m.length, y0 = m.startFSW || 0, y1 = y0 + m.width;
    const inside = (v, a, b) => v > a + EPS && v < b - EPS;
    const nearerEW = (x0 + x1) / 2 <= g.length / 2 ? g.lewY : g.rewY;
    const yCand = uniq([...nearerEW, ...g.interior.flat()]);
    // an edge within SNAP of a grid line sits on that line (95'-8" → 96'-0"): the slab overhangs, or stops
    // short of, the line by the difference instead of creating a second line a few inches away
    const SNAP = opt.snap ?? 1;
    const snaps = [];
    const snapTo = (v, cands, axis) => {
      const c = cands.filter(u => Math.abs(u - v) <= SNAP + EPS && !near(u, v)).sort((a, b) => Math.abs(a - v) - Math.abs(b - v))[0];
      if (c == null) return v;
      snaps.push({ axis, edge: v, line: c });
      return c;
    };
    const sx0 = snapTo(x0, g.xs, 'x'), sx1 = snapTo(x1, g.xs, 'x');
    const sy0 = snapTo(y0, uniq([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()]), 'y'), sy1 = snapTo(y1, uniq([0, g.width, ...g.lewY, ...g.rewY, ...g.interior.flat()]), 'y');
    const xLines = opt.xLines ? uniq(opt.xLines) : uniq([sx0, sx1, ...g.xs.filter(v => inside(v, sx0, sx1))]);
    const yLines = opt.yLines ? uniq(opt.yLines) : uniq([sy0, sy1, ...yCand.filter(v => inside(v, sy0, sy1))]);
    // slab beyond (+) or short of (−) the first / last line along each axis, added to the edge beam's trib
    const over = { x: [xLines[0] - x0, x1 - xLines[xLines.length - 1]], y: [yLines[0] - y0, y1 - yLines[yLines.length - 1]] };

    const build = joists => {
      // joists 'y': beams along x on each y line, spanning between consecutive x lines
      const beamLines = joists === 'y' ? yLines : xLines;
      const supportLines = joists === 'y' ? xLines : yLines;
      const beams = [], supports = new Map();
      beamLines.forEach((c, i) => {
        const prev = i > 0 ? c - beamLines[i - 1] : 0, next = i < beamLines.length - 1 ? beamLines[i + 1] - c : 0;
        const ov = over[joists === 'y' ? 'y' : 'x'];
        const trib = r3(prev / 2 + next / 2 + (i === 0 ? ov[0] : 0) + (i === beamLines.length - 1 ? ov[1] : 0));
        for (let k = 0; k < supportLines.length - 1; k++) {
          const a = supportLines[k], b = supportLines[k + 1];
          const P = s => (joists === 'y' ? { x: s, y: c } : { x: c, y: s });
          const beam = { id: beams.length, line: c, from: a, to: b, span: r3(b - a), trib, dir: joists === 'y' ? 'x' : 'y', edge: prev === 0 || next === 0, ends: [P(a), P(b)] };
          beams.push(beam);
          [[P(a), 'R'], [P(b), 'L']].forEach(([p, side]) => {
            // side: which side of the support this beam frames in from (L = beam lies before the support)
            const key = r3(p.x) + ',' + r3(p.y);
            if (!supports.has(key)) supports.set(key, { x: r3(p.x), y: r3(p.y), beams: { L: null, R: null } });
            supports.get(key).beams[side === 'L' ? 'L' : 'R'] = beam.id;
          });
        }
      });
      const sup = [...supports.values()].map(s => ({
        ...s, building: isBuildingColumn(g, s.x, s.y),
        label: (g.xLabel(s.x) || ftin(s.x)) + '/' + (g.yLabel(s.y) || ftin(s.y)),
      }));
      const joistSpan = Math.max(...beamLines.slice(1).map((v, i) => v - beamLines[i]));
      const beamSpan = Math.max(...supportLines.slice(1).map((v, i) => v - supportLines[i]));
      return { joists, beamLines, supportLines, beams, supports: sup, mezzCols: sup.filter(s => !s.building), joistSpan, beamSpan };
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
      uniq(inGroup.map(b => b.trib)).sort((a, b) => b - a).forEach(t => {
        marks.push({ span: sg.max, trib: t, beams: inGroup.filter(b => near(b.trib, t)).map(b => b.id) });
      });
    });
    marks.sort((a, b) => b.span * b.trib - a.span * a.trib);
    while (marks.length > 4) { // merge the two lightest-loaded into the heavier one (conservative)
      const last = marks.pop(), prev = marks[marks.length - 1];
      prev.span = Math.max(prev.span, last.span); prev.trib = Math.max(prev.trib, last.trib); prev.beams.push(...last.beams);
    }
    return marks.map((mk, i) => ({ mark: 'MB' + (i + 1), ...mk }));
  }

  const api = { buildingGrid, layout, beamMarks, isBuildingColumn, cum, letters };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MZ_LAYOUT = api;
})(typeof self !== 'undefined' ? self : this);
